#!/usr/bin/env bash
# NOD-93 (ADR-127): o disco base da VM local do Mac, um por arquitetura: Debian 12 genericcloud + chrony + o computador
# da pessoa da ADR-122 (pacotes, usuários, units, o node do motor e o Chromium do Playwright), pelo MESMO
# blocoDoComputador do instalador, com os arquivos locais e sem ligar a unit. Sem dockerd e sem imagem. Sai
#   <saida>/nod-vm-<versao>-<arch>.img.zst  (raw comprimido)  e  <saida>/nod-vm-<versao>-<arch>.img.zst.sha256
# O app baixa esse arquivo (Range + sha256, desktop/vm-local/download.ts) e o Lima (vmType vz) liga a VM com ele.
# Perfis, cookies e chaves do supervisor (/var/lib/nod-computador) moram no disco de dados `nod-dados`
# (nod-dados.service), não neste: trocar o disco base a cada versão do app não apaga nada da pessoa.
#
# Roda no workflow desktop-release (job vm-local) num runner Linux da MESMA arquitetura do disco: o disco é montado
# em loop e o apt do convidado roda em chroot, com o kernel e a rede do host (convidado de outra arquitetura exigiria
# emulação). Precisa de root (losetup, mount, chroot), qemu-utils (qemu-img), cloud-guest-utils (growpart), gdisk,
# e2fsprogs, util-linux (fstrim), zstd, curl e sha512sum/sha256sum.
#
# definido em 2026-11-17: chroot no lugar do libguestfs (virt-resize, virt-customize, virt-sparsify). O libguestfs
# sobe uma VM para mexer no disco e o runner arm64 do GitHub não tem /dev/kvm: em emulação (TCG) o passo levava
# 44 min no arm64 contra 4 min no amd64 (medido em 2026-11-11, run 42937321194).
#
# Uso:
#   construir-disco.sh [--simular] <arm64|amd64> <versao> <origem> <saida>
# <origem> é a pasta de `node scripts/vm-local/origem-do-disco.ts` (computador-*.mjs, computador.sh, node.versao).
# --simular: imprime os comandos externos em vez de executá-los (sem download, sem root).
set -euo pipefail
DIR_VM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=base.env
source "$DIR_VM/base.env"

SIMULAR="${SIMULAR:-0}"
exec 3>&1

ext() { # comando externo; na simulação só imprime (no fd 3, para aparecer mesmo dentro de $(...))
  if [ "$SIMULAR" = 1 ]; then echo "[simular] $*" >&3; return 0; fi
  "$@"
}
passo() { printf '\n== %s\n' "$*"; }

arch_valida() { [ "${1:-}" = arm64 ] || [ "${1:-}" = amd64 ]; }
# A versão vira nome de arquivo e rótulo: só o que um semver/tag usa.
versao_valida() { [[ "${1:-}" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]]; }

sha512_da_base() { # arch
  case "$1" in
    arm64) echo "$DEBIAN_SHA512_ARM64" ;;
    amd64) echo "$DEBIAN_SHA512_AMD64" ;;
  esac
}
nome_da_base() { echo "debian-12-genericcloud-$1-$DEBIAN_DATA.qcow2"; }
nome_do_disco() { echo "nod-vm-$2-$1.img.zst"; } # arch versao
arq_do_node() { [ "$1" = arm64 ] && echo arm64 || echo x64; }

baixar_node() { # arch versao destino: o node do motor, conferido pelo SHASUMS256.txt do próprio release do Node
  local nome="node-v$2-linux-$(arq_do_node "$1").tar.xz" destino="$3" url="https://nodejs.org/dist/v$2"
  ext curl -fsSL --retry 3 -o "$destino/$nome" "$url/$nome"
  ext curl -fsSL --retry 3 -o "$destino/SHASUMS256.txt" "$url/SHASUMS256.txt"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] conferir sha256 $nome" >&3; else
    (cd "$destino" && grep " $nome\$" SHASUMS256.txt | sha256sum -c --status) || { echo "sha256 do node não confere ($nome)" >&2; return 1; }
  fi
  mv "$destino/$nome" "$destino/node.tar.xz" 2>/dev/null || true
}

baixar_base() { # arch destino
  local arch="$1" destino="$2" esperado
  esperado="$(sha512_da_base "$arch")"
  ext curl -fsSL --retry 3 -o "$destino" "$DEBIAN_URL_BASE/$(nome_da_base "$arch")"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] conferir sha512 $esperado" >&3; return 0; fi
  echo "$esperado  $destino" | sha512sum -c --status || { echo "sha512 da base Debian não confere ($destino)" >&2; return 1; }
}

# Estado da montagem, para o `limpar` do trap desfazer tudo se um passo falhar no meio.
TRAB=""
RAIZ=""
LOOP=""
MONTADO=0

montar() { # raw: estica a raiz até o fim do disco e monta o convidado em $RAIZ, com o que o chroot precisa
  local raw="$1" rc=0
  # No genericcloud a raiz é a partição 1 e fica por último no disco (14 e 15 são BIOS e EFI): cresce no lugar.
  ext growpart "$raw" 1
  LOOP="$(ext losetup --find --show --partscan "$raw")"
  LOOP="${LOOP:-/dev/loopN}"
  MONTADO=1
  if [ "$SIMULAR" != 1 ]; then
    udevadm settle 2>/dev/null || true
    [ -b "${LOOP}p1" ] || { partx -u "$LOOP"; udevadm settle 2>/dev/null || true; }
    [ -b "${LOOP}p1" ] || { echo "o kernel não criou ${LOOP}p1 (partições do disco em loop)" >&2; return 1; }
  fi
  # e2fsck sai com 1 quando consertou algo: só 2 ou mais é erro.
  ext e2fsck -fy "${LOOP}p1" || rc=$?
  [ "$rc" -le 1 ] || { echo "e2fsck falhou na raiz do disco (saída $rc)" >&2; return 1; }
  ext resize2fs "${LOOP}p1"
  ext mount "${LOOP}p1" "$RAIZ"
  if [ "$SIMULAR" = 1 ] || [ -b "${LOOP}p15" ]; then ext mount "${LOOP}p15" "$RAIZ/boot/efi"; fi
  ext mount -t proc proc "$RAIZ/proc"
  ext mount -t sysfs sysfs "$RAIZ/sys"
  ext mount --bind /dev "$RAIZ/dev"
  ext mount --bind /dev/pts "$RAIZ/dev/pts"
  # /run em tmpfs: o que os pacotes escrevem ali durante a instalação não vai para o disco.
  ext mount -t tmpfs tmpfs "$RAIZ/run"
}

desmontar() { # desfaz o montar; sem montagem, não faz nada
  [ "$MONTADO" = 1 ] || return 0
  local p
  if [ "$SIMULAR" != 1 ]; then
    # Um serviço que um pacote tenha deixado de pé dentro do chroot seguraria o umount.
    for p in /proc/[0-9]*; do
      if [ "$(readlink "$p/root" 2>/dev/null || true)" = "$RAIZ" ]; then kill -9 "${p##*/}" 2>/dev/null || true; fi
    done
    sync
  fi
  ext umount -R "$RAIZ"
  ext losetup -d "$LOOP"
  MONTADO=0
}

limpar() { # trap de saída: desmonta e só apaga a pasta de trabalho se nada ficou montado nela (o /dev do host entra por bind)
  [ -n "$TRAB" ] || return 0
  desmontar || true
  if [ "$SIMULAR" != 1 ] && grep -q " $TRAB" /proc/self/mounts 2>/dev/null; then
    echo "sobrou montagem em $TRAB: a pasta fica para não apagar o que está montado" >&2
    return 0
  fi
  if [ "$SIMULAR" = 1 ]; then rm -rf "$TRAB"; else rm -rf --one-file-system "$TRAB"; fi
  TRAB=""
}

# Ambiente limpo: o `sudo -E` do workflow não vaza as variáveis do runner para o apt e o computador.sh.
no_convidado() { # comando de shell, como root dentro do disco
  ext chroot "$RAIZ" /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LC_ALL=C.UTF-8 /bin/sh -c "$1"
}

# O chroot usa a rede do host. O /etc/resolv.conf do convidado (um link para o stub do systemd-resolved, que não está de
# pé aqui) sai de lado e volta no fim, como o libguestfs fazia; o policy-rc.d impede o apt de ligar serviço no host.
preparar_convidado() {
  if [ "$SIMULAR" = 1 ]; then echo "[simular] resolv.conf do host e policy-rc.d no convidado" >&3; return 0; fi
  [ ! -e "$RAIZ/usr/sbin/policy-rc.d" ] || { echo "a base já tem /usr/sbin/policy-rc.d" >&2; return 1; }
  printf '#!/bin/sh\nexit 101\n' > "$RAIZ/usr/sbin/policy-rc.d"
  chmod 0755 "$RAIZ/usr/sbin/policy-rc.d"
  if [ -e "$RAIZ/etc/resolv.conf" ] || [ -L "$RAIZ/etc/resolv.conf" ]; then mv "$RAIZ/etc/resolv.conf" "$RAIZ/etc/resolv.conf.nod-original"; fi
  cat /etc/resolv.conf > "$RAIZ/etc/resolv.conf"
}
devolver_convidado() {
  if [ "$SIMULAR" = 1 ]; then echo "[simular] devolver resolv.conf e tirar policy-rc.d do convidado" >&3; return 0; fi
  rm -f "$RAIZ/usr/sbin/policy-rc.d" "$RAIZ/etc/resolv.conf"
  if [ -e "$RAIZ/etc/resolv.conf.nod-original" ] || [ -L "$RAIZ/etc/resolv.conf.nod-original" ]; then mv "$RAIZ/etc/resolv.conf.nod-original" "$RAIZ/etc/resolv.conf"; fi
}

instalar_arquivo() { # modo caminho-relativo-a-arquivos/: copia para o mesmo caminho no convidado, de root
  ext install -D -o root -g root -m "$1" "$DIR_VM/arquivos/$2" "$RAIZ/$2"
}

construir() { # arch versao origem saida
  local arch="$1" versao="$2" origem="$3" saida="$4" raw disco node_versao a
  arch_valida "$arch" || { echo "arquitetura inválida: '$arch' (arm64 ou amd64)" >&2; return 2; }
  versao_valida "$versao" || { echo "versão inválida: '$versao'" >&2; return 2; }
  if [ "$SIMULAR" != 1 ]; then
    for a in computador-supervisor.mjs computador-tela.mjs computador-terminal.mjs computador.sh node.versao; do
      [ -f "$origem/$a" ] || { echo "a origem do disco não tem $a: $origem" >&2; return 2; }
    done
    [ "$(uname -m)" = "$([ "$arch" = arm64 ] && echo aarch64 || echo x86_64)" ] || { echo "o disco $arch precisa de um host $arch (este é $(uname -m))" >&2; return 2; }
    [ "$(id -u)" = 0 ] || { echo "construir o disco precisa de root (losetup, mount, chroot)" >&2; return 2; }
  fi
  node_versao="$(cat "$origem/node.versao" 2>/dev/null || echo "${NODE_VERSAO_SIMULADA:-24.19.0}")"
  [[ "$node_versao" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versão do node inválida: '$node_versao'" >&2; return 2; }
  TRAB="$(mktemp -d)"
  trap limpar EXIT
  RAIZ="$TRAB/raiz"
  raw="$TRAB/disco.raw"
  disco="$saida/$(nome_do_disco "$arch" "$versao")"
  mkdir -p "$saida" "$RAIZ"

  passo "base Debian $DEBIAN_SERIE $DEBIAN_DATA ($arch)"
  baixar_base "$arch" "$TRAB/base.qcow2"
  # O qcow2 vem com a raiz de ~2 GB: vira um raw de DISCO_TAMANHO e a raiz estica antes do apt e do Chromium.
  ext qemu-img convert -f qcow2 -O raw "$TRAB/base.qcow2" "$raw"
  ext qemu-img resize -f raw "$raw" "$DISCO_TAMANHO"
  montar "$raw"

  passo "node $node_versao do motor"
  mkdir -p "$TRAB/origem"
  baixar_node "$arch" "$node_versao" "$TRAB/origem"
  [ "$SIMULAR" = 1 ] || cp "$origem"/computador-*.mjs "$origem/computador.sh" "$TRAB/origem/"

  passo "chrony, o computador da pessoa (ADR-122) e os arquivos do nod no convidado"
  preparar_convidado
  no_convidado 'apt-get -q update && DEBIAN_FRONTEND=noninteractive apt-get -q -y install chrony curl ca-certificates xz-utils'
  ext install -d -o root -g root -m 0755 "$RAIZ/var/lib/nod"
  ext cp -r "$TRAB/origem" "$RAIZ/var/lib/nod/origem"
  ext chown -R root:root "$RAIZ/var/lib/nod/origem"
  no_convidado 'mkdir -p /opt/nod-motor/node && tar --no-same-owner -xJf /var/lib/nod/origem/node.tar.xz -C /opt/nod-motor/node --strip-components=1 && chown -R root:root /opt/nod-motor/node'
  no_convidado 'ORIGEM=/var/lib/nod/origem sh /var/lib/nod/origem/computador.sh'
  instalar_arquivo 0644 etc/systemd/system/nod-computador.service.d/nod-dados.conf
  instalar_arquivo 0644 etc/systemd/system/nod-computador-terminal.service.d/nod-dados.conf
  instalar_arquivo 0644 etc/systemd/system/nod-dados.service
  instalar_arquivo 0644 etc/chrony/conf.d/nod.conf
  instalar_arquivo 0755 usr/local/lib/nod/esperar-dados.sh
  no_convidado 'systemctl enable nod-dados.service chrony.service'
  no_convidado 'rm -rf /var/lib/nod/origem && apt-get clean && rm -rf /var/lib/apt/lists/*'
  devolver_convidado
  # O machine-id sai vazio no disco: cada VM gera o seu no 1º boot.
  ext truncate -s 0 "$RAIZ/etc/machine-id"

  passo "compactar e publicar"
  # Devolve ao arquivo os blocos livres da raiz (o que o virt-sparsify fazia): o zstd não carrega resto de apt apagado.
  # medido em 2026-11-18: o sync vem antes porque o ext4 só entrega ao fstrim os blocos de arquivo apagado depois de
  # gravar o diário. Sem ele o cache do apt recém-apagado ficava no disco: 1066 MiB comprimido no arm64 (run
  # 44228609474) contra 762 MiB do libguestfs (run 42937321194).
  ext sync -f "$RAIZ"
  ext fstrim "$RAIZ"
  desmontar
  # medido em 2026-11-05 (release rc.3, run 41911353290): o -19 levava 14 min no amd64 e 9 min no arm64, com o disco
  # pronto. Numa amostra de 400 MB: -19 em 72 s (105 MB), -12 em 6 s (118 MB). O -12 custa ~12% de download e
  # devolve 10 a 20 min por release.
  ext zstd -q -T0 -12 --long=27 -o "$disco" "$raw"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] sha256 $disco" >&3; else (cd "$saida" && sha256sum "$(basename "$disco")" > "$(basename "$disco").sha256"); fi
  echo "$disco"
}

main() {
  if [ "${1:-}" = --simular ]; then SIMULAR=1; shift; fi
  [ "$#" -eq 4 ] || { echo "uso: construir-disco.sh [--simular] <arm64|amd64> <versao> <origem> <saida>" >&2; return 2; }
  construir "$@"
}

# Carregado com `source`, só define as funções (os testes usam assim).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

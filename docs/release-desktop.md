# Publicar os downloads estáveis do app desktop (nodbot.ai)

Os botões do site não apontam para uma versão: apontam para **nomes estáveis** na raiz do bucket público
`nodbot-downloads` (NOD-322). Este runbook é a etapa **manual** que troca esses nomes depois do aceite da release.

| Alias do site (`site/_redirects`, 302) | Objeto estável |
|---|---|
| `/download/mac` (Apple Silicon e Mac sem detecção) | `gs://nodbot-downloads/nod-mac-arm64.dmg` |
| `/download/mac-intel` | `gs://nodbot-downloads/nod-mac-x64.dmg` |
| `/download/windows` | `gs://nodbot-downloads/nod-windows-x64.exe` |

O teste `tests/unit/site/cta-final.test.ts` amarra esta tabela ao `_redirects`: renomear um lado sem o outro derruba
a CI.

## O que a CI faz e o que fica à mão

- `.github/workflows/desktop-release.yml` (tag `v*`) builda, assina, notariza e verifica os DMGs **arm64 e x64**
  (e o `.exe` x64), gera `SHA256-arm64.txt`, `SHA256-x64.txt` e `SHA256-win-x64.txt` e cria a **release em
  rascunho** com tudo anexado.
- O job `downloads` (só com `vars.NOD_RELEASE_BUCKET == '1'`) sobe a pasta da versão, `gs://nodbot-downloads/v<versão>/`,
  com `--no-clobber`. Ele **nunca** escreve na raiz: a conta dele só cria objetos.
- A troca dos nomes estáveis da raiz é **manual**, feita por quem tem escrita no bucket, e só **depois do aceite**
  ([aceite-desktop.md](aceite-desktop.md)) nos dois Macs e no Windows. Fica assim até existir uma permissão de
  escrita dedicada para automatizar (decisão operacional à parte, fora da NOD-322).

## Passo a passo (pós-aceite)

Com o `gcloud` logado numa conta com escrita no bucket, ajuste `V` para a versão aceita (sem o `v`, ex.: `1.0.0-rc.7`)
e cole o bloco inteiro. Ele roda num subshell com `set -euo pipefail`: se um download ou a conferência dos hashes
falhar, **para antes de tocar na raiz** do bucket (e o seu terminal continua aberto).

```sh
(
set -euo pipefail
V=1.0.0-rc.7
B=gs://nodbot-downloads
D=$(mktemp -d) && cd "$D"

# 1. Baixar da pasta da versão, que o job `downloads` sobe com os mesmos arquivos do rascunho.
gcloud storage cp "$B/v$V/nod-$V-mac-arm64.dmg" "$B/v$V/nod-$V-mac-x64.dmg" \
  "$B/v$V/nod-windows-x64.exe" "$B/v$V/SHA256-*.txt" "$B/v$V/nod-windows-x64.exe.sha256" .

# 2. Conferir os hashes. Os SHA256-<arch>.txt saem de `shasum -a 256 release/...` (caminho com release/).
grep -h '\.dmg' SHA256-arm64.txt SHA256-x64.txt | sed 's#release/##' | sha256sum -c
tr -d '\r' < nod-windows-x64.exe.sha256 | sha256sum -c

# 3. Guardar os atuais para o rollback, um backup por versão. --no-clobber: rodar de novo (ex.: depois de uma falha
#    no passo 4) não troca o backup pelo que já é novo.
for f in nod-mac-arm64.dmg nod-mac-x64.dmg nod-windows-x64.exe; do
  gcloud storage cp --no-clobber "$B/$f" "$B/anterior/antes-de-v$V/$f"
done

# 4. Trocar os nomes estáveis. --cache-control=no-store como os objetos de hoje: sem a flag o GCS serve o objeto
#    público com cache de 1 h, e quem clicar logo depois (ou depois de um rollback) baixa a versão velha.
gcloud storage cp --cache-control=no-store --content-type=application/x-apple-diskimage "nod-$V-mac-arm64.dmg" "$B/nod-mac-arm64.dmg"
gcloud storage cp --cache-control=no-store --content-type=application/x-apple-diskimage "nod-$V-mac-x64.dmg" "$B/nod-mac-x64.dmg"
gcloud storage cp --cache-control=no-store --content-type=application/x-msdos-program nod-windows-x64.exe "$B/nod-windows-x64.exe"
echo "ok: v$V nos nomes estáveis"
)
```

Sem o job `downloads` ligado (`vars.NOD_RELEASE_BUCKET`), a pasta `v<versão>/` não existe: suba antes os anexos do
rascunho para ela (`gh release download "v$V" -R marlonwlv/nod -p 'nod-*-mac-*.dmg' -p 'SHA256-*.txt' -p
'nod-windows-x64.exe*'` e `gcloud storage cp --no-clobber ... gs://nodbot-downloads/v$V/`) e rode o bloco.

## Conferir no ar

```sh
for a in mac mac-intel windows; do curl -sI "https://nodbot.ai/download/$a" | grep -iE '^(HTTP|location)'; done
for f in nod-mac-arm64.dmg nod-mac-x64.dmg nod-windows-x64.exe; do
  curl -sI "https://storage.googleapis.com/nodbot-downloads/$f" | grep -iE '^(HTTP|last-modified|content-length|cache-control)'
done
```

Cada alias responde **302** para o objeto da tabela, e cada objeto responde **200** com `cache-control: no-store` e
`last-modified` de agora. Baixe o DMG da sua arquitetura e confira o hash com o do passo 2.

## Rollback

Copie de volta o que o passo 3 guardou, com a mesma flag de cache:
`gcloud storage cp --cache-control=no-store gs://nodbot-downloads/anterior/antes-de-v<versão>/<nome> gs://nodbot-downloads/<nome>`,
e repita a conferência. O site não muda: os aliases continuam os mesmos.

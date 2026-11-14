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

Com o `gcloud` logado numa conta com escrita no bucket e `V` igual à versão aceita (sem o `v`, ex.: `1.0.0-rc.7`):

```sh
V=1.0.0-rc.7
D=$(mktemp -d) && cd "$D"

# 1. Baixar da pasta da versão (ou dos anexos do rascunho: gh release download "v$V" -R marlonwlv/nod)
gcloud storage cp "gs://nodbot-downloads/v$V/nod-$V-mac-arm64.dmg" "gs://nodbot-downloads/v$V/nod-$V-mac-x64.dmg" \
  "gs://nodbot-downloads/v$V/nod-windows-x64.exe" "gs://nodbot-downloads/v$V/SHA256-*.txt" \
  "gs://nodbot-downloads/v$V/nod-windows-x64.exe.sha256" .

# 2. Conferir os hashes: o que vai para a raiz é o que foi aceito
grep -h '\.dmg' SHA256-arm64.txt SHA256-x64.txt | sed 's#release/##' | sha256sum -c
tr -d '\r' < nod-windows-x64.exe.sha256 | sha256sum -c

# 3. Guardar os atuais para o rollback
for f in nod-mac-arm64.dmg nod-mac-x64.dmg nod-windows-x64.exe; do
  gcloud storage cp "gs://nodbot-downloads/$f" "gs://nodbot-downloads/anterior/$f"
done

# 4. Trocar os nomes estáveis
gcloud storage cp "nod-$V-mac-arm64.dmg" gs://nodbot-downloads/nod-mac-arm64.dmg
gcloud storage cp "nod-$V-mac-x64.dmg"   gs://nodbot-downloads/nod-mac-x64.dmg
gcloud storage cp nod-windows-x64.exe    gs://nodbot-downloads/nod-windows-x64.exe
```

## Conferir no ar

```sh
for a in mac mac-intel windows; do curl -sI "https://nodbot.ai/download/$a" | grep -iE '^(HTTP|location)'; done
for f in nod-mac-arm64.dmg nod-mac-x64.dmg nod-windows-x64.exe; do
  curl -sI "https://storage.googleapis.com/nodbot-downloads/$f" | grep -iE '^(HTTP|last-modified|content-length)'
done
```

Cada alias responde **302** para o objeto da tabela, e cada objeto responde **200** com `last-modified` de agora.
Baixe o DMG da sua arquitetura e confira o hash com o do passo 2.

## Rollback

Copie de volta o que o passo 3 guardou (`gs://nodbot-downloads/anterior/<nome>` → `gs://nodbot-downloads/<nome>`) e
repita a conferência. O site não muda: os aliases continuam os mesmos.

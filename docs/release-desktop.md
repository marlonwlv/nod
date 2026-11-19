# Publicar os downloads do app desktop (nodbot.ai)

Os botões do site apontam para os artefatos **imutáveis da versão aceita** na pasta versionada do bucket público
`nodbot-downloads` (NOD-322). A promoção é manual, por PR que troca os destinos em `site/_redirects` depois do aceite.

| Alias do site (`site/_redirects`, 302) | Objeto da versão aceita |
|---|---|
| `/download/mac` (Apple Silicon e Mac sem detecção) | `gs://nodbot-downloads/v1.0.0-rc.8/nod-1.0.0-rc.8-mac-arm64.dmg` |
| `/download/mac-intel` | `gs://nodbot-downloads/v1.0.0-rc.8/nod-1.0.0-rc.8-mac-x64.dmg` |
| `/download/windows` | `gs://nodbot-downloads/v1.0.0-rc.8/nod-windows-x64.exe` |

O teste `tests/unit/site/cta-final.test.ts` amarra esta tabela ao `_redirects`: renomear um lado sem o outro derruba
a CI.

## O que a CI faz e o que fica à mão

- `.github/workflows/desktop-release.yml` (tag `v*`) builda, assina, notariza e verifica os DMGs **arm64 e x64**
  (e o `.exe` x64), gera `SHA256-arm64.txt`, `SHA256-x64.txt` e `SHA256-win-x64.txt` e cria a **release em
  rascunho** com tudo anexado.
- O job `downloads` (só com `vars.NOD_RELEASE_BUCKET == '1'`) sobe a pasta da versão, `gs://nodbot-downloads/v<versão>/`,
  com `--no-clobber`. Ele **nunca** escreve na raiz: a conta dele só cria objetos.
- A promoção é **manual**, por PR que troca `site/_redirects`, e só acontece **depois do aceite**
  ([aceite-desktop.md](aceite-desktop.md)) nos dois Macs e no Windows.
- Os nomes antigos da raiz ficam para compatibilidade: a política de retenção do bucket impede sobrescrevê-los.

## Passo a passo (pós-aceite)

Com o `gcloud` logado, ajuste `V`, baixe os arquivos da pasta versionada e confira os hashes antes de mudar o site.

```sh
(
set -euo pipefail
V=1.0.0-rc.8
B=gs://nodbot-downloads
D=$(mktemp -d) && cd "$D"

# 1. Baixar da pasta da versão, que o job `downloads` sobe com os mesmos arquivos do rascunho.
gcloud storage cp "$B/v$V/nod-$V-mac-arm64.dmg" "$B/v$V/nod-$V-mac-x64.dmg" \
  "$B/v$V/nod-windows-x64.exe" "$B/v$V/SHA256-*.txt" "$B/v$V/nod-windows-x64.exe.sha256" .

# 2. Conferir os hashes. Os SHA256-<arch>.txt saem de `shasum -a 256 release/...` (caminho com release/).
grep -h '\.dmg' SHA256-arm64.txt SHA256-x64.txt | sed 's#release/##' | sha256sum -c
tr -d '\r' < nod-windows-x64.exe.sha256 | sha256sum -c

# 3. Os caminhos conferidos viram os destinos de /download/mac, /download/mac-intel e /download/windows em
#    site/_redirects. A CI e a revisão do PR são a catraca da promoção.
echo "ok: v$V pronta para promover em site/_redirects"
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

Cada alias responde **302** para o objeto versionado da tabela, e cada objeto responde **200**. Baixe o DMG da sua
arquitetura e confira o hash com o do passo 2.

## Rollback

Reverta o commit que mudou `site/_redirects`; os objetos de todas as versões permanecem intactos no bucket.

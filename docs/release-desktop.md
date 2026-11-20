# Publicar os downloads do app desktop no site (nodbot.ai)

Os botões do site apontam para aliases (`site/_redirects`, 302), e cada alias aponta para a **pasta de uma versão** no
bucket público `nodbot-downloads`. Este runbook é a etapa **manual** que troca a versão dos aliases depois do aceite da
release.

| Alias do site (`site/_redirects`, 302) | Objeto (V = versão aceita, sem o `v`) |
|---|---|
| `/download/mac` (Apple Silicon e Mac sem detecção) | `gs://nodbot-downloads/v$V/nod-$V-mac-arm64.dmg` |
| `/download/mac-intel` | `gs://nodbot-downloads/v$V/nod-$V-mac-x64.dmg` |
| `/download/windows` | `gs://nodbot-downloads/v$V/nod-$V-win-x64.exe` |

O servidor também tem um `/download/windows` (`app.nodbot.ai`, ADR-151): é a constante `URL_DO_EXE_WINDOWS` em
`src/adapters/http/servidor.ts`, que precisa ser igual ao destino do `/download/windows` do site. O teste
`tests/unit/site/cta-final.test.ts` exige as três linhas na mesma versão e a constante igual: trocar um lado sem o
outro derruba a CI.

**Por que não há mais "nome estável" na raiz (2026-11-19).** Até a rc.6 os aliases iam para `nod-mac-arm64.dmg`,
`nod-mac-x64.dmg` e `nod-windows-x64.exe` na raiz do bucket, e a troca era sobrescrever esses três. Em 2026-11-13 o
bucket ganhou retenção de 365 dias (`retentionPeriod: 31536000`, sem lock): nenhum objeto pode ser apagado nem
sobrescrito antes de um ano. Os três da raiz ficaram na rc.6 até 2027-11-08 (o `cp` responde 403), e a rc.8 nunca
chegou ao site por isso. A versão agora entra pelo `_redirects`, sem tocar em objeto nenhum.

## O que a CI faz e o que fica à mão

- O `desktop-release.yml` gera os DMGs (arm64 e x64), os ZIPs da atualização automática, o instalador do Windows
  (e o `.exe` x64), gera `SHA256-arm64.txt`, `SHA256-x64.txt` e `SHA256-win-x64.txt` e cria a **release em
  rascunho** com tudo anexado.
- O job `downloads` (só com `vars.NOD_RELEASE_BUCKET == '1'`) sobe a pasta da versão, `gs://nodbot-downloads/v<versão>/`,
  com `--no-clobber`. Ele **nunca** escreve na raiz: a conta dele só cria objetos.
- A troca da versão dos aliases é **manual** e vem **depois do aceite** ([aceite-desktop.md](aceite-desktop.md)) nos dois
  Macs e no Windows, ou por decisão explícita de quem responde pela release (a rc.9 entrou no site antes do aceite, a
  pedido, em 2026-11-19).

## Passo a passo

1. Conferir que a pasta da versão tem os arquivos e que os hashes batem com a release. Cole o bloco inteiro com `V`
   ajustado; ele para no primeiro erro. Os `SHA256-<arch>.txt` saem de `shasum -a 256 release/...` (caminho com
   `release/`), por isso o `sed`. O `shasum -c` lê um arquivo, não a entrada padrão (o `sha256sum` do macOS recusa
   `-c` sem arquivo e o bloco seguia sem conferir nada; visto em 2026-11-19).

   ```sh
   (
   set -euo pipefail
   V=1.0.0-rc.9
   B=gs://nodbot-downloads
   D=$(mktemp -d) && cd "$D"
   gcloud storage cp "$B/v$V/nod-$V-mac-arm64.dmg" "$B/v$V/nod-$V-mac-x64.dmg" "$B/v$V/nod-$V-win-x64.exe" \
     "$B/v$V/SHA256-*.txt" .
   cat SHA256-arm64.txt SHA256-x64.txt SHA256-win-x64.txt | tr -d '\r' | sed 's#release/##' \
     | grep -E "nod-$V-(mac-(arm64|x64)\.dmg|win-x64\.exe)\$" > conferir.txt
   [ "$(wc -l < conferir.txt)" -eq 3 ] || { echo "faltam hashes em SHA256-*.txt"; exit 1; }
   shasum -a 256 -c conferir.txt
   echo "ok: v$V conferida"
   )
   ```

   Sem o job `downloads` ligado (`vars.NOD_RELEASE_BUCKET`), a pasta `v<versão>/` não existe: suba antes os anexos do
   rascunho para ela (`gh release download "v$V" -R marlonwlv/nod -p 'nod-*-mac-*.dmg' -p 'SHA256-*.txt' -p
   'nod-*-win-x64.exe'` e `gcloud storage cp --no-clobber ... gs://nodbot-downloads/v$V/`) e rode o bloco.

2. Num PR para a main, trocar a versão nas três linhas `/download/*` do `site/_redirects` e em `URL_DO_EXE_WINDOWS`.
   O merge leva o `/download/windows` do servidor junto com o deploy.

3. Publicar o site (não há deploy automático, ver `site/README.md`), com o wrangler logado na conta do Worker ou com
   `CLOUDFLARE_API_TOKEN`:

   ```sh
   npx wrangler deploy -c site/wrangler.jsonc
   ```

## Conferir no ar

```sh
for a in mac mac-intel windows; do curl -sI "https://nodbot.ai/download/$a" | grep -iE '^(HTTP|location)'; done
curl -sI https://app.nodbot.ai/download/windows | grep -iE '^(HTTP|location)'
```

Cada alias responde **302** para a pasta da versão nova. Baixe o DMG da sua arquitetura e confira o hash com o
`SHA256-<arch>.txt` da release.

## Rollback

Volte as três linhas do `_redirects` (e a constante) para a versão anterior e publique de novo. Nenhum objeto muda:
as pastas de todas as versões continuam no bucket.

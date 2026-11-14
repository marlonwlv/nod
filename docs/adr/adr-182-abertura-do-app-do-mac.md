# ADR-182 — Abertura do app do Mac: partição persistente, storage da mesma pessoa preservado e janela antes do executor

Status: proposta (2026-11-13, leva 2 do carregamento, lane desktop) · Relacionadas: [ADR-181](adr-181-leituras-em-voo-e-abrir-bot-na-hora.md)
(a web), [ADR-094](adr-094-celular-e-a-mesma-web-instalavel.md) e [ADR-152](adr-152-app-desktop-no-windows.md) (privacidade e a partição `nod-web`),
NOD-328 (o Caddy comprime `/assets`), PR #24 (a réplica das conversas e o journal de envio em IndexedDB).

## Contexto

Achados da revisão de 2026-11-13 em `desktop/main.ts`:

- A janela web usava `partition: "nod-web"`, sem `persist:`: no Electron é uma sessão só em memória. A cada abertura do
  app o bundle inteiro (JS de ~1,1 MB, CSS de ~365 KB, fontes) vinha de novo do servidor, sem cache HTTP nem cache de
  código do V8, mesmo com `/assets` servido como `public, max-age=31536000, immutable`.
- `conectar()` chamava `web.clearStorageData()` sem filtro em TODO lançamento: apagava localStorage e IndexedDB. A
  réplica das conversas e o journal de envio do chat (PR #24) morreriam a cada abertura, e o journal "reconciliado no
  boot" nunca teria o que reconciliar no Mac.
- A janela só nascia depois de montar o executor, sondar os binários, detectar o `gh`, carregar e sincronizar as contas
  e iniciar a vigia das IAs (segundos num Mac carregado). Até lá a pessoa via a tela "Conectar ao nod".

## Decisão

1. **`persist:nod-web`** (`PARTICAO_WEB`) em toda janela da web: a principal, os avatares e o Quick Chat. O cache HTTP
   guarda o bundle entre aberturas; o IndexedDB da web sobrevive.
2. **O storage só é apagado quando a pessoa ou o servidor mudou.** `conectar` compara `configuracao.url`/`pessoaId` com
   a sessão nova (o `pessoaId` passa a ir na configuração cifrada, `ler()` o devolve): a mesma pessoa no mesmo servidor
   troca só o cookie (`clearStorageData({ storages: ["cookies"] })`); outra pessoa ou outro servidor limpa tudo, como
   antes. O cache HTTP nunca entra na limpeza: é público e imutável (a API é `no-store`).
3. **A janela nasce logo depois do cookie** (`abrirJanelaWeb`), antes de `montarCfg`, da sonda e da sincronização de
   contas; a carga da página corre em paralelo e é aguardada no fim do `conectar`. A web já trata o estado `procurando`
   das IAs e a lista de contas vazia até a sonda chegar (`emitirEstados` avisa quando muda); a falha de carga segue pelo
   `did-fail-load`, que leva à tela de conexão.

## Alternativas descartadas

- **Manter a sessão em memória e só adicionar `clearCache` seletivo**: não existe cache a preservar numa sessão em
  memória; o ganho pede `persist:`.
- **Limpar sempre e deixar a web refazer a réplica**: anula o PR #24 no Mac.
- **Code-splitting do bundle**: fica para as fases do React (ADR-179); com o cache, o download repetido já some.

## Gatilhos de reversão

- Dado de uma pessoa visível para outra no mesmo Mac: a comparação `url`/`pessoaId` falhou → voltar à limpeza total
  (não à partição em memória).
- Flicker de "sem IA"/"instale" na abertura: a web não está tratando `procurando` em alguma tela → corrigir a tela, não
  a ordem.
- Bundle velho depois de um deploy: o `index.html` é `no-cache` e os nomes de `/assets` têm hash; se aparecer, é o
  `immutable` servindo um nome repetido.

# ADR-183 — Servidor sem filas ao abrir um bot: catálogo servido velho, sessão em voo e levas nos GETs pequenos

Status: proposta (2026-11-13, leva 2 do carregamento, lane servidor) · Relacionadas: [ADR-181](adr-181-leituras-em-voo-e-abrir-bot-na-hora.md)
(a web), [ADR-041](adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md) e
[ADR-057](adr-057-marketplace-com-o-catalogo-publico-do-composio.md) (o catálogo), [ADR-124](adr-124-identidade-progressiva-uso-sem-conta-e-conversao.md) §4 (sessões revogáveis),
[ADR-001](adr-001-modo-do-pooler-tamanho-do-pool-e-politica-de-deploy.md) (pool).

## Contexto

Revisão de 2026-11-13 do caminho "abrir um bot": com a web lendo as faltas da tela em paralelo (ADR-181), o que sobra
são filas dentro de cada GET e entre os GETs da mesma leva:

- `GET conectores` chamava o Composio por HTTP **dentro do pedido** sempre que o cache de 60 s vencia (até 30 s com
  as tentativas, `ORCAMENTO_CONECTOR_MS`), e abria duas transações em série (a lista e a chave).
- O cache da sessão (3 s) guardava só o resultado: a leva de ~15 GETs chegava junta, errava o cache ao mesmo tempo e
  fazia ~15 `sessaoViva` no pool; e o carimbo `tocarSessao` (um UPDATE) segurava o pedido.
- `GET frota` fazia 6 idas ao banco em fila que não dependiam umas das outras; `nao-lidos`, `concessoes`, `maquinas`
  e o recorte da `atividade` tinham o mesmo desenho em menor escala.

## Decisão

1. **Catálogo do Composio servido velho e renovado em segundo plano** (`catalogo-composio.ts`): o vencido volta na hora
   e a renovação sai sozinha, uma por tenant (promessa em voo compartilhada); só a primeira leitura do tenant espera. A
   renovação que falha conta como leitura (a próxima janela tenta de novo) e serve o último bom, como antes. A rota faz
   as duas leituras na mesma transação.
2. **Cache da sessão guarda a promessa** (`sessao-revogavel.ts`): a primeira consulta serve a todas as que chegam na
   mesma janela; a que falha não fica guardada. `tocarSessao` sai sem segurar o pedido (a falha dele só atrasa o
   carimbo "usada há X min").
3. **Levas nos GETs pequenos**: `listar-frota` (agentes, fora do ar, resumo das leituras, inventário, conectores e
   times numa leva, depois as conversas, depois o trio), `nao-lidos`, `concessoes`, `maquinas` e o recorte da
   `atividade` com `Promise.all` onde as leituras não dependem umas das outras.
4. **Regra para levas dentro de uma transação**: uma consulta que o Postgres recusa aborta a transação e derruba as
   que vêm depois na fila da conexão. Leitura que PODE falhar por entrada da pessoa (o fuso da atividade) é validada
   em JS antes de sair, vai DEPOIS das outras na fila e é aguardada antes de qualquer consulta seguinte.

## Alternativas descartadas

- **`set_config` sem `await` antes do caso de uso** (pipelinar a abertura da tx): ~1 ms contra a invariante "nada roda
  sem escopo". Cortado na revisão.
- **`idle_timeout` de 20 s → 120 s** e índices novos (mensagens `DESC, id`, turnos concluídos, conversas por agente):
  só com medição (`pg_stat_activity`, EXPLAIN) — ficam como tarefa de medição, não entram aqui.
- **N+1 de `sua-vez` e `rotinas`**: reais, mas o tamanho depende de quantos itens a pessoa tem; ficam atrás da
  medição com os logs de produção.

## Gatilhos de reversão

- Catálogo "velho" visível por mais de uma janela depois de a pessoa criar um app no painel: a renovação em segundo
  plano não está assentando (log `marketplace_catalogo_do_piso`) → voltar a esperar na primeira leitura após vencer.
- Sessão revogada ainda válida por mais de 3 s + a consulta em voo: a promessa guardada passou do `ate` → conferir
  `CACHE_MS`.
- `banco_ocupado` subindo: as levas somadas ao teto de 6 da web passaram do pool → baixar o teto antes de desfazer
  as levas.

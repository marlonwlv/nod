# ADR-181 — Abrir um bot na hora: leituras em voo por chave, levas no servidor e gzip na API

Status: proposta (2026-11-13, leva 2 do carregamento; pedido do Marlon: "quero instantâneo") · Base: `grokbot/transicao` +
`react/fase-0-bugs` (Q3, Q5 e C5 da [ADR-179](adr-179-front-em-react-por-regioes.md), fase 0) · Relacionadas:
[ADR-001](adr-001-modo-do-pooler-tamanho-do-pool-e-politica-de-deploy.md) (pool), [ADR-153](adr-153-quadros-por-bot-e-projetos.md)
(o `?quadro=`), NOD-216 (`vivos:`), NOD-328 (o Caddy só comprime o bundle). Substitui a ADR-167 do PR #30 (contra a main,
fechado): o que ela tinha e a fase 0 já fez (lista+quadro juntos, `montarQuadro` em levas, conversa primeiro na fila) e a
pré-carga das conversas (coberta pela réplica em IndexedDB do chat, PR #24) saíram daqui.

## Contexto

Medido em 2026-11-13 contra `app.nodbot.ai` (Caddy, HTTP/2): ~60–80 ms por ida e volta de API com a conexão aberta. A
lentidão era **fila de idas e voltas**, não consulta pesada:

- **Web.** `reidratar` tinha uma trava única e buscava as faltas da tela uma por vez, com o `render` só no fim: ~15 GETs
  em fila na primeira carga (1,2–2,5 s até a conversa aparecer); e um clique no meio de uma passada esperava a leitura
  mais lenta dela (o `GET conectores` que vai ao Composio). A fase 0 pôs a conversa na frente da fila, mas a fila seguiu
  em série.
- **Servidor.** `lerConversa` fazia ~12 idas ao banco em fila (anexos, fila dos pedidos, turnos, fios, trabalhos, dono,
  presença, reações, pedidos de colega, ações do modo). `verQuadro` sem `?quadro=` abria o padrão, não o último aberto:
  na primeira leitura de um bot (Q3, lista e quadro juntos) a tela relia o quadro quando a lista apontava outro.
- **Tamanho.** A API vai sem compressão (NOD-328): uma conversa de 200 falas passa de 100 KB crus.

## Decisão

1. **Leituras em voo por chave, com teto** (`web/lib/leituras-em-voo.ts`, `TETO_EM_VOO = 6`). Cada chave do
   `reidratar` é uma leitura: a chave nova sai na hora se há vaga, a repetida espera a MESMA promessa (sem GET duplo do
   clique durante o prefetch do hover), e o teto limita quantas transações uma pessoa abre de uma vez (o pool tem 15,
   ADR-001; duas pessoas abrindo o app juntas ficam em 12). Cada resposta entra no estado e pinta no próximo quadro
   (`renderNoQuadro`); a frota/gestão que tira a pessoa da conversa e os não lidos pintam síncrono, porque o que vem
   depois lê o DOM. A queda de rede guarda a leitura que caiu e as que ainda esperavam vaga (`pendentesDeRede`); o erro
   e a sonda saem uma vez por passada.
2. **`conversa:*` com janela de 200 ms, primeiro frame na hora.** O frame que invalida a conversa relê já e abre a
   janela; os frames dos 200 ms seguintes viram uma releitura só, no fim dela. Sem +200 ms no chat (o 1º relê na hora);
   a resposta de um bot com várias falas vira 1–2 GETs em vez de 3–4. Quando o cursor por conversa (PR #29) for ligado
   na web, a releitura passa a pedir só o delta e esta janela deixa de importar.
3. **`verQuadro` sem `?quadro=` abre o último aberto do bot** (`preferencias.quadroAberto`, o mesmo que
   `quadrosDoBot.aberto` diz por `quadroAoAbrir`; se saiu do bot, o padrão). Com `?quadro=` nada muda; as mutações
   seguem a ADR-153.
4. **`lerConversa` em três levas** (`Promise.all`): o que só depende da conversa; o que depende das falas lidas; o que
   depende das falas com fila. O postgres.js enfileira as consultas da mesma transação na mesma conexão: a leva poupa a
   espera entre elas, não abre conexão nova.
5. **gzip nas respostas JSON** a partir de 1 KiB quando o cliente aceita (`json()` em `util.ts`, `vary:
   accept-encoding`), assíncrono no threadpool do zlib; se outra resposta saiu no meio, a compressão se cala. SSE e
   long-poll não passam por `json()`; o Caddy segue sem `encode` na API (NOD-328). O chamador interno do MCP (ADR-166)
   não manda `accept-encoding`: recebe cru.

## Alternativas descartadas

- **Trava única + passada paralela** (o que o PR #30 fez): o clique continuava esperando a leitura mais lenta da
  passada anterior.
- **Passada paralela sem teto**: 15 transações por pessoa de uma vez; com o pool de 15 por cor, duas pessoas abrindo o
  app juntas esgotam o pool (`banco_ocupado`).
- **`set_config` sem `await` antes do caso de uso** (pipelinar na mesma conexão): ~1 ms de ganho contra a invariante
  "nada roda sem escopo". Cortado na revisão.
- **Uma rota só "tudo da conversa"**: fica como passo seguinte se o teto de 6 não bastar para o pool.

## Gatilhos de reversão

- `banco_ocupado` (503) ou `tx_longa` subindo em produção nas horas de pico: baixar `TETO_EM_VOO` (4) antes de voltar à
  fila em série; se insistir, a rota agregada.
- CPU do servidor subindo com o gzip (a conversa de 200 falas comprime em poucos ms): subir `GZIP_A_PARTIR_DE`.
- O quadro aberto sem link vindo diferente do que a lista diz: `verQuadro` e `quadrosDoBot` divergiram em
  `quadroAoAbrir` → corrigir, não voltar à leitura em fila.

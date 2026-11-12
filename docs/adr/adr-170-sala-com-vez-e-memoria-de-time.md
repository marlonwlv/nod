# ADR-170 — Sala com a vez de cada membro e memória de time revisada por gente

Status: proposta (só o domínio entrou; persistência, rotas e telas no próximo recorte) · Data: 2026-11-12 (decisão 3
do Marlon: "salas com vários bots e pessoas; memória de time") · Estende a
[ADR-027](adr-027-sala-de-conversa-tem-visibilidade-propria-membership-e-g.md) e a
[ADR-136](adr-136-recall-de-memoria-por-busca-lexica.md).

## Contexto

O nod já tem sala (ADR-027): 2 a 6 bots, quem responde por política, teto de 3 handoffs por rodada e orçamento sem
humano. Faltam duas coisas do Grok Bot: a **vez de cada membro** (`RequestRoomMemberTurn` → `DeliverRoomMemberTurnResult`),
com pessoas além de bots, e a **memória de time** com revisão humana e consolidação periódica (o "dream").

## Decisão

1. **A vez** (`src/domain/vez-na-sala.ts`). Uma de cada vez; quem pede entra na fila uma vez só; pessoa passa na frente
   dos bots (a pessoa nunca espera bot); o bot tem 10 min para entregar (um turno longo cabe, um bot mudo não segura a
   sala) e perde a vez como `vencida`; pessoa na vez não tem prazo; quem sai da sala sai da fila e passa a vez. Isso vive
   AO LADO da rodada da ADR-027: a rodada diz quem deve responder; a vez diz quando cada um fala.
2. **Memória de time** (`src/domain/memoria-de-time.ts`). O bot propõe (memória, skill ou memória de pasta); nada entra
   sem uma pessoa do time aprovar; a proposta guarda quem propôs, de onde veio e quando, e a revisão, quem e quando.
   Proposta igual a uma memória que o time já tem (as mesmas palavras, em qualquer ordem) vira `duplicada` e não ocupa
   a fila.
3. **Consolidação ("sonho")**: no máximo uma vez a cada 24 h por time e só com memória nova, fora do turno, junta as
   memórias parecidas (Jaccard das palavras ≥ 0,8, a mesma família lexical do recall da ADR-136) e PROPÕE a fusão, que
   volta à mesma fila. Nunca apaga nada sozinha: as substituídas só saem se a pessoa aprovar a fusão.

## Próximo recorte

- Migrações aditivas com `nod_escopar_tabela`: `sala_vez` (estado da vez por sala), `memoria_time_revisao` (a fila) e
  `memoria_time` (o que foi aprovado, com perna `equipe` para leitura do time). Não entraram aqui: o Postgres desta
  máquina não estava de pé para o teste de ida e volta do rollback.
- Ferramentas do bot: `propor_memoria_do_time` (cartão na fila) e `pedir_vez` na sala; rotas e ações no registro com
  caminho no chat (NOD-392); o laço do sonho em `src/adapters/fundo/`, por `paraCadaPessoa`.
- Tela da fila de revisão em Ajustes > Time e o "Fala agora: …" no topo da sala.

## Gatilho de reversão

Se, em 30 dias de uso, mais de 70% das propostas do bot forem recusadas, a fila vira ruído: o bot passa a propor só no
fim de uma tarefa concluída (não a cada fala).

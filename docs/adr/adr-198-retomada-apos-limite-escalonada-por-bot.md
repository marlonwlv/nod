# ADR-198 — Retomada depois de uma pausa por limite escalonada por bot

Status: proposta (2026-11-26, pedido do dono) · Relacionadas: [ADR-102](adr-102-contas-da-pessoa-em-todas-as-maquinas.md)
(a cadeia e as contas no limite), [ADR-045](adr-045-queda-do-mac-vira-um-aviso.md) (o outro consumidor da mesma fila de
volta do fundo, NOD-309).

## Contexto

Em 17/11/2026 o dono decidiu escalonar a retomada dos bots do Nod depois de uma pausa por limite de cota: Gilda +0,
Hiring +5, Hub +10, Migração +15, KR5 +20, Avulso +25 minutos — para bots da mesma dona, cujas janelas de 5 h resetam
juntas, não acordarem todos no mesmo minuto. A decisão nunca foi aplicada em código; valia só como combinado. Em
26/11/2026, 09:32:43–09:32:59 BRT, 5 sessões (Gilda, PM-Hiring, PM-Hub, PM-Avulso e uma 2ª sessão da Gilda) voltaram de
pausa por limite num intervalo de 16 segundos, confirmando que nada no mecanismo de retomada aplica o escalonamento.

`aposLimiteNoFundo` (`src/use-cases/assentar-turno.ts`) acorda o bot exatamente na hora que o provedor informou
(`prazoDoLimite`/`prazoDoLimiteDaConta`, `src/domain/inteligencia.ts`), sem nenhum atraso entre bots. Essa hora
(`renovaEm`) é passada, sem alteração, a `enfileirarVoltaDoFundo` (`src/use-cases/volta-do-fundo.ts`) — uma primitiva
COMPARTILHADA por três cenários de retomada: pausa por limite de cota, nova tentativa depois de erro transitório do
provedor (NOD-309) e volta depois de uma queda de máquina. `scheduler-rotina.ts` (o agendador das rotinas) também não
tem nenhuma lógica de escalonamento — rotinas simplesmente não colidem porque cada uma tem seu próprio cron, o que não
é a mesma coisa que escalonar.

## Decisão

1. **O atraso é um campo novo por bot, não uma lógica de detectar colisão.** `agentes.atraso_retomada_min` (migração
   0198, `ADD COLUMN` nulo com `CHECK (atraso_retomada_min BETWEEN 0 AND 180)`) guarda os minutos que somam à retomada
   depois de uma pausa por limite. Ausente ou null = sem atraso, idêntico ao comportamento de hoje — mudança aditiva e
   retrocompatível, sem backfill.
2. **Aplicado só dentro de `aposLimiteNoFundo`, nunca em `enfileirarVoltaDoFundo`.** Como essa função é compartilhada
   pelos três cenários de retomada, somar o atraso ali atrasaria também a nova tentativa por erro transitório e a volta
   depois de queda de máquina — nenhum dos dois tem relação com a janela de 5 h da cota. O atraso é calculado uma vez,
   logo depois do `retomaTurnoId`, por uma função pura nova (`comAtrasoDeRetomada`, `src/domain/retomada-escalonada.ts`)
   e o `renovaEm` resultante substitui `p.renovaEm` em todo o resto da função: a comparação com a próxima execução da
   rotina, a entrada `voltaEm`, o `acordarEm` passado a `enfileirarVoltaDoFundo`, os eventos `turno_interrompido` e
   `turno_criado`, a frase da espera e o log.
3. **O atraso é fixo por bot, sempre somado, sem olhar os outros bots.** Em vez de detectar "este bot colidiria com
   outro agora", o bot sempre volta atrasado pelos minutos configurados — mais simples, puro, testável sem IO e sem
   corrida entre bots lendo a mesma janela.
4. **Os valores por bot (Gilda 0, Hiring 5, Hub 10, KR5 20, Avulso 25) são operacionais, fora desta PR.** Não há tela de
   ajuste ainda; os valores são gravados depois do merge direto por SQL com a nova coluna. Uma tela de ajuste é um
   item em aberto, não bloqueante para corrigir o bug.

## Alternativas descartadas

- **Detectar colisão entre bots da mesma dona e atrasar só quem colidiria.** Exigiria consultar os outros bots que
  também vão acordar perto da mesma hora, dentro da mesma transação que grava a retomada — mais IO, mais corrida,
  sem ganho real sobre um atraso fixo e sempre aplicado.
- **Aplicar o atraso dentro de `enfileirarVoltaDoFundo`.** Rejeitada: atrasaria também erro transitório (NOD-309) e
  queda de máquina, que não têm relação com a janela de 5 h da cota.
- **Hardcodar os nomes e minutos de cada bot na migração.** Rejeitada: a investigação não confirmou a existência de um
  bot "PM-Migração" no projeto atual, tornando a lista de nomes citada pelo dono em 17/11 não confiável para gravar
  às cegas numa migração; melhor deixar a atribuição de valores como passo operacional separado.

## Gatilho de reversão

- Se os valores por bot nunca forem configurados operacionalmente (coluna sempre null para todo bot) em 30 dias, o
  problema volta a existir na prática e o atraso fixo por bot não é suficiente — rever para uma tela de ajuste
  obrigatória no onboarding do bot, ou gatilho automático.
- Se o atraso fixo (sem olhar outros bots) ainda assim deixar duas sessões da mesma dona colidirem com frequência
  (ex.: duas pausas que entram na janela de 5 h em horas diferentes, mas cujos atrasos as reaproximam), rever a
  decisão 3 em favor de detectar colisão.

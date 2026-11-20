# ADR-186 — Mensagem nova interrompe a escrita do bot: uma regra do nod para todo harness

Status: aceita (2026-11-16, validação da preview) · Relacionadas:
[ADR-036](adr-036-harnesses-e-modelos.md) (harness × modelo), [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md)
(sessão viva), [ADR-185](adr-185-o-parar-nao-perde-o-que-a-pessoa-disse.md) (escrita na sessão não é lida).

## Contexto

Com o bot escrevendo uma resposta longa, a correção da pessoa ("na verdade, só 3 frases") só era lida no fim da resposta
inteira: escrita na sessão é lida na fronteira seguinte (o fim de uma ferramenta ou da resposta, ADR-185), e quem só
escreve não tem fronteira no caminho.

Comparação de 2026-11-16, mesmo roteiro: o app de referência leu a correção no meio e respondeu em 3 tópicos; o OpenBot
(com "Orientar", o padrão dele) terminou as 20 seções antes de responder; o bot-hq põe na fila. O que muda o rumo no meio
é **interromper a volta**, não entregar a mensagem: o `turn/steer` do Codex também só é lido depois do item em curso.

A regra precisa valer para N harnesses — Claude Code e Codex hoje; Cursor, Hermes e outros agentes por ACP depois — e
não pode morar em cada driver.

## Decisão

1. **Uma política do nod, pura** (`decidirMensagemNoMeio`, `src/domain/mensagem-no-meio.ts`). Entrada: o estado da volta e o
   que o harness sabe fazer. Saída: entregar ou interromper e entregar.
   - `escrevendo` (texto ou pensamento, sem ferramenta aberta nem trabalho em segundo plano), na conversa com a pessoa
     (`conversaComAPessoa`: `conversa` ou `criacao`, da faixa dela, fora dos bastidores), com `interrompeVolta`:
     **interrompe a volta e a mensagem abre a seguinte**. Uma vez por volta (a rajada não interrompe de novo).
   - `acao_aberta` / `segundo_plano` / `entre_voltas`, frente, rotina ou harness sem a capacidade: entrega e espera a
     fronteira (ADR-185) — nada fica pela metade.
2. **O estado da volta sai dos eventos normalizados** que todo driver já emite (`delta`, `tool_use`, `tool_result`,
   `tarefa_fundo`, `result`), num rastreador do laço do executor. Nenhum driver sabe o que é "escrita pura".
3. **O harness implementa só a primitiva** `interromperVolta()` (para a volta sem matar a sessão) e emite a volta cortada como
   fala própria marcada (`falaIntermediaria(texto, { interrompida: true })`), antes da resposta. O laço interrompe ANTES de
   entregar a mensagem.
4. **Capacidades medidas, não supostas**, em `CAPACIDADES_HARNESS` (o mínimo garantido; o driver pode completar na hora,
   como o ACP faria pelo `initialize`). Sonda reaproveitável: `scripts/sonda-mensagem-no-meio.ts`.
   - `interrompeVolta`: o harness para a volta e a sessão segue.
   - `parcialNoHistorico`: o texto cortado fica no histórico. Sem, a moldura da mensagem leva o começo dele
     (`TRECHO_DA_PARCIAL_MAX`), para o modelo saber o que já tinha escrito.
5. **Servidor e tela não sabem o harness:** a fala cortada é gravada `parcial` com `payload.kind = "fala_interrompida"`; a
   conversa mostra "Interrompido pela sua mensagem · hora", recolhida (o mesmo desenho do "Parado por você").

## Medições (2026-11-16)

| Harness | `interrompeVolta` | Parcial no histórico | Correção respondida (sonda) |
|---|---|---|---|
| Claude Code 2.1.326 (`control_request` interrupt) | sim, <100 ms | sim | 2,8 s |
| Codex 0.162.1 (`turn/interrupt`) | sim, 5 ms | **não** ("Não cheguei a escrevê-las") | 3,1 s |
| ACP (`session/cancel`, obrigatório no protocolo) | sim, por contrato — medir no driver | depende do agente | — |
| Cursor, Hermes (sem driver) | não | — | espera a fronteira / fila |

Ponta a ponta na 5280: Claude (Opus) — correção lida e respondida em 3 frases, texto cortado recolhido; o atraso foi a
entrega da mensagem ao laço (~6,5 s, a janela do "Cancelar" da fila). GPT-5.6 Luna — da correção à resposta em 3 s.

## Alternativas descartadas

- **Steer/Orientar** (entregar no meio sem interromper): medido no Codex e no OpenBot, não muda o rumo de quem só escreve.
- **Regra por driver:** cada harness novo reimplementaria a decisão; um teste de conformidade não cobriria.
- **Interromper com ferramenta aberta:** deixa efeito pela metade.
- **Perguntar à pessoa:** atrito justamente quando ela tem pressa.

## Gatilhos de reversão

- Respostas que perdem o fio depois do corte (o modelo não sabe o que escreveu) num harness marcado `parcialNoHistorico`:
  desligar a capacidade para ele (a moldura passa a levar o trecho).
- `laco_volta_interrompida_por_mensagem` seguido de turno que recomeça sem sessão mais de uma vez por semana: desligar
  `interrompeVolta` do harness até a sonda passar de novo.
- Custo por conversa sobe (interrupções em série): teto de interrupções por turno.

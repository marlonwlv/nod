# ADR-186 — Mensagem nova interrompe a escrita pura do bot

Status: **proposta** (2026-11-16, para leitura do dono antes de implementar) · Relacionadas:
[ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) (sessão viva),
[ADR-185](adr-185-o-parar-nao-perde-o-que-a-pessoa-disse.md) (escrita na sessão não é lida).

## Contexto

Com o bot escrevendo uma resposta longa, a mensagem nova da pessoa ("na verdade, só 3 frases") entra na sessão viva mas
só é lida na fronteira seguinte: o fim de uma ferramenta ou da resposta (ADR-185). Quando o bot está **só escrevendo**,
não há ferramenta no caminho, e a fronteira é o fim da resposta inteira: ele termina os 10 tópicos que ninguém quer mais
e só então responde à correção. Custa tempo, custa tokens e parece que o bot não ouve.

Comparação de 2026-11-16, com o mesmo roteiro nos três apps:

- **App de referência:** leu a correção no meio e respondeu "Fechado, aqui vai em 3 tópicos" — os 10 nunca saíram.
- **OpenBot** (com "Orientar", o padrão dele): a mensagem entrou na conversa, mas o agente terminou as 20 seções e só
  depois respondeu às 3 frases — a mesma limitação do nod.
- **bot-hq:** fila; a correção roda depois do turno inteiro.

## Decisão proposta

1. **"Escrita pura" é o estado em que nada pode ficar pela metade:** o turno da conversa (não frente, não rotina) está
   numa volta gerando texto ou pensamento, **sem ferramenta aberta** (nenhum `tool_use` sem o `tool_result`) e sem
   subagente ou comando em segundo plano. O driver do Claude já acompanha isso (`tool_use`/`tool_result`, `emFundo`).
2. **Mensagem nova durante a escrita pura interrompe a geração, não a sessão.** O driver manda ao CLI o pedido de
   interrupção da volta pelo stdin (`control_request` `interrupt` do stream-json, o mesmo que o SDK usa) — o processo e
   a sessão continuam. O CLI encerra a volta e lê em seguida a mensagem que já está no stdin; o bot responde com as duas
   à vista (a resposta parcial e a correção). Várias mensagens seguidas geram uma interrupção só.
3. **Com uma ferramenta aberta, nada muda:** a mensagem espera a fronteira (ADR-185), para não deixar um arquivo meio
   gravado ou um comando sem resultado.
4. **O texto que já tinha saído fica, marcado "parcial"**, como no Parar — é honesto e já custou. O selo da mensagem da
   pessoa passa a "Lida" na hora.
5. **Só o driver do Claude nesta rodada.** O Codex tem `turn/steer` nativo e segue como está; outro driver sem a
   interrupção de volta mantém a ADR-185.

## A medir antes de implementar

- Se o CLI da versão em uso aceita o `control_request` `interrupt` em `--input-format stream-json` e **mantém a sessão
  viva** depois (sonda como a de 2026-09-16, `mapa-cli`). Se não aceitar, a alternativa é encerrar o processo e retomar a
  sessão (`--resume`) com a mensagem nova — mais lenta (~2 a 5 s) e só se a sonda mostrar que a interrupção não existe.
- O que o modelo recebe depois da interrupção: se a resposta parcial entra no histórico (ela precisa entrar, senão o bot
  não sabe o que já escreveu).

## Alternativas descartadas

- **Esperar a fronteira sempre** (hoje): o problema descrito.
- **Interromper também com ferramenta aberta:** deixa efeito pela metade (arquivo, comando, mensagem enviada).
- **Perguntar à pessoa ("interromper?"):** atrito em toda correção, que é justamente quando ela tem pressa.
- **Botão "Orientar" na mensagem (OpenBot):** a pessoa teria de saber que existe; e o Orientar dele, no teste, não mudou
  nada enquanto o agente só escrevia.

## Gatilhos de reversão

- Respostas que "perdem o fio" depois da interrupção (o modelo não vê o que já tinha escrito): voltar a esperar a
  fronteira até a sonda achar como manter a parcial no histórico.
- Interrupção que derruba a sessão (o turno recomeça sem contexto) mais de uma vez por semana no log: desligar o corte.
- Custo por conversa sobe em vez de cair (interrupções seguidas que recomeçam a mesma resposta): pôr um piso de texto
  (ex.: só interromper depois de N tokens escritos) ou um teto de interrupções por turno.

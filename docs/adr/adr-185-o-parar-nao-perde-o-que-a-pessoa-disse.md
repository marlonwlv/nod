# ADR-185 — O Parar não perde o que a pessoa disse; escrita na sessão não é lida

Status: aceita (2026-11-16, validação da preview) · Relacionadas: [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md)
(sessão viva), [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) §6 (mensagem no meio), [ADR-184](adr-184-mensagem-nova-substitui-a-aprovacao-aberta.md).

## Contexto

Na validação, a pessoa mandou "na verdade, resume em 3 tópicos" com o bot escrevendo 10, e apertou Parar. A mensagem foi
absorvida pela sessão viva (ADR-067), mas o CLI só lê o que chega no stdin na **fronteira seguinte** (o fim de uma
ferramenta ou da resposta), e o bot estava só escrevendo. O Parar interrompeu o turno e a absorvida junto: o bot nunca a
leu, e nada na tela disse isso. O Parar também interrompia as falas que esperavam na fila atrás do turno.

Comparação feita no mesmo dia: o bot-hq e o OpenBot (pelo código) param só o turno que roda e deixam a fila rodar depois;
o app de referência não tem botão de Parar (para-se pedindo). Nenhum descarta uma mensagem sem um gesto da pessoa.

## Decisão

1. **Entrar na sessão não é ler.** O driver do Claude marca como lida a mensagem escrita no meio de uma volta só quando
   o CLI passa pela fronteira seguinte (`tool_result` ou `result`); a escrita entre voltas abre a volta seguinte e é lida
   na hora. O laço manda `informaLeitura: true` e `mensagensLidas` na renovação; o servidor grava
   `turnos.lido_na_sessao_em` (0177). App que não informa (versão antiga, Codex) tem a absorção gravada já lida, como antes.
2. **O Parar da conversa para o trabalho, não o que a pessoa disse.**
   - A fala absorvida e **não lida** volta a `pendente`, na ordem em que chegou, e roda depois como turno próprio.
   - Com um turno do chat rodando, a fala que **espera na fila** atrás dele fica `pendente` e roda depois.
   - Sem nada rodando, a fala na fila é o que a pessoa vê trabalhando (a máquina ligando) e o Parar a para, como antes.
   - O Parar global (sem conversa) segue parando tudo.
   - Descartar uma fala é o "Cancelar" da fila — sempre um gesto da pessoa.
3. **A conversa mostra o estado da fala absorvida** (`turnosNaSessao` no GET da conversa): "Entregue · {bot} lê ao fim do
   passo atual" enquanto não foi lida, "Lida" quando foi, nada quando o turno acaba. Sem Cancelar: ela já está na sessão.
   O evento `turno_lido` só faz a tela reler a conversa.

## Alternativas descartadas

- **Parar descarta tudo** (o comportamento de antes, e o que o OpenBot fez no teste real, contra o próprio código): perde
  o que a pessoa disse sem aviso.
- **Perguntar no Parar** ("parar também a sua mensagem?"): um clique a mais em todo Parar desse tipo, para um caso raro.
- **`--replay-user-messages`** (o eco do CLI com o `uuid`, que a ligação usa): mais preciso, mas muda o fluxo de eventos do
  chat; a fronteira basta para o Parar e fica como evolução se o selo errar.

## Gatilhos de reversão

- Resposta repetida depois de um Parar (a fala devolvida já tinha sido lida, e a leitura não chegou ao servidor antes do
  Parar): log de turnos devolvidos seguidos de resposta duplicada → trocar a fronteira pelo eco do CLI.
- A pessoa reclama de mensagem que "rodou sozinha" depois de parar: voltar a fala da fila (não a absorvida) a ser parada.

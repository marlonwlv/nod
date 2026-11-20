# ADR-184 — Mensagem nova da pessoa substitui a aprovação aberta, sem negar

Status: aceita (2026-11-16, item 10 dos acessos devolvidos da interface minimalista) · Relacionadas:
[ADR-042](adr-042-aprovacao-permanente-e-regra-nomeada.md) (fechar por regra nomeada),
[ADR-130](adr-130-a-fala-da-pessoa-nao-espera-os-bastidores.md) (a fala da pessoa não espera os bastidores).

## Contexto

No teste da preview, a pessoa pediu para apagar uma pasta, recebeu o cartão de aprovação e mandou mais três mensagens
sem clicar. Pelo banco, a 2ª mensagem foi absorvida pelo turno que estava parado no pedido (`rm -r`): o bot só a leria
depois do clique, e a conversa parecia travada. A primeira correção negava o pedido aberto quando a pessoa mandava
mensagem; o bot lia "a pessoa não aprovou" e tratava o pedido repetido como recusado, que não era o que ela quis dizer.

As duas referências fazem outra coisa: no app de referência o pedido antigo vira "Asked again below"; no bot-hq, "a new
message from the user supersedes whatever is waiting for their approval". Responder com outra fala não é dizer não.

## Decisão

1. **A mensagem nova numa conversa própria fecha as aprovações abertas da conversa por regra**
   (`regra:aprovacao_substituida`, v1, `substituirAprovacoesAbertas` na mesma transação do envio, depois de gravar a
   mensagem). Ninguém decide: `decidido_por` é o nome da regra (ADR-042 §4). Só aprovação: pergunta e pedido de acesso
   seguem o caminho deles.
2. **Nada roda.** Os itens saem desmarcados, com o desfecho `retirado_pela_pessoa`. A decisão é reivindicada como
   continuação do turno, para não virar retomada quando o turno assentar.
3. **O bot sabe que não foi recusa.** A rota interna responde `substituida: true`, e o hook do executor nega o comando
   com um motivo próprio (`SUBSTITUIDO_POR_MENSAGEM`, causa `substituido_por_mensagem`): a pessoa mandou outra mensagem,
   o comando não rodou, leia a mensagem nova e peça de novo se ainda precisar.
4. **Na conversa fica um recibo** "Sem resposta · <o pedido>" no lugar do cartão (`resultado_aprovacao` com
   `substituida: true`), e o campo de mensagem diz "Ou diga o que fazer em vez disso" enquanto há cartão aberto.

## Alternativas descartadas

- **Manter a mensagem na fila atrás do pedido** (o comportamento de antes): a conversa fica muda até o clique.
- **Negar o pedido aberto**: o modelo lê uma recusa que a pessoa não fez, e o mesmo pedido em seguida volta direto
  ao cartão como "já recusado".
- **Deixar os dois abertos** (o cartão antigo e a mensagem nova): o turno continua parado no pedido, e o problema é o
  mesmo da fila.

## Gatilhos de reversão

- O bot repete o mesmo pedido logo depois de cada mensagem curta ("ok?", "e aí?") e a pessoa reclama de cartões
  sumindo: pensar em só substituir quando a mensagem não for uma resposta ao pedido.
- Aprovação fechada pela regra que depois roda alguma coisa: os itens desmarcados não estão segurando, então a
  regra está errada e volta para "negar".

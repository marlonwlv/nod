# Recuperação do progresso no chat

A leitura autoritativa de uma conversa atualizava `despachadoEm`, mas não promovia um turno já conhecido de `na_fila` para `rodando`. Assim, mesmo com a resposta REST correta, o chip podia continuar na fila. O fallback periódico existente atendia o quadro, não o chat. Progresso recebido sem o frame inicial também não criava o turno necessário para desenhar a atividade.

Esta entrega promove a fila pelo snapshot REST, aceita atividade/delta como prova de despacho e protege turnos encerrados ou desmentidos contra frames atrasados. O chip diz apenas que aguarda o bot começar: não presume outro turno em execução. Lacunas na sequência ou mudança de stream pedem reidratação mesmo sem um erro do socket. Reconexão mantém o replay e a reconciliação existentes.

A cada 15 segundos, somente a conversa visível e com turno sem progresso pode pedir uma leitura GET. Uma leitura recente ou progresso recente adiam a próxima; sem turno vivo, a recuperação para. A fila de reidratação existente serializa as leituras. Não há POST de mensagem, novo turno, repetição de comando ou retry de efeito externo nesse caminho. O snapshot recupera estado e mensagens persistidas; texto efêmero que se perdeu e saiu do buffer não é reconstruído.

## Validação

Regressões cobrem despacho perdido, fim perdido, snapshot atrasado, atividade de computador sem frame inicial, replay após encerramento, mudança de stream, lacuna de sequência, deduplicação e limites da releitura. A prova de navegador usa o bundle real, HTTP/SSE reais e snapshots sintéticos por proxy de teste; nenhuma mensagem é enviada ao backend. O servidor continua recebendo ping durante a perda de despacho/fim, demonstrando que a recuperação não depende de declarar o transporte desconectado.

A observação anterior de publicação do outbox e resposta persistida não prova recepção pela aba. A causa de uma eventual perda original de bytes não foi atribuída ao túnel nem ao SSE; o defeito de reconciliação é reproduzível independentemente disso.

## Integração

A base inclui a navegação semântica por elementos e a correção do lint dos callbacks de navegador. A orientação de aprovação usa o gateway diretamente e mantém o caminho semântico como padrão, sem mudar autorização, controle humano ou tratamento de credenciais. Referências do prompt foram regeneradas e revisadas para essa combinação deliberada.

Foram examinados os diffs dos PRs 143, 144, 146, 147, 149 e 158. Eles tratam downloads, workspace de terminal, teto de arquivo, anotação de upload, erros de outras ferramentas e paginação de terminal. Nenhum é dependência da navegação por elementos ou da recuperação do chat aqui testada. Não foram integrados. Ações: nenhuma ação nova.

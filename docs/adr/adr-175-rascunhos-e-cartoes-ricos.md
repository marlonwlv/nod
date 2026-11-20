# ADR-175: Rascunhos de envio, cartões ricos e conduta da voz

Status: proposta (2026-11-12, frente "Assistente pessoal" a partir da pesquisa de referência; decisão do Marlon
"respostas ricas: tudo"). Usa a API de aprovação sem mudá-la (ADR-042, E4.3).

## Contexto

A ideia é mostrar cada mensagem que vai sair (e-mail, Slack, iMessage, chat de reunião) como um rascunho editável, com
Enviar/Descartar e uma barra "N rascunhos prontos · Descartar todos · Enviar todos ⌘↵"; e mostra voo, hotel, carro, mapa,
clima, carrinho e arquivo como cartões. No nod, o envio para fora já passa por `pedir_aprovacao` e vira um cartão genérico
"precisa do seu ok" com o texto do item; o resultado de uma busca vira texto corrido.

## Decisão

1. **Rascunho é LEITURA do item de aprovação, nunca um tipo novo.** `rascunhoDoItem` (src/domain/rascunho.ts) reconhece o
   envio pelo verbo da ferramenta (send/enviar/post/reply…; nunca draft, que só cria rascunho no app) e o canal pelo app
   e pela ferramenta (e-mail, Slack, iMessage, SMS, chat), e tira Para (com Cc/Cco prefixados: nada de fora escondido),
   Assunto e corpo dos argumentos. `listar-sua-vez` o calcula a cada leitura (como a `fraseDaAcao`), sem coluna nova.
2. **O corpo só é editável quando é o texto do item.** A edição chega ao argumento pela regra de sempre
   (`argumentosComTextoFinal`, E4.3). A descrição de `pedir_aprovacao` pede o corpo exato em `texto` e uma mensagem por
   item. Corpo diferente aparece fixo, com a dica de descartar e pedir de novo.
3. **Enviar e Descartar são o `decisoes/:id/decidir` de sempre.** Decisão de um item: os botões do cartão fecham a
   decisão. Vários itens: Descartar só desmarca (a decisão é atômica, e enviar metade deixaria a outra sem resposta) e o
   envio é pela barra. A barra aparece com 2+ rascunhos na conversa; "Enviar todos" decide cada decisão com o texto das
   caixas; "Descartar todos" manda tudo desmarcado (`itensDaRecusa`, nunca `itens: []`). ⌘↵ (Ctrl+↵ fora do Mac) vale com
   o foco num rascunho ou com o campo de mensagem vazio, nunca com texto digitado. Só na conversa; "Sua vez" segue com o
   cartão de aprovação.
4. **Cartões ricos por `mostrar_cartoes`**, ferramenta do nod na conversa, criação e rotina: uma fala `texto` com o resumo e
   uma linha por cartão (para quem não desenha) e o payload `cartoes`. `normalizarCartoes` (src/domain/cartoes-ricos.ts)
   limpa: texto sem invisíveis e cortado, número no intervalo, data no formato, dinheiro em centavos com moeda, link só
   https sem usuário. A web desenha sem carregar nada de fora: o mapa é SVG dos pontos (sem tiles), com "Abrir no Mapas".
   A fala leva a confiança do turno.
5. **Conduta da voz** (AGENTE.md §4 "Voz"): linha "Conduta:" no prompt da ligação — mesma pessoa no trabalho e na voz,
   resultado de trabalho é evidência, não fala nome de ferramenta/id/caminho, pedir de novo é a mesma tarefa, conversa
   fiada sem ferramenta, não pede confirmação do que já foi pedido, só a despedida encerra. Na primeira ligação
   (onboarding) a regra de não se oferecer para desligar sai, porque o roteiro pergunta se pode desligar.

## Gatilho de reversão

- Se a pessoa editar o corpo e o bot continuar mandando `texto` diferente do corpo (rascunho fixo em mais de metade dos
  casos), o caminho é carregar o campo editado no item (`argumentoEditavel`), o que muda a API de aprovação: decidir junto
  com quem cuida dela.
- Se `mostrar_cartoes` for pouco usado pelo modelo, a alternativa é o conector devolver o cartão junto do resultado e o
  servidor gravar a fala sozinho.

## Porte (NOD-485)

Tudo aqui é núcleo e vai para o público (`marlonwlv/nod`): domínio, web, contratos e a ferramenta.

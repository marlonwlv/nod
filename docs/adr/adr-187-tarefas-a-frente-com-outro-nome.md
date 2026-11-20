# ADR-187 — Tarefas: a frente com outro nome, em tela cheia, e o quadro como plugin à parte

Status: aceita (2026-11-17, validação da preview) · Emenda a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md)
(o nome na tela e a rede de 2 min), [ADR-099](adr-099-um-dono-por-bot.md) (frentes) e
[ADR-159](adr-159-a-tarefa-e-a-casa-do-trabalho.md) (o nome "tarefa") · Relacionadas:
[ADR-120](adr-120-previa-de-arquivo-no-navegador.md) (prévia de arquivos), [ADR-163](adr-163-tarefa-do-quadro-e-trabalho.md) (tarefa
do quadro), [ADR-185](adr-185-o-parar-nao-perde-o-que-a-pessoa-disse.md) (o Parar), [ADR-186](adr-186-mensagem-nova-interrompe-a-escrita.md)
(mensagem no meio). Protótipo: arquivo "nod · Chat e conversa" do Paper, página "Item 4 · Tarefas — escolhas (página
única)"; as alternativas descartadas ficam na página "(descartado) Item 4 · tarefa em painel e mídia no painel".

## Contexto

A tela usava quatro palavras para "algo que o bot está fazendo por mim": frente, task, tarefa e trabalho (contadas em
2026-11-17 nos textos da web: frente 125, task 87, tarefa 323, trabalho 239). A rodada de validação de 2026-11-17 (o
mesmo bot, três roteiros: texto longo, código em três arquivos, duas pesquisas em paralelo, cada um com "quanto é dois
mais dois?" no meio) mostrou também um defeito: quando a rede de 2 min promove o turno da conversa a frente, as falas
que o bot já tinha dito naquele turno, inclusive a resposta à pergunta à parte, passam a ser da frente e somem da
conversa.

Comparação com três apps de referência no mesmo dia (pelo código): o app de referência separa arquivo (abre num palco
ao lado e baixa) de artefato (página viva, editável); imagem e vídeo abrem em tela cheia nele e no OpenBot; o bot-hq não
tem visualizador.

## Decisão

1. **Uma palavra na tela: tarefa.** Frente, task e o menu "Trabalhos" viram tarefa e "Tarefas". O código continua
   `trabalhos` (e `forma = 'frente' | 'task'`); os nomes das ferramentas do modelo (`abrir_frentes`, `mandar_para_frente`,
   `abrir_task`) não mudam agora — trocar exige medir antes e depois. Dentro do quadro, o item que a tela chamava de
   "tarefa" passa a se chamar "card", para a palavra não ter dois sentidos.
2. **Nada muda na coordenação.** A conversa continua recebendo "Trabalhos em andamento" e decidindo se uma mensagem é
   para uma tarefa (`mandar_para_frente`); falar dentro da tarefa vai direto a ela; o resultado volta à conversa.
3. **A rede de 2 min promove dali para a frente.** As falas do bot ditas no turno ANTES da promoção ficam na conversa;
   só as de depois são da tarefa. A pergunta à parte respondida antes da promoção não some mais. E a fala da pessoa que
   o turno absorveu e o bot ainda não leu (ele esperava um subagente ou um comando) volta à fila da conversa na
   promoção, como no Parar (ADR-185): o turno largou a faixa da conversa, e ela responde já. O texto já foi escrito na
   sessão, então a sessão da tarefa recebe junto um aviso do nod ("a conversa já respondeu a «…»; siga só com o pedido"),
   cru, sem a moldura de fala da pessoa — sem ele, a tarefa respondia de novo e a resposta chegava à conversa com a entrega
   (validação de 2026-11-17: "2 + 2 = 4." no começo do texto da pesquisa). E a rede não espera
   os 2 min quando uma fala da pessoa absorvida está há 8 s sem leitura (`REDE_NAO_LIDA_MS`): o bot está preso num
   subagente ou num comando, e a conversa larga o pedido e responde já (na validação, "quanto é dois mais dois?" esperou
   80 s; com 15 s de limite, 24 s). Só vale com o app que informa a leitura.
4. **O quadro é um plugin que usa o nod, nunca o contrário.** A tela Tarefas não conhece o quadro; uma tarefa aberta por um
   card mostra só a origem ("do Quadro"), como mostra "da rotina". Ligar card e tarefa na tela fica para quando o plugin
   for separado.
5. **Na conversa:** a pílula presa ao campo nunca some (sem tarefas, "+ Nova tarefa ⌘N") e um cartão vivo por pedido
   (com várias tarefas, barra de progresso e uma linha por tarefa; acima de cinco, chips). A dica que explicava as tarefas
   uma vez por pessoa saiu na validação de 2026-11-18: poluía a conversa, e a aba se explica sozinha.
6. **A tarefa abre em tela cheia, com abas** — só das tarefas que a pessoa abriu; "+" na fileira abre uma tarefa nova;
   as ações da tarefa ficam na própria aba (hover ou foco, clique direito, duplo clique renomeia). Dentro da tarefa, a
   conversa é detalhada (pedido, passos, o que roda agora); o campo tem tudo do campo da conversa, e "Parar" fica nele, no
   lugar de enviar, com a regra da ADR-185 (o recado não lido não se perde).
   **Modo pílula × modo abas** (validação de 2026-11-18, Paper 10b e 10c A): da Conversa não dava para voltar às abas, e
   elas fechavam sozinhas. Agora há dois modos por bot, lembrados no navegador. No modo pílula, a Conversa é a de sempre
   mais o botão de abas ao lado da pílula do bot (só o ícone; o ponto quando alguma tarefa precisa da pessoa; quantas e em
   que estado diz a pílula do campo). Abrir uma tarefa ou o botão liga o modo abas: a fileira fica no topo também na
   Conversa, numa linha só, e começa pela própria pílula do bot, que é a aba da Conversa (a pílula do campo some: uma lista
   por vez). Só "Fechar abas", no fim da fileira (ou Esc nela), volta ao modo pílula, sem parar nenhuma tarefa. Nenhuma aba
   fecha sozinha: a feita fica com o ✓ até a pessoa tirá-la (o menu da aba ou "Tirar as feitas das abas"); a que precisa da
   pessoa nunca fica escondida em "N outras". Nas outras páginas do bot (Quadro, Canvas, apps) a fileira se esconde e o
   botão de abas volta, com o número. Tarefa não é página: não conta no limite de 12 nem usa ⌥← / ⌥→. Abas e modo são
   forma de ver, guardados só no navegador (como as abas antes); não ganham ação no registro nem caminho pelo chat.
7. **Nova tarefa pela pessoa:** ⌘N (Alt+N fora do Mac; Ctrl+N no navegador do Mac) abre uma tarefa com o chat limpo;
   novo bot passa para ⌘⇧N. "Levar o contexto da conversa" é opcional.
8. **Tela Tarefas:** abre em "Por bot"; "Por estado" é a outra visão.
9. **Arquivos:** imagem e vídeo abrem em tela cheia, como hoje; os outros tipos abrem num painel ao lado (Markdown,
   código, tabela, PDF, Word, HTML isolado; o resto, "Abrir no app" e "Baixar"). Texto que é o produto (artigo,
   relatório, roteiro) chega como .md; resposta fica na mensagem.

As decisões 5 a 9 entram por etapas, cada uma validada na preview antes da seguinte; esta ADR registra o destino.

Lote B (decisões 5 a 8) entregue na preview em 2026-11-18, em seis passos (a aba presa ao campo, a tarefa aberta pela
pessoa, as abas em tela cheia, a conversa detalhada com o Parar no campo, a tela Tarefas e o cartão vivo). Junto, o
**aviso da máquina** (protótipo 4t, opção A): ao lado da aba, um selo diz o problema e a máquina pelo nome ("Pouca
memória em nod-vm", "Processador no limite em …", "Sem espaço em …"), só quando as tarefas daquele bot rodam nela (ou
são seguradas por ela); o clique abre Máquinas na linha dela. Substitui o ponto âmbar sem texto, que só olhava o Mac e,
no disco, qualquer máquina. A decisão 9 (arquivos) é o lote C.

## Alternativas descartadas

- **Tarefa num painel ao lado da conversa:** mais leve para responder, mas a pessoa preferiu tela cheia com abas.
- **Abas sempre à mostra na conversa** e **sem abas (só um seletor no título)**: a primeira polui toda conversa; a segunda
  pede dois cliques para trocar entre tarefas acompanhadas.
- **A nova tarefa levar a conversa por padrão:** contexto pesado e contradiz o chat limpo.
- **Tarefa e card do quadro como uma coisa só:** o quadro vira plugin e não pode ser dependência do núcleo.

## Gatilhos de reversão

- Tarefas abertas pelo bot caem depois da troca de nome (o modelo confunde "tarefa" na fala com a ferramenta de frente):
  medir a taxa de `abrir_frentes` por pedido longo antes e depois da etapa 1.
- A rede de 2 min passa a deixar na conversa uma fala que era do trabalho (texto longo do resultado aparecendo nas duas
  telas): voltar a promover o turno inteiro e separar a resposta à parte de outro jeito.
- Pedidos curtos viram tarefa à toa porque a pessoa escreveu no meio (a promoção pela fala não lida passa a abrir
  tarefa em pedido que terminaria em menos de 1 min): subir `REDE_NAO_LIDA_MS` ou exigir um tempo mínimo de turno.
- A tarefa ainda responde a fala devolvida apesar do aviso (o modelo ignora o "[aviso do nod]"): tirar a fala da sessão
  antes de ela ser lida, o que hoje nenhum harness permite, ou filtrar a resposta na entrega.

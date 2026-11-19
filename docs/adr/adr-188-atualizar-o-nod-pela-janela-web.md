# ADR-188 — Atualizar o nod pela janela web: o cartão que enche ao clicar e Sobre o nod

Status: aceita (2026-11-18, validação da preview) · Emenda o item 6 da
[ADR-149](adr-149-atualizacao-automatica-do-app-do-mac.md) ("sem faixa na web") e dá um interruptor ao reinício com o Mac
ocioso da [ADR-173](adr-173-o-nod-no-mac-quick-chat-e-ferramentas-do-mac.md) · Relacionada: a regra de paridade da
[ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (aqui sem ação nova; ver "No chat"). Protótipo: o arquivo do Paper da
frente da preview, página "Atualizar o nod · opções" (escolhidas: A3 + D + E; descartadas: B, C e o vidro do A2).

## Contexto

Desde a ADR-149 o app do Mac baixa a versão nova sozinho, mas o único jeito de usá-la era achar **Reiniciar para atualizar**
no menu nod, clicar numa notificação que some, ou esperar o reinício com o Mac ocioso (ADR-173). Na validação de
2026-11-18 o dono disse que atualizar "está bem escondido": quem passa o dia na janela do nod nunca abre o menu nativo.

## Decisão

1. **A web mostra a atualização** quando roda dentro do app do Mac. A ponte `window.nodDesktop.atualizacaoApp`
   (`src/contracts/desktop-atualizacao.ts`) entrega o estado e recebe quatro pedidos (reiniciar, procurar, o interruptor e
   "aviso visto"). Quem procura, baixa e reinicia continua sendo o processo principal (`desktop/atualizacao.ts`), que
   valida cada pedido de novo (`desktop/atualizacao-na-tela.ts`). No navegador, no Quick Chat e nos avatares na mesa,
   nada aparece.
2. **O cartão "Atualizar o nod" no pé da barra**, só com a versão pronta. O cartão é o botão: **um clique** e a tinta sobe
   sozinha de baixo para cima em 800 ms, com a superfície ondulando (o líquido do + da barra); cheia, o cartão vira o
   spinner e o pedido de reinício sai. Enter e Espaço fazem o mesmo (é um botão comum). O protótipo (A3) pedia segurar
   para encher; na validação de 2026-11-18 o dono gostou da animação, mas achou que segurar confundiria quem só clica:
   o gesto é o de sempre e a animação continua contando o que vai acontecer.
3. **Reiniciar nunca derruba trabalho sem perguntar** (o item 7 da ADR-149 continua): com bot trabalhando no Mac ou tela
   aberta no computador do bot, o cartão vira a pergunta **Reiniciar quando terminar** (o app espera o último turno e
   reinicia sozinho), **Reiniciar agora** ou **Cancelar**; em ligação, recusa. A pergunta mora na própria tela, e não
   mais na caixa nativa, quando o pedido vem da web (`reiniciar(true)` no coordenador); o menu e a notificação seguem com
   a caixa nativa.
4. **Configurações › Sobre o nod** (antes de Feedback, que continua por último): a versão, o estado (pronta, baixando,
   procurando, em dia, erro, desligada com o motivo), **Reiniciar agora**, **Procurar agora** com a hora da última
   procura e o interruptor **Reiniciar sozinho quando você sair**, que liga e desliga o reinício com o Mac ocioso da
   ADR-173 (nasce ligado, como era).
5. **Depois do reinício**, o app compara a versão com a última que abriu (`preferencias.json`, `ultimaVersao`) e a web
   mostra uma vez "nod atualizado para a x.y.z", com Ver (abre Sobre o nod).
6. **Simulação para testar** sem publicar: `NOD_SIMULAR_ATUALIZACAO=<versão>` no app rodando do código
   (`desktop/atualizacao-simulada.ts`). Acha a versão em 1,5 s, "baixa" em 4 s, e o reinício grava a versão prometida e
   relança. O app empacotado nunca liga a simulação. No navegador, só em 127.0.0.1/localhost, `?simular-atualizacao=<versão>`
   (e `&simular-ocupado=1` para a pergunta) faz o papel do app (`web/lib/atualizacao-simulada-web.ts`); o "reinício"
   recarrega a página.

7. **Também no Windows**, com a mesma ponte (`windows/preload-web-windows.ts`) e as mesmas regras
   (`desktop/atualizacao-na-tela.ts`). Lá o motor roda fora do app: reiniciar não interrompe bot nenhum, então não há
   pergunta nem "quando terminar", e o Windows não tem o reinício com o computador parado (o interruptor some). A última
   versão aberta fica em `userData/ultima-versao.txt`, para o aviso "nod atualizado".

Fora de escopo: as notas da versão ("O que muda na 1.0.4" do protótipo D), porque o feed manda `notes` vazio (por
enquanto "Novidades" abre Sobre o nod); a barra de progresso (o reinício leva segundos e quase tudo acontece com a
janela fechada, então uma barra mentiria).

## No chat

Nenhuma ação nova: reiniciar o app é uma ação da máquina pela ponte IPC, sem rota de pessoa (ADR-135 §1); o estado é
de tela.

## Alternativas descartadas

- **Ponto no avatar + item no menu da conta (B)**: continua a um menu de distância; é o problema de hoje com outro menu.
- **Aviso flutuante acima do campo (C)**: chama atenção, mas disputa espaço com a conversa e some quando a pessoa fecha.
- **Segurar para encher (A3 do protótipo)**: encher seria a confirmação, mas quem clica normalmente não descobre o gesto
  (decisão do dono na validação). A pergunta continua aparecendo quando há bot trabalhando, que é quando ela importa.
- **Botão "Reiniciar" comum no cartão + caixa de confirmação sempre**: um "tem certeza?" a cada atualização, mesmo sem
  nada rodando.
- **Vidro líquido no hover (A2)**: bonito, mas não ensina nada; o líquido que enche depois do clique diz o que vai acontecer.

## Gatilhos de reversão

- Alguém reiniciar sem querer pelo cartão (um clique de passagem fechar o app sem bot trabalhando): volta a pedir
  confirmação sempre, ou ao segurar.
- O cartão aparecer fora do app do Mac, ou uma janela de outra origem conseguir pedir o reinício (a ponte vazou).
- O aviso "nod atualizado" aparecer sem atualização (a comparação de versão errou) mais de uma vez.

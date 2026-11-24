# ADR-193 — O bot usa o computador da pessoa: Mac e PC pelo cua-driver, app por app, sempre à vista

Status: proposta (2026-11-23, frente "Navegador, computador e seu Mac") · Terceiro dos três lugares decididos em
2026-11-19, depois da [ADR-190](adr-190-o-navegador-do-bot.md) (navegador) e ao lado da
[ADR-037](adr-037-computadores-por-bot.md) (computador do bot) · Substitui o item 7 da
[ADR-173](adr-173-o-nod-no-mac-quick-chat-e-ferramentas-do-mac.md) (controle de tela por JXA) e mantém o resto dela
(ferramentas do Mac, Quick Chat) · Usa a [ADR-026](adr-026-a-marca-de-nao-confiavel-e-propriedade-do-conteudo-carre.md)
(conteúdo não confiável), a [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (paridade) e a
[ADR-177](adr-177-dinheiro-e-segredos-sem-o-bot-ver.md) (segredos) sem mudá-las.

## Contexto

Em 2026-11-19 o Marlon decidiu que o nod terá três lugares para o bot trabalhar: o navegador do bot, o computador do
bot e o computador da pessoa. Ele recusou adiar o terceiro. O navegador entrou em produção em 2026-11-23 (PR #243).

Hoje o nod já mexe na tela do Mac (ADR-173, item 7): print com `screencapture`, clique por CoreGraphics via JXA e teclado
pelo System Events. É foto e coordenada, só no Mac, sem árvore de elementos, sem ação em segundo plano, sem nada na tela
mostrando que o bot está ali e com a permissão valendo para todos os bots e todos os apps.

As referências (estudo "Onde o bot trabalha", 19/11; leitura do código em 23/11):
- **nightly-labs/openbot** (v0.77, licença PolyForm Noncommercial: só para estudar) e **OpenMausBot** (v0.1.178,
  Apache-2.0) usam o mesmo motor, o **cua-driver** da trycua: Rust, MIT, macOS e Windows suportados, notarizado no Mac
  e assinado (Authenticode) no Windows. Ele vê pela árvore de acessibilidade (AX no Mac, UI Automation no Windows) e
  pela imagem da janela, e age por uma escada: no elemento sem foco, por pixel em segundo plano, por CDP e, por último,
  em primeiro plano devolvendo o foco. Cada resposta diz se o efeito foi confirmado.
- Os dois embutem o binário no app Electron, com versão e hash fixos, iniciado pelo processo principal com
  `CUA_DRIVER_EMBEDDED=1`, para o macOS atribuir as permissões ao app hospedeiro. Os dois desenham o próprio cursor e
  contorno. O OpenMausBot pede "Permitir uma vez" por turno, com o nome do app saneado e sem "sempre permitir".

As telas estão no Paper, arquivo "nod · Chat e conversa", página "Seu computador · a Ada usa seu Mac ou PC" (S1–S5),
e na página de detalhes (E5 e D9, de 19/11).

## Decisão

1. **Um lugar novo, "Seu Mac" ou "Seu PC".** Ele vive no app desktop do nod, no Mac e no Windows, e só existe com o
   app aberto e a pessoa logada na sessão gráfica. Nunca roda no servidor nem no computador do bot. Para a pessoa, o
   nome é o do aparelho (`textosDoAparelho` da ADR-190): "seu Mac" ou "seu PC".

2. **Motor: o cua-driver, embutido, com versão e hash fixos.** É o binário oficial (`cua-driver-rs`), uma versão por
   release do app, com o sha256 conferido no build. Fica fora do ASAR e é iniciado pelo processo principal do Electron,
   nunca por `open` nem pelo instalador oficial. No Windows, o instalador cria uma tarefa de logon elevada, que não
   queremos. Variáveis: `CUA_DRIVER_EMBEDDED=1`, `CUA_DRIVER_HOST_BUNDLE_ID` com o id do app do nod, telemetria e
   atualização desligadas. Arquitetura:
   - um daemon `serve --socket --no-overlay` por sessão do app (socket em diretório 0700 no Mac, pipe com nome
     aleatório no Windows);
   - o proxy MCP de cada turno fala com ele pelo mesmo caminho dos conectores locais (ADR-176);
   - a extensão `cua-perception` (AGPL) fica de fora.

3. **O driver roda em modo `bounded`, com o manifesto feito dos apps que a pessoa liberou para aquele bot.** Nunca em
   `unrestricted`. O escopo é por bot e por app (bundle id no Mac, caminho do executável assinado no Windows), nunca "o
   computador inteiro". App fora do manifesto: a ação é recusada e o bot faz um novo pedido no chat.

4. **O pedido no chat é o portão.** O cartão "A {bot} quer usar seu Mac" (S1) traz o app, o motivo em uma linha e três
   saídas:
   - "Permitir desta vez": vale até o fim daquela tarefa;
   - "Sempre no {app}": fica em Ajustes › Seu Mac, revogável com "Tirar";
   - "Agora não".
   
   O texto é montado pelo servidor. O nome do app vem do sistema (bundle ou executável), nunca do modelo, para o bot não
   conseguir escrever uma frase no cartão. Responder do celular ou da web vale. A ação só acontece com o app desktop
   aberto; sem ele, a linha diz "Abra o nod no Mac".

5. **Permissões do sistema uma vez, guiadas.** No Mac, Acessibilidade e Gravação de Tela, do app nod (S1, painel).
   O nod percebe sozinho quando a pessoa liga, sem reiniciar. Enquanto falta uma, o bot espera e diz qual falta. O macOS
   volta a pedir a Gravação de Tela de tempos em tempos, e o painel trata isso como o mesmo passo. No Windows não há
   permissão de sistema: o portão é só o pedido do item 4.

6. **Sempre à vista, nunca disputando o mouse.**
   - Na tela da pessoa: o overlay é do nod (por monitor, porque o do driver só cobre o principal). Borda âmbar só na
     janela do app liberado, cursor desenhado com o nome do bot e uma ilha no topo ("Ada está usando seu Mac · Numbers ·
     4 de 6 · Parar"). Na barra de menus (Mac) ou perto do relógio (Windows), o ponto âmbar com "Parar".
   - Em segundo plano por padrão: o bot sobe a escada do driver e só usa primeiro plano quando nada mais funciona,
     devolvendo o foco em seguida.
   - Se a pessoa mexe no mesmo app, o bot pausa ("Pausada porque você mexeu", com Continuar) e retoma após 10 s parado.
   - Bloquear a tela ou Parar (ilha, barra, chat, pílula) encerra na hora e o bot conta onde parou.
   - No nod: a aba "Seu Mac" do painel mostra a imagem da janela a cada ação (não é transmissão contínua) e os passos
     com hora (S4). A pílula repete o estado.

7. **O que fica fora, sempre.**
   - Janelas elevadas no Windows (UAC, "Executar como administrador") e diálogos de segurança do macOS: o driver não
     alcança e o bot pede que a pessoa faça aquela parte.
   - Senhas: o bot nunca digita senha num app da pessoa. O cofre (ADR-177) só preenche no navegador do bot; num app
     nativo, a pessoa digita.
   - Apps que não entram nem com "Sempre": Ajustes do Sistema e Painel de Controle, gerenciadores de senha (Keychain,
     1Password, Bitwarden), Terminal, PowerShell e o próprio nod.

8. **A aprovação do nod continua no ponto sem volta.** Enviar, excluir, pagar e publicar num app da pessoa pedem a
   aprovação de sempre (como no navegador, ADR-190, Paper "A"), mesmo com "Sempre no {app}". O conteúdo da tela é dado
   não confiável (ADR-026): uma instrução escrita num e-mail aberto nunca vira ação.

9. **Onde vale.** Na fase 1, só em conversa com a pessoa: rotinas e subtarefas não usam o computador da pessoa. O bot
   escolhe o lugar nesta ordem: conector, navegador, computador do bot e, por último, o computador da pessoa. Ele nunca
   sobe para a tela da pessoa sem o cartão.

10. **Registro.** Cada ação vira uma linha na trilha: bot, app, ação, alvo, efeito (`confirmed`, `unverifiable` ou
    `suspected_noop`) e hora. Ajustes › Seu Mac mostra o histórico com "Ver passos" (S5). As imagens da tela ficam só
    durante a tarefa e não vão para o histórico. O fim vira uma linha na conversa. Não existe "Desfazer": o nod não
    garante desfazer num app da pessoa.

11. **Ferramentas para o bot.** O catálogo é enxuto, com os nomes do nod sobre as do driver: `computador_ver` (árvore
    e imagem da janela), `computador_clicar`, `computador_digitar`, `computador_tecla`, `computador_rolar`,
    `computador_arrastar`, `computador_abrir_app`, `computador_menu` e `computador_apps`. O `run_script` do driver fica
    de fora. As cinco `tela_*` da ADR-173 saem quando estas entrarem.

12. **Paridade (ADR-135).** No registro de ações entram `seu_computador.permitir`, `.parar`, `.tirar_app` e
    `.tirar_tudo`, cada uma com caminho no chat ("para de usar meu Mac", "tira o Numbers da Ada").

## Alternativas recusadas

- **Manter o JXA da ADR-173.** É foto e coordenada, só no Mac, e rouba o mouse. Gatilho de reversão: o cua-driver
  quebrar a API entre versões a ponto de travar o release do app.
- **Escrever um driver próprio** (ScreenCaptureKit e AX no Mac, UI Automation no Windows). É o mesmo trabalho que a
  trycua já mantém, com notarização e assinatura. Gatilho: a licença ou a assinatura do cua-driver mudar.
- **O instalador ou o MCP global do cua-driver.** Cria uma tarefa elevada no Windows (houve conflito com anti-cheat) e
  dá a permissão do Mac a outro processo.
- **"Sempre" sem escopo, ou o computador inteiro de uma vez.** O escopo por app é o que deixa o modo `bounded` proteger
  de verdade.
- **Copiar o código ou o prompt do OpenBot.** A licença dele é não comercial: só estudamos o comportamento.

## Em aberto (fica para o aceite)

- A assinatura no Mac: manter a da trycua (como o OpenBot) ou reassinar com a do nod (como o OpenMausBot). A
  diferença é se o entitlement de Automação se mantém. Decidir no primeiro build notarizado.
- Multi-monitor e DPI misto no Windows (clique no segundo monitor e coordenadas negativas têm issues abertas).
- Apps Electron no Windows recusam digitar e rolar em segundo plano: nesses, o bot vai para primeiro plano, e isso
  aparece na ilha.
- Linux da pessoa: fora da fase 1.

## Gatilhos de reversão

- Mais de uma reclamação por semana de "o bot mexeu no meu mouse" ou de foco roubado: primeiro plano só com
  confirmação na ilha.
- Pedidos de rotina que precisam de um app da pessoa (Excel, app interno) aparecendo com frequência: rotinas passam a
  usar apps marcados com "Sempre", com o Mac ligado.
- O modo `bounded` não segura um app (o bot alcança uma janela fora do manifesto): desligar o lugar até corrigir.

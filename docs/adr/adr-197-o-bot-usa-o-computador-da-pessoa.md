# ADR-197 — O bot usa o computador da pessoa: Mac e PC pelo cua-driver, app por app, sempre à vista

Status: aceita (2026-11-26, pedido do dono: "garantir que o nod tenha acesso ao computador da pessoa", com release) ·
Frente "Navegador, computador e seu Mac" · Terceiro dos três lugares decididos em 2026-11-19, depois da
[ADR-190](adr-190-o-navegador-do-bot.md) (navegador) e ao lado da [ADR-037](adr-037-computadores-por-bot.md)
(computador do bot) · Substitui o item 7 da [ADR-173](adr-173-o-nod-no-mac-quick-chat-e-ferramentas-do-mac.md) (controle
de tela por JXA) e mantém o resto dela · Usa a [ADR-026](adr-026-a-marca-de-nao-confiavel-e-propriedade-do-conteudo-carre.md)
(conteúdo não confiável), a [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (paridade) e a
[ADR-177](adr-177-dinheiro-e-segredos-sem-o-bot-ver.md) (segredos) sem mudá-las. Proposta primeiro como "ADR-193" (PR #318,
2026-11-23); o número foi ocupado pelo painel de uso e ela entra como 197, com o que a implementação decidiu.

## Contexto

Em 2026-11-19 o Marlon decidiu que o nod terá três lugares para o bot trabalhar: o navegador do bot, o computador do
bot e o computador da pessoa. O navegador entrou em produção em 2026-11-23 (PR #243). Desde 2026-11-25 (PR #337) o
computador do bot só mora em máquina Linux; no Mac e no Windows da pessoa o bot tinha só o navegador.

Antes desta ADR o nod mexia na tela do Mac pelo item 7 da ADR-173: print com `screencapture`, clique por CoreGraphics via
JXA e teclado pelo System Events. Era foto e coordenada, só no Mac, sem árvore de elementos, tomando o mouse da pessoa,
sem nada na tela mostrando o bot e com a permissão valendo para todos os bots e todos os apps.

As referências (estudo "Onde o bot trabalha", 19/11; leitura do código em 23/11; os apps instalados neste Mac em 26/11):
- **nightly-labs/openbot** (licença PolyForm Noncommercial: só para estudar) e **OpenMausBot** (Apache-2.0) usam o mesmo
  motor, o **cua-driver** da trycua: Rust, MIT, Mac e Windows. Ele vê pela árvore de acessibilidade (AX/UI Automation) e
  pela imagem da janela, e age em segundo plano, sem mover o cursor da pessoa. Os dois embutem o binário no app
  Electron (OpenBot 0.52.9 com a assinatura da trycua; OpenMausBot 0.45.4 reassinado com a conta dele) e o sobem como
  filho do app (`serve --embedded --parent-liveness-stdio`), para o macOS atribuir as permissões ao app hospedeiro.

Telas no Paper, arquivo "nod · Chat e conversa", página "Seu computador · a Ada usa seu Mac ou PC".

## Decisão

1. **Um lugar novo, "Seu Mac" ou "Seu PC".** Existe só com o app do nod aberto na sessão gráfica da pessoa: no Mac, o
   app desktop; no Windows, o motor (que roda na sessão interativa, tarefa AtLogOn sem elevação). Para a pessoa, o nome
   é o do aparelho: "seu Mac" ou "seu PC".

2. **Motor: o cua-driver 0.62.1, pacote oficial com sha256 fixo** (`src/contracts/seu-computador.ts`).
   - Mac: o binário universal vai no .app, fora do asar (`Contents/Resources/cua-driver/cua-driver`, montado por
     `scripts/desktop/cua-driver-binario.mjs`), e o electron-builder o reassina com a conta do nod (como o OpenMausBot).
     O processo principal do Electron o sobe como filho: a Acessibilidade e a Gravação de Tela são as do nod.
   - Windows: o motor baixa o mesmo pacote fixo na primeira vez (sha256 conferido) para a pasta do executor. Nunca o
     instalador oficial, que cria uma tarefa de logon elevada. O Mac sem o binário no pacote (app antigo) faz o mesmo.
   - Telemetria e atualização do driver desligadas; o estado dele fica numa pasta do nod. A extensão `cua-perception`
     (AGPL) fica de fora.
   - Medido em 26/11 neste Mac: o daemon sobe em ~0,7 s (com o download, ~3,4 s); o driver dentro do nod.app instalado
     herdou as duas permissões e abriu e leu o Editor de Texto em segundo plano; com a tela bloqueada, recusou digitar
     (`screen_locked`), como deve.

3. **Sempre em modo `bounded`.** Nunca `standard` nem `unrestricted`. O manifesto do daemon é feito dos apps liberados
   (bundle id no Mac, caminho do .exe no Windows), sem captura da tela inteira (`desktop.display: false`), e só cresce
   enquanto o daemon vive (a união dos bots que pediram); o nod confere, antes de chamar o driver, que o app está na
   lista DAQUELE bot (`precisa_liberar` se não). O driver recusa qualquer outro app pelo pid (medido).

4. **O pedido no chat é o portão.** Na primeira vez com um app, a ferramenta volta `precisa_liberar` e o servidor cria
   o cartão "A {bot} quer usar seu Mac" (uma aprovação com o item `seu_computador`), com "Só o {app} · motivo" e três
   saídas: "Permitir desta vez" (2 h), "Sempre no {app}" (o `sempre` da decisão, até a pessoa tirar) e "Agora não". O
   texto é montado pelo servidor e o nome do app vem do sistema (a máquina resolve o nome que o bot disse), nunca do
   modelo. O turno espera no próprio long-poll da aprovação; liberado, o bot chama de novo.

5. **Permissões do sistema uma vez, guiadas.** No Mac, Acessibilidade e Gravação de Tela, do app nod: Ajustes ›
   Máquinas › Seu Mac mostra as duas com "Abrir Ajustes do Sistema" e relê quando a janela volta ao foco. Faltando uma,
   a ferramenta responde `sem_permissao` e o bot diz qual. No Windows não há permissão de sistema.

6. **Sempre à vista.** O driver age por trás da janela, sem tomar o mouse. Se a pessoa está mexendo no mesmo app (é o
   app da frente e houve tecla ou mouse há menos de 2 s), o bot pausa — a ilha diz "em pausa enquanto você usa o app" —
   e segue depois de 10 s sem ela mexer; passado 1 min, a ferramenta volta `pessoa_usando`. No Mac, o app da frente
   pelo NSWorkspace e o tempo ocioso pelo Electron; no PC, um PowerShell que o motor deixa aberto (GetForegroundWindow e
   GetLastInputInfo, `pessoa-windows.ts`). No PC, a ilha e a borda são do app do Windows: o motor publica cada ação em
   `<pasta do executor>\seu-computador\atividade.json` e o Parar volta por `parar.json`. No Mac, a ilha do nod no topo da tela
   ("Ada está usando seu Mac · Numbers · clicando · Parar") aparece a cada ação e some 12 s depois, e uma borda âmbar contorna a janela do app (uma janela do nod transparente,
   que deixa o clique passar); Parar e bloquear a
   tela derrubam o driver na hora e o bot recebe "a pessoa parou". O cursor do agente é o do próprio driver. No painel, o lugar
   "Seu Mac"/"Seu PC" (ao lado de Navegador e Computador) aparece quando o bot usou o computador da pessoa: o último quadro
   da janela, com a borda âmbar enquanto está ao vivo, e "O que <bot> fez" (`GET /agentes/:id/seu-computador`, SSE
   `seu_computador.mudou`; `web/lib/seu-computador-painel.ts`).

7. **O que fica fora, sempre.** Ajustes do Sistema e Painel de Controle, gerenciadores de senha, terminais, Automator e
   Editor de Scripts, Monitor de Atividade e o próprio nod (`src/domain/seu-computador.ts`), nem com "Sempre". Diálogos
   de segurança do macOS e janelas elevadas o driver não alcança. O bot nunca digita senha, código ou cartão.

8. **A confirmação no ponto sem volta continua.** Enviar, excluir, pagar e publicar num app da pessoa passam por
   `pedir_a_pessoa` antes (o prompt e a descrição da ferramenta dizem). O conteúdo da tela é não confiável (ADR-026).

9. **Onde vale e a escolha do lugar.** Fase 1: só na conversa da pessoa com o próprio bot (nem rotina, nem subtarefa,
   nem sala, nem pedido de outra pessoa). O prompt diz a ordem: app conectado → navegador do bot → computador do bot →
   o Mac/PC da pessoa, este só quando o pedido aponta para ele (um app que só existe lá, um arquivo dela, "no meu Mac").
   O bot diz em uma frase onde vai trabalhar e por quê. Medido em 2026-11-26 com o prompt e as ferramentas reais
   (`scripts/seu-computador/escolha/rodar.sh`, 10 pedidos: hotel, Numbers, PDF com Python, Slack, "abre o Chrome",
   Excel, Keynote, portal da prefeitura, Mail do Mac, script): Sonnet e Haiku começaram no lugar esperado em 9 de 10; no
   décimo (portal sem cidade) os dois procuraram nas conversas e perguntaram, sem errar de lugar. De ponta a ponta
   (`rodar-ponta-a-ponta.sh`: o portão e a fila reais até uma máquina simulada com o Editor de Texto), os dois modelos
   pediram o app no cartão, leram a janela, escreveram a linha pela referência e releram; recusaram o Terminal sem
   tentar; e no pedido de hotel foram ao navegador, sem tocar no computador da pessoa.

10. **Registro.** Cada chamada vai à trilha (`tool_call`); a vista guarda os 30 últimos passos com o efeito que o driver
    relata (confirmado, sem prova, sem efeito). As imagens ficam só em memória, no servidor, para o painel.

11. **Ferramentas: `seu_computador_*`.** `apps`, `ver`, `abrir_app`, `clicar`, `digitar`, `tecla`, `rolar`, `arrastar` e
    `menu`, sempre pelo nome do app. O prefixo não cruza com `computador_*` (o computador do bot). O `run_script` do
    driver fica fora. Com elas no plano, as `mac__tela_*` da ADR-173 saem do turno.

12. **Paridade (ADR-135).** `seu_computador.tirar_app` (Ajustes › Seu Mac: "Tirar" e "Tirar tudo"); o caminho no chat
    fica para a onda NOD-396. Liberar é sempre pelo cartão.

Transporte: a mesma fila da máquina do navegador do bot (`navegador/puxar`, ADR-190). A máquina anuncia o recurso
`seu_computador` no long-poll; o servidor só oferece as ferramentas quando um Mac ou PC da pessoa anuncia, e responde
"indisponível" na hora em vez de esperar o prazo. `NOD_SEU_COMPUTADOR=0` desliga.

## Alternativas recusadas

- **Manter o JXA da ADR-173.** Foto e coordenada, só no Mac, rouba o mouse. Gatilho de reversão: o cua-driver quebrar a
  API entre versões a ponto de travar o release do app.
- **Escrever um driver próprio.** É o trabalho que a trycua já mantém. Gatilho: a licença ou a assinatura mudar.
- **O instalador ou o MCP global do cua-driver.** Tarefa elevada no Windows e a permissão do Mac em outro processo.
- **`list_apps` do driver.** Em `bounded` ele é recusado (olha a tela inteira); a lista de apps vem do sistema (NSWorkspace
  pelo JXA no Mac, processos e atalhos do Menu Iniciar no Windows).
- **"Sempre" sem escopo, ou o computador inteiro.** O escopo por bot e por app é o que dá sentido ao `bounded`.
- **Copiar o código ou o prompt do OpenBot.** Licença não comercial: só estudamos o comportamento.

## Fica para depois (fase 2)

- Rotinas usando apps marcados com "Sempre", com o aparelho ligado.
- O caminho no chat para tirar apps; multi-monitor e DPI misto no Windows; Linux da pessoa.

## Gatilhos de reversão

- Mais de uma reclamação por semana de foco roubado: primeiro plano só com confirmação.
- O modo `bounded` deixar o bot alcançar uma janela fora do manifesto: `NOD_SEU_COMPUTADOR=0` até corrigir.
- Pedidos frequentes de apps da pessoa em rotinas: abrir a fase 2.

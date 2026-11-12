# TELAS.md — Grok Bot v1.0.1: telas, navegação, fluxos e estados

Fonte: leitura estática de `dist/renderer` (rotas, registro de configurações, onboarding, atalhos, catálogo de textos)
e de `dist/electron-preload` (o que as telas pedem ao app). O REA rodou no `preload.cjs` (8 APIs no contextBridge,
18 membros expostos); o resto foi lido direto dos bundles, porque o renderer tem 41 MB e a máquina tinha ~1,2 GB livres.

> **Prints.** (Nota antiga; ver §8: 76 prints em 12/11.) Na 1ª rodada não deu para tirar: o macOS deste Mac não deu permissão de **Gravação de Tela** ao terminal
> (`screencapture` responde "could not create image from display") nem de Acessibilidade ao `osascript`. Abrir uma
> segunda instância do Grok Bot para capturar mexeria no app que o Pablo está usando e pesaria na memória. A pasta
> `prints/` está criada; a lista do que capturar está no fim deste arquivo. Liberando a Gravação de Tela para o
> app do nod/terminal em Ajustes › Privacidade, dá para tirar todos numa próxima rodada.

Os textos aparecem em inglês (original) e, entre parênteses, na **tradução oficial pt-BR do próprio app** (o Grok
Bot vem em 37 idiomas, incluindo pt-BR e pt-PT). As 6.097 frases com en + pt-BR estão em `_dados/strings.tsv`.

---

## 1. Janelas

| Janela | O que é |
|---|---|
| **Principal** | Sidebar + chat + painel do Bot à direita. Barra de título integrada (semáforos do macOS, 52px). |
| **Quick Chat** ("Spotlight") | Janela flutuante de 608×440 aberta por atalho global configurável ("Open Quick Chat with a keyboard shortcut"; "Press the new shortcut"; "Another app is using this shortcut. Choose a different one."). |
| **Popout de chat** | Um Bot numa janela própria (`sandPopout.agentId`). |
| **Desktop mount** ("Mount on Desktop" / "Unmount from Desktop") | O avatar do Bot fica solto na área de trabalho. Clique abre um mini-composer (anexos, enviar, **capturar janela ou região**); passar o mouse mostra a prévia da última fala; menu para trocar de Bot e histórico. |
| **Capture overlay** | Camada transparente de tela cheia para escolher a janela/região a mandar ao Bot. |
| **Computador do Bot** | Visualização ao vivo (VNC) da máquina do Bot, com "Open computer", atualizar/resetar. |
| Webview | Prévias de páginas, canvas, apps MCP e visualizações em `iframe` com protocolos próprios. |

A bandeja/menubar nativa fica no processo principal (escopo da outra frente). Pelo lado das telas só aparecem:
selo de não lidos no Dock ("Messages app icon"), notificações do sistema com som escolhível e o Quick Chat.

## 2. Mapa de navegação (rotas)

`sidebar` · `thread` (conversa) · `agent` (Bot) · `task` · `messages` (iMessage/textos) · `settings` (com `id` da linha) ·
`marketplace` · `bot-template` · `create-team-bot` · `plugin-add` · `plugin-native` · `prompt` (deep link que preenche o
campo) · `referral` · `texting` · `agent-invite`.

Toda rota abre por deep link (`markDeepLinksReady`). Toda linha de configuração tem link copiável ("Copy link to the
{setting} setting"), e o ⌘K encontra Bots, chats, configurações e ações.

```
┌ Sidebar ───────────┐┌ Chat (pane) ───────────────────────┐┌ Painel do Bot (info pane) ┐
│ ◀ ▶  ⌘B            ││ Cabeçalho: avatar · nome · ações   ││ Overview · Routines ·     │
│ Search  New chat   ││                                    ││ Media · Computer ·        │
│ Tasks              ││  transcript (balões, cartões,      ││ Meetings · Members        │
│ Pinned             ││  aprovações, artefatos)            ││ + Customize (⌘⇧M):        │
│ <seções do usuário>││                                    ││ instruções, plugins,      │
│ Bots …             ││  [composer: anexo · ditado · ➤]    ││ segredos, skills,         │
│ Library · Market.  ││                                    ││ memórias, arquivos        │
└────────────────────┘└────────────────────────────────────┘└───────────────────────────┘
```

## 3. Fluxos

### 3.1 Primeira abertura / onboarding (`onboarding-flow`)
Passos na ordem, com transição para frente/para trás e o personagem animado como fio condutor:

1. **landing** — "Welcome to Grok Bot" (Bem-vindo…), botão "Get started"/"Sign in". Se não está logado, abre o login.
2. **meet** — "Meet Grok Bot": o personagem preto em forma *blob* acorda (`waking`) e alterna idle/thinking/listening.
3. **computer-demo** — "Grok Bot has its own computer and works just like you" (cena com cursor animado).
4. **jobs** — "Give each Bot a job": desfile de Bots de exemplo (Invoice Chaser, Weekly Standup, Sales Forecast…).
5. **hand-off** — "Hand off any task to your team of Bots".
6. **role** (experimento) — "What will you be working on most?" → sugere Bots por função (≈45 modelos: Chief of Staff,
   Inbox Manager, Executive Assistant, Ticket Triage Specialist, Pipeline Analyst, Newsletter Writer…).
7. **attribution** (experimento) — "How did you first hear about Grok Bot?" (X, Instagram/Facebook, YouTube, TikTok,
   Reddit, LinkedIn, busca, lojas de app, TV/outdoor, influenciador, amigo, assistente de IA). "Skip".
8. **connect** — "Connect your apps" (detecta Google/Microsoft pelo e-mail e sugere Gmail+Calendar ou Outlook). "Skip for now".
9. **create** — escolhe cor e forma do Bot (padrão azul/blob) e manda a 1ª mensagem ("Attach", "Send").
10. **setup** — "Getting your team ready…" → "Waking your computer…" → "Setting up your Grok Bot… {0}%".
    Erro: "Grok Bot couldn't finish setting up" + "Try again" / "Check for issues".

Casos de conta: "You're now signed in", "This is a new Grok Bot account. It doesn't have a Bot yet." →
"Set up this account" ou "Switch back to {0}". Termos: registro de aceite (`getGrokBotTermsRecord`).

### 3.2 Login
- Conta **Cursor** (OAuth no navegador): "Continue in your browser" / "Confirm in your browser…", com "Copy link"
  ("Copy the sign-in link into your browser, or try again") e cancelar.
- Várias contas na mesma máquina (adicionar, trocar, renomear, remover), seleção de time, passkeys para aprovar compras.
- Erros: "Couldn't sign in to Cursor. Check your connection and try again.", "Couldn't check your Cursor account. Sign in again."

### 3.3 Chat com um Bot
- Abrir pela sidebar, ⌘1–9, ⌥↑/↓ (Bot anterior/próximo) ou ⌘K.
- Composer: texto rico, @menção, anexos (arrastar/colar/clipe), ditado, "Add selection to prompt" (⌘L), enviar.
- O Bot responde em prosa (sem balão) com **atividade inline**: "Thinking", "Working…", "Working in {service}",
  "Running a few commands", passos de ferramenta que expandem. Personagem do Bot muda de estado junto.
- Respostas ricas: rascunhos de e-mail/Slack/Teams/iMessage editáveis (enviar um a um ou "Send all"), cartões de
  viagem (voos, hotéis, carros, mapas, clima), compras (carrinho, checkout com passkey, try-on de roupas), ligações
  telefônicas, documentos/páginas, planilhas, PDFs, código com destaque, KaTeX, diagramas, visualizações d3/three.
- Buscar no chat (⌘F), comentar na página (⌘⇧C), marcar como não lido, reações/emoji.

### 3.4 Aprovações (o Bot pede antes de agir)
- Cartão inline na conversa. Tipos vistos: rodar comando no computador local, usar um app do Mac (Computer Use),
  ler/enviar Messages (iMessage), mandar e-mail pelo Mail, entrar em reunião não pedida, fazer ligação, pagar,
  pedir credencial/login (1Password/Vault), salvar rotina ("Allow {botName} to save a routine?").
- Opções: **Allow once / Always allow (para {escopo}) / Deny once** (Esc nega). E-mail/mensagem: **Send / Discard**.
- Resolvido: o cartão vira uma linha de status ("Allowed from now on: {rule}", "Saved to Custom Rules", "Expired",
  "No answer in time, so {botName} didn't do this").
- **Auto-review**: um revisor confere as ações arriscadas antes de rodar. Por ferramenta: "Auto-review, Needs approval,
  Blocked, or Always allow". Regras "Always Ask" e "Allow without Asking" editáveis em Configurações; o admin do time
  pode exigir Auto-review ("Your admin requires Auto-review"). Aviso inline quando uma regra é criada/alterada.

### 3.5 Bots, times e grupos
- Novo chat (⌘N): barra "To:" com busca ("Start a chat with…"); digitar um nome cria Bot ("Add “{0}” as a new Bot").
- Grupo (⌘⇧N): só Team Bots; aviso de custo ("Group chats use more of your usage: every Bot reads each message").
- **Team Bots**: compartilhar ("Share this Bot", "Who has access", Owner/Manager/Collaborator/Teammate), link,
  convites, Slack/Teams (o Bot responde no workspace), métricas ("Messages", "Hours saved", "Top users, last 90 days").
- Sidebar: fixar, seções próprias ("Create section", "Move to section", "Rename section"), arquivar, esconder.

### 3.6 Painel do Bot ("Toggle details" ⌘⌥B / "Toggle Bot settings" ⌘⇧,)
Abas: **Overview · Routines · Media · Computer · Meetings · Members**. "Customize" (⌘⇧M) e "Skills" (⌘⇧W) abrem as
partes de configuração: descrição/instruções, plugins (conectores MCP), segredos, skills, memórias (inclui "Import
Memory to Grok Bot"), automações/rotinas (agenda, webhook URL/key/header, pausar/retomar), arquivos.

### 3.7 Tasks, Library, Marketplace
- **Tasks**: lista na sidebar (pode ir para perto da busca ou para o fim), filtro, arquivo ("Tasks you archive show up
  here"), tarefas assíncronas ("No async tasks in progress"). Vazio: "No tasks yet" / "Give your Bots a task and they'll show up here".
- **Library**: páginas, documentos e itens fixados do usuário e do time.
- **Marketplace**: plugins/conectores (catálogo MCP, popularidade no time, conector customizado), modelos de Bot
  ("For you"), Team Bots compartilhados. Admin pode bloquear ("Your team admin blocked {displayName}").

### 3.8 Configurações (⌘,)
Cinco abas, cada linha com título + descrição de uma frase, busca e link próprio:

| Aba | Linhas (rótulo — descrição) |
|---|---|
| **General** | Account; Theme ("Pick the light or dark look"); Accent ("Color 1:1 Bot messages and cards with the Bot's color, or keep them black"); Language; Check Spelling; Microphone; Use hardware acceleration (+ Restart to Apply); Network Debugger; Play Sound / Notification Sound; Model ("Choose which AI model Grok Bot thinks with"); Timezone; Auto-review + Custom Rules (Always Ask / Allow without Asking); Use hardware security keys; Passkeys; Team Bots (limpar preferências de conector, allowlist de plugins, link previews, contas Slack/Teams); Import Memory; Data sharing; Contacts; Linked numbers; Threads; Reference photo |
| **Computer** | Execution on Local Computer; Your computer(s) / Manage devices; Computer Use (apps liberados); Read Texts / Send Texts / Send Without Asking / Allowed recipients (iMessage); Route traffic through this computer; Update / Reset Bot's Computer |
| **Vault** | Vault (logins e contatos que o Bot pode digitar; 1Password) |
| **Usage & Billing** | Usage (incluído e quando reseta), My plan, Usage limits, Additional usage (on-demand), Manage Plan, Cancel Trial, Manage Billing (no Cursor) |
| **Updates** | Grok Bot Updates (versão), Update Track (estável/beta), Automatic Updates |

### 3.9 Voz e reuniões
Ditado no campo; chamada de voz com o Bot (feedback ao fim); o Bot pode entrar em reuniões e fazer ligações
telefônicas (com termo de uso para ligar só para empresas dos EUA e pessoas que consentiram).

### 3.10 Uso e cobrança
Avisos de uso, "Review Usage", modal de recarga (top-up), créditos, limites de gasto, trial.

## 4. Estados

| Estado | Como aparece |
|---|---|
| Vazio | Frase curta + o que fazer: "No messages yet", "No tasks yet", "Give your Bots a task and they'll show up here", "No unread Bots", "No Team Bots yet", "Nothing installed yet. Find plugins in the marketplace.", "Skills in your library show up here", "Drag Bots here" (seção vazia). |
| Carregando | Gerúndio + reticências ("Loading…", "Connecting to your computer…", "Checking prices…", "Saving to the team…") com shimmer; esqueletos com shimmer. |
| Trabalhando | "Thinking" / "Working…" com shimmer + personagem em estado `thinking/working/coding/searching`. |
| Erro | "Couldn't {verbo} {objeto}. Try again." ou "… Check your connection and try again." (47 variações de "Couldn't/Can't"); bloco de seção: "This section hit an unexpected error." |
| Offline / sem conexão | "You're offline", "Reconnecting", "Can’t reach your computer" / "Computer is asleep". |
| Sem permissão / admin | "Your team admin turned off connectors, so {displayName} can't run", "{displayName} isn't on your team's MCP allowlist". |
| Computador do Bot | "Creating/Recreating/Recovering Grok Bot's computer", "Computer update scheduled/failed/was missed". |
| Expirado | Aprovação sem resposta: "Request expired", "No answer in time, so {botName} didn't do this". |

## 5. Atalhos

| Atalho | Ação |
|---|---|
| ⌘K | Jump to (paleta de comandos) |
| ⌘⇧F | Search Bots |
| ⌘N | New Bot / novo chat |
| ⌘⇧N | New group chat |
| ⌘1…⌘9 | Focar o Bot N da sidebar |
| ⌥↑ / ⌥↓ | Bot anterior / próximo |
| ⌘[ / ⌘] | Voltar / avançar |
| ⌘B | Sidebar compacta |
| ⌘⌥B (e ⌘⇧I, conforme a tela) | Toggle details (painel do Bot) |
| ⌘⇧, | Configurações do Bot |
| ⌘, | Configurações |
| ⌘⇧M | Customize |
| ⌘⇧W | Skills |
| ⌘I | Focar o campo |
| ⌘L | Adicionar seleção ao campo |
| ⌘F | Buscar no chat |
| ⌘⇧C | Comentar na página |
| ⌘Enter | Enviar |
| ⌘/ ou ⌘⇧/ | Folha de atalhos ("Keyboard shortcuts") |
| Esc | Negar/descartar no cartão de aprovação |
| atalho global (configurável) | Quick Chat |

## 6. Microcopy: o padrão de escrita

- Frases curtas, voz ativa, segunda pessoa, sem jargão: "Let Grok Bot install updates on its own".
- Toda configuração tem título curto + descrição de uma frase que começa por verbo ("Choose…", "Let…", "Pick…", "See…").
- Erro sempre diz o que falhou e o próximo passo; nunca código de erro na frente.
- Pergunta no título da aprovação ("Send this message?"), consequência embaixo ("The message will be sent from your computer").
- O produto chama tudo de **Bot** (com maiúscula) e o principal de **Grok Bot**; "computer" é a máquina do Bot.

## 7. A ponte (preload) que as telas usam

`window.desktop` com `main` (~400 métodos tipados, validados nos dois lados), `boot`, `environment`
(plataforma, dev, backend) e `local` (zoom, anexos, sinais de boot). Mais: `coordinatorPort` (um MessagePort para o
coordenador local — é por ele que chega quase todo o estado em tempo real), `sandPopout`, `sandSpotlight`,
`desktopMount` e `desktopMountFiles` (painel solto), `desktopMountCaptureOverlay`, `sandRenderTrace`.
Grupos de métodos (lista completa em `_dados/preload-methods.txt`):

- **Janela e app**: abrir externo, estado/foco/minimizar/maximizar, popout, overlay da barra de título, tema, idioma,
  aceleração, corretor, notificações, atualizações, onboarding visto, fuso, zoom.
- **Bots e times** (`…GrokBot…`): listar/criar/publicar/compartilhar Bots, gerentes, convites, acesso, plugins, skills,
  memórias, segredos, arquivos, caixas de e-mail próprias do Bot, fixados, seções da sidebar, carrinho, ditado/fala.
- **Conta Cursor**: login por "flight" no navegador, contas múltiplas, times, uso/limites, privacidade, passkeys, telemetria.
- **Conectores e permissões**: MCP (catálogo, instalar, autenticar, permissões por ferramenta), credenciais
  (1Password, Vault, OAuth), Slack, finanças, permissões do macOS (Messages, Computer Use, dispositivos), Obsidian, reuniões.
- **Aprovações locais**: permissão por ferramenta, aprovação pontual, concessão permanente, aprovação de envio no Mail.

## 8. Prints a tirar — status (12/11/2026, 2ª rodada)

**76 PNGs** em `prints/` (46 da 1ª rodada + 30 da 2ª; galeria com legendas em `prints/index.html`), só da janela
do Grok Bot (`screencapture -x -o -l <id>`), claro e escuro (`-claro`/`-escuro` no nome). Navegação: deep links
`grokbot://app/v1/<rota>` (tabela em `main-core.cjs`) e atalhos, menus e cliques via System Events/CGEvent. O tema do
app está em "Seguir o sistema"; o escuro saiu alternando a aparência do macOS por alguns segundos e voltando ao claro.
Nada foi aprovado, enviado a pessoas, conectado ou pago; o rascunho do Marlon no chat do Deco ficou intacto.

Achados de navegação desta versão: ⌘⇧, alterna o painel do Bot (clicar no nome do Bot no topo também); ⌘⇧M e ⌘⇧W
abrem o mesmo "Conectar aplicativos"; ⌘/ não abre nada, a folha de atalhos fica em Ajuda › Atalhos de teclado; o painel
do Bot tem só **Atividade · Biblioteca**; `texting` e `referral` abrem Configurações › Geral; não há telas próprias de
Tasks e Library. O "+" do composer abre um menu (**Anexar arquivos · Ensinar uma tarefa**). O cartão de aprovação de
comando local tem **Nunca · Sempre permitir · Permitir uma vez** e um ✕ que é "Negar uma vez (Esc)"; negado, vira a linha
"O Grok Bot não teve permissão para executar comandos no seu computador" e a sidebar mostra "Aguardando você: Permissão…"
enquanto o cartão está aberto.

**Como a 2ª rodada fez o que faltava:**
- Instância paralela isolada: o app aceita `SAND_USER_DATA_DIR` (perfil) e `SAND_DATA_ROOT` (no lugar de `~/.grokbot`);
  com eles a trava de instância única não bloqueia. Trocar o `HOME` **não** funciona (o macOS não acha as Chaves e
  abre o diálogo "Chaves Não Encontradas"). Perfil em `/tmp`, apagado no fim.
- Sem rede só na instância de teste: `--proxy-server` sozinho não basta (o login roda no Node do processo principal);
  junto com `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY=http://127.0.0.1:9` e `NODE_USE_ENV_PROXY=1` o erro aparece.
- Aprovação real: pedido ao Bot **Teste** para rodar `echo teste nod` neste Mac ("Execução neste computador" está em
  Perguntar sempre). Negado duas vezes pelo ✕ (negar uma vez); "Nunca" não foi usado porque mudaria a configuração.

1. Onboarding — ✅ `70-onboarding-entrada-{claro,escuro}` (Grok Bot + "Fazer login"), `71-login-continue-no-navegador-{claro,escuro}`
   (Reabrir link · Copiar link · Cancelar), `72-login-erro-sem-conexao-{claro,escuro}`. **Ainda faltam** os passos
   meet → setup (§3.1): só aparecem depois de logar, e não dá sem entrar numa conta (a de teste exigiria credenciais).
2. Principal — ✅ `01`…`08`, `41` (1ª rodada) + `09-sidebar-menu-contexto-bot-{claro,escuro}` (Fixar, Mover para,
   Marcar como não lido, Renomear, Copiar ID, Ocultar, Excluir).
3. Composer — ✅ `27-composer-mencao`, `28-composer-menu-mais-{claro,escuro}`, `29-anexo-seletor-arquivos-{claro,escuro}`
   (seletor do macOS numa pasta vazia, cancelado), `32-ditado-ouvindo-{claro,escuro}` (antes da permissão),
   `33-ditado-permissao-microfone-{claro,escuro}` (pedido do macOS), `34-ditado-gravando-{claro,escuro}` (cronômetro e
   transcrição ao vivo; cancelado com Esc, nada enviado), `35-pensando-digitando-claro` (três pontos),
   `36-trabalhando-executando-comando-{claro,escuro}` ("Executando comando no terminal" / "Tentando rodar o comando").
4. Cartões de aprovação — ✅ `37-aprovacao-comando-local-{claro,escuro}`, `38-aprovacao-negar-uma-vez-dica-claro`,
   `39-aprovacao-negada-resolvida-{claro,escuro}`. **Ainda faltam** Computer Use, iMessage e e-mail (exigiriam conceder
   permissões do macOS ou mandar algo a alguém) e "Salvar regra" (não apareceu: o cartão de comando local não oferece).
   Parecido: `31-dialogo-permissao-mensagens-claro`.
5. ✅ `20`…`26` (paleta, atalhos, novo Bot, grupo).
6. Configurações — ✅ as 6 abas, claro e escuro (`10`…`16`).
7. ✅ Marketplace `30`. Tasks e Library: **não existem como telas** nesta versão.
8. Quick Chat e Desktop mount — **não existem nesta conta**: o Quick Chat (e a linha "Chat rápido" das Configurações)
   só aparece com a flag remota `sand_desktop_spotlight`, e o item "Montar no ambiente de trabalho" (no menu de contexto
   do Bot, `09`) só com `sand_desktop_mount`; as duas estão desligadas, então não há atalho a configurar nem avatar a
   montar. Não forcei as flags.
9. Computador do Bot — ✅ `60`, `61`, `62` + `63-computador-do-bot-sem-conexao-{claro,escuro}` e
   `64-computador-do-bot-em-repouso-{claro,escuro}` (cartão do painel, recortado; os dois estados apareceram sozinhos).
   "Atualizando" e a tela cheia de "dormindo" **não apareceram**; não forcei.
10. Erro de conexão — ✅ `72-login-erro-sem-conexao` (instância de teste). **Ainda falta** o aviso "Você está offline" /
    "Reconectando" dentro do app logado: exigiria cortar a rede da instância do Marlon, o que derruba a conta e o nod.

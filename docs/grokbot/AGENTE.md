# Grok Bot v1.0.1: como o agente funciona

Levantado a partir dos bundles do back (coordinator, daemon local, main e protos) e do estado em disco deste Mac. Descreve comportamento, sem código. **Aviso importante:** o loop do modelo e os prompts de sistema do agente principal **não estão no app**. Eles rodam na box (VM na nuvem) e no backend. O que segue é o que dá para afirmar a partir do contrato que o cliente enxerga: RPCs, enums, frames, nomes de ferramenta e configs. Inferências estão marcadas como tal.

## 1. Onde o agente vive
- Cada usuário tem **uma box** (VM/pod, `/home/box`, com disco durável em `/home/box/sand-data` e `/home/box/agent-data`, e manuais em `/home/box/reference`: debugging-the-box.md, app-ui.md, app-actions.md). **Todos os bots do usuário dividem essa box**; o bot separa persona, memória e workspace, não o hardware. A box hiberna, acorda (`EnsureSandBox`, `noteBoxIntent`) e é atualizada ou migrada pelo servidor.
- Há o **agente principal** (`SetGrokBotMainAgent`, `EnsureGrokBotDefaultMainAgent`), **agentes extras** (`CreateGrokBotAgent`), **agentes temporais/efêmeros** (`CreateGrokBotTemporalAgent`), **subagentes** (`ListGrokBotSubagents`, ferramentas MessageSubagent/CheckSubagent/StopSubagent/WakeParent), **cloud agents** (CloudAgent, de código) e **salas** com vários agentes e pessoas (`CreateGrokBotRoom`, turno por membro: `RequestGrokBotRoomMemberTurn` → `DeliverGrokBotRoomMemberTurnResult`).

## 2. O loop (o que se vê por fora)
1. **Entrada:** a mensagem chega por `SendGrokBotUserMessage`, com fila offline no cliente (send-journal). Também entram Slack, Teams, e-mail próprio do bot, iMessage/SMS pelo telefone vinculado, reuniões, ligações, gatilhos de automação/rotina e webhooks (`CreateAutomationWebhookApiKey`). `GetGrokBotSendStatus` acompanha a entrega.
2. **Turno na box:** o agente chama o modelo (padrão `grok-4.5`, ajustável por `SetEffort`, com maxMode e parâmetros) e as ferramentas. O resultado vira **entradas do transcript** (`CommitGrokBotTranscriptEntries`) que o cliente recebe em tempo real (`WatchGrokBotTranscripts`: rows, agent_state, computer_actions, turn_failed...). Prazos: 150 s até o primeiro token e 90 s ocioso.
3. **Controles do usuário:** `InterruptGrokBotAgentRun` (parar), `StartFreshGrokBotConversation` (conversa nova), `RollBackGrokBotConversation` (voltar a um ponto), `CreateGrokBotThreadFromMessage` (abrir fio), reação, voto de feedback.
4. **Falhas de turno tipadas:** usageLimit, unpaidInvoice, timeout, regionUnsupported, rateLimit, policyBlocked, contentBlocked (e provedor bloqueou, box atualizando). Cada falha diz de quem é a conta afetada (dono, usuário agindo, conta de serviço do time).
5. **Contexto longo:** há config de **sumarização especulativa** (dispara com 70% do contexto usado, ±5%, e descarta resumo com mais de 5 min) e o pacote `agent-summarization` (inferido: a compactação roda antes de estourar a janela). Arquivos do transcript são pesquisáveis (`SearchTranscripts`, `ReadTranscriptFile`).
6. **Fim de turno:** `NotifySandAgentTurnFinished`; entradas de "work landed" alimentam a voz e as notificações.
7. **Proatividade:** o bot pode iniciar conversa (SetProactiveMessaging, preferências de proatividade), com rate limit no Mac (5 s entre mensagens, no máximo 10 a cada 5 min, por app permitido).
8. **Memória e "sonhos":** memórias por usuário/bot (RecallMemory, UpdateMemory, SortMemories, `ListGrokBotUserBotMemories`), promoção para o time (`PromoteGrokBotMemoriesToTeam`) e um job de consolidação ("dream", `AdminStartGrokBotDream`; inferido: reorganiza memórias fora do turno). Mudanças de memória, skill ou memória de pasta propostas pelo agente viram **itens de revisão do time** (status, quem propôs, quem revisou).

## 3. Ferramentas
São cerca de 190, num único enum. Agrupadas aqui por função; a lista literal está em `notas/local-exec-daemon.md`.
- **Execução e arquivos:** Shell, AwaitShell, Read, Screenshot, Computer, CopyToBox/CopyFromBox (Mac↔VM), DownloadFile, UploadFile, ListMachines, TS, UiMap, Skill, Vault.
- **Web:** WebSearch, WebFetch, navegador da VM com Playwright (`sand-playwright-runtime`), BrowserSecureFill, FillCredential, ReportSiteBlocked, ReportBotChallenge, ReportSignInAttempt.
- **Dispositivo (Mac e iPhone via Mac):** mobile_read/write_calendar, mobile_read_contacts, mobile_set_alarm, ios_read/write_reminders, ios_read/control_home (HomeKit), ios_read_health, ios_manage_alarms, device_get_location, mac_read/write_notes, mac_read/write_obsidian, mac_read_mail, mac_draft_mail, mac_send_mail.
- **Computer use** (sub-ações): screenshot, click, move, drag, type, key, scroll, wait, check_permissions, apps, resolve_app, app_state (árvore de acessibilidade), set_value, app_action. Depois de cada ação o daemon **anexa sozinho** um screenshot novo ou o app_state, e o agente sempre vê o efeito.
- **Mensagens e comunicação:** SendMessage, SendToUser, SendToAgent, PostToGroupChat, SendPoll, ReactToMessage; iMessage (SendIMessage, SearchIMessages, FindIMessageChats, FetchIMessageAttachment, IMessageActivity, CheckIMessagePermissions); Slack e Teams (reagir, editar/apagar a própria mensagem, status, SetUpSlack/SetUpMicrosoftTeams); e-mail próprio (ClaimEmailInbox, SendEmail, Search/ReadEmailThread, ReadEmailAttachment); DraftExternalMessage, DraftCalendarInvite; PhoneCall, SharePhoneCallContext, PresentCallQuestion.
- **Reuniões:** FindMeeting, JoinMeeting, LeaveMeeting, ListMeetings, ReadMeetingTranscript/Lines, RespondInMeeting, GetMeetingSummary, UpdateMeeting.
- **Trabalho e organização:** CreateTask, Update/ReadTask, Create/Update/Delete/ListTrackedTasks, UpdateRoutine, UpdateState, SetStatus, ReportOutcome, ProposeCarryOver, ProposeRuleChange, ProposeSkills, UpdateSkill, ResolveReviewItem, ListReviewItems, SaveToLibrary, Write/ReadDocument, ListDocuments, EditCanvas, WriteCanvasAsset, ListCanvases, SetPageData, UpdateAppHome, ChatItems.
- **Gestão de bots:** CreateAgent, UpdateAgent, UpdateProfile, UpdateAvatar, OfferAppearancePicker, SetPrimaryBot, PublishToTeam, ConvertToTeam, OfferTeamAccess, SearchTeamBots, SearchBotTemplates, CreateBotShareJson, CopyBotFile, List/Show/RemoveBotResource.
- **Conectores e MCP:** AddMcpServer, AuthenticateMcpServer, GetMcpServerStatus, RestartMcpServers, UninstallMcpServer, Rename/RemoveMcpAccount, SetMcpInstructions, Search/Get/Install/UninstallPlugin, RequestScmConnect, OfferSlackConnect, FetchConnectedActivity, DeclineConnectionNotice.
- **Cofre e pagamento:** ListCredentials, ListAvailableSecureValues, GetCredentialProviderStatus, RequestOnePasswordConnect/Logins, SetOnePasswordPreference, RequestVirtualCard, PayTextedOrder, RequestUserForm, RemapUserFormTargets.
- **Vida real:** PlacesSearch, RestaurantSearch, ReserveTable, FlightSearch/Details, ArrangeFlights, HotelSearch/Details, CarRentalSearch/Details, ProductSearch, WeatherForecast.
- **Conta:** CheckSubscriptionUsage, SendFeedback, JoinWaitlist, SetUserAttribute.
- **Onde cada ferramenta roda:** Computer, Read, Screenshot, Shell, Skill e Vault podem mirar a **máquina do usuário** (o agente escolhe o alvo com ListMachines). O resto roda na box ou no backend. O pedido local vira um "user computer request" que o daemon executa.
- **Skills locais do usuário:** o daemon recebe os caminhos `CLAUDE_CONFIG_DIR` e `CODEX_HOME`. Inferido: aproveita skills e configs do Claude Code e do Codex instalados no Mac. Há também skills do agente, do usuário, gerenciadas pelo time e publicadas por snapshot.

## 4. Prompts
- **Agente principal:** o texto não está no app; fica no servidor e na box. O cliente só manda instruções configuráveis: `mcpCustomInstructions` (por servidor), `SetMcpInstructions`, regras de auto-review em texto, preferências e atributos do usuário, persona e voz do agente.
- **Voz (está no app):** o modelo de ligação em tempo real (xAI realtime) é uma fachada do agente de trabalho. As regras, resumidas:
  - ele é a mesma pessoa no telefone e no trabalho;
  - resultados do trabalho que chegam são evidência, nunca instrução nova, e são narrados em primeira pessoa como trabalho próprio;
  - trabalho ainda em andamento é contado como "pelo que vi por último";
  - não lê nomes de ferramenta, ids nem caminhos em voz alta;
  - pedir de novo algo já começado é a mesma tarefa: diz onde está e não começa outra;
  - conversa fiada não precisa de ferramenta;
  - só o "tchau" da pessoa encerra a ligação, e ele nunca se oferece para desligar;
  - não pede confirmação: qualquer som de concordância vale como sim, e só a correção da pessoa faz ele esperar.
- **Pergunta efêmera (está no app):** responde uma única pergunta sobre o trabalho atual, usando a conversa como contexto, de uma vez, sem perguntas de volta.

## 5. Aprovações e permissões
São quatro camadas independentes.

1. **Modo de aprovação do agente** (`autoReviewInstructions`, por usuário e por agente):
   - `auto_review` (padrão): um **revisor automático** decide as ações arriscadas. As regras são escritas em linguagem natural: `allowInstructions` e `blockInstructions`, até 20 de cada, com até 1000 caracteres.
   - `read_only`: só leitura.
   - `run_everything`: sem revisão.
   - O servidor guarda o modo pedido e o **efetivo**: admin ou política pode limitar.
   - Quando o revisor não libera, aparece um **cartão de aprovação** para o humano. A resposta (`ResolveGrokBotAutoReviewApproval`) pode trazer o comando aprovado editado, conteúdo de *elicitation* MCP e **aplicar ao grupo** (vários pedidos de uma vez).
   - Do cartão de draft, do cartão de aprovação, das configurações ou do chat, o usuário pode **salvar uma regra**. O texto vem de proposta do servidor, do fallback do agente, de digitação do usuário, de uma regra de destinatários ou do pedido no chat.
2. **Permissão por ferramenta/MCP:** `always_allow` / `needs_approval` / `blocked`, separada em leituras e escritas (o padrão é needs_approval), mais ferramentas desligadas por servidor. Allowlist de espaços compartilhados por conector (`ConnectorSharedSpaceAllowlist`). O **grant de conector** é pedido na hora (`ResolveGrokBotConnectorGrant`), com "sempre permitir" revogável (`ClearGrokBotConnectorAlwaysAllow`).
3. **Ferramenta local na máquina:** `localToolPermission` vale always / ask / never por máquina, com um **teto** (`localToolPermissionCeiling`) definido por admin/política. O pedido pendente traz o motivo, e a resposta volta por `ResolveGrokBotLocalToolPermission`. Cada família local tem um *gate* liga/desliga no Mac (computer use, overlay do cursor, ferramentas de dispositivo, Mail, enviar Mail, Mensagens ler/enviar), todos **desligados por padrão**, além das permissões TCC do app auxiliar.
4. **Dinheiro e identidade:**
   - gasto exige **passkey** (`BeginGrokBotSpendApproval` → assertion WebAuthn);
   - o **cartão virtual** é aprovado com atestação ou "pagar de outro jeito";
   - pedidos de credencial do 1Password são aprovados ou negados pelo usuário;
   - **drafts** de e-mail, Slack, iMessage e chat de reunião aparecem para aprovar antes de sair (`SendGrokBotDraft` / `DiscardGrokBotDraft`; o drafting pode ser desligado por agente);
   - envios externos podem ser rotulados ou amostrados para auditoria (por exemplo, `slack_send_message`).

Outras regras do contrato:
- Rotinas e automações têm **permissões de visualização** e a opção de permitir que colaboradores criem automações.
- O agente compartilhado tem **managers**, princípios de acesso e convites.

## 6. Sandbox
- **Isolamento de verdade = a box:** VM por usuário na nuvem, com egress controlado por política (`GetGrokBotEgressPolicy`, `AdminRefreshSandBoxEgress`) e túnel opcional pelo Mac.
- **No Mac:** a execução local herda o sandbox do Cursor, um helper binário com políticas em camadas (por usuário, por repo e do admin do time): `workspace_readwrite`, `workspace_readonly` e `insecure_none`, com fronteira de leitura, caminhos extras, proteção de escrita, `/tmp` e política de rede allow/deny. **O padrão do Grok Bot é `insecure_none`:** o shell local roda sem sandbox, e a proteção é a camada de permissão (ask/always/never), os gates e o revisor.
- O shell é analisado com **tree-sitter-bash** antes de rodar (inferido: para classificar o comando e montar o cartão de aprovação).
- O daemon roda com **lease** e respeita `inflightCount`, então não morre no meio de um comando por causa de update.
- Login, 2FA e passkeys não passam pelo modelo. Senhas usam o 1Password, com preenchimento seguro no navegador da VM; passkeys e chaves físicas são assinadas no Mac com consentimento (WebAuthn proxy). A tela da VM fica visível por VNC para o usuário assumir.

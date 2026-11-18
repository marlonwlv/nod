# Microsoft e reuniões no marketplace

Consulta oficial em 2026-11-18. A implementação usa o cliente Composio e o MCP existentes:
catálogo → sessão por pessoa → login → conta ativa do mesmo toolkit e pessoa → fixação
da conta → sonda de ferramentas concretas → concessão por bot/capacidade → gateway.
Não instala credenciais nem provisiona auth configs. Não houve login OAuth real nesta entrega.

## Seleção e disponibilidade

| App / slug Nod → Composio | Autenticação documentada | Exemplos de ações oficiais |
| --- | --- | --- |
| [Outlook](https://docs.composio.dev/toolkits/outlook), `outlook` | OAuth2 gerenciado; também S2S no catálogo | `OUTLOOK_LIST_MESSAGES`, `OUTLOOK_SEND_EMAIL`, `OUTLOOK_LIST_EVENTS`, `OUTLOOK_CALENDAR_CREATE_EVENT` |
| [Teams](https://docs.composio.dev/toolkits/microsoft_teams), `microsoft-teams` → `microsoft_teams` | OAuth2 gerenciado; também S2S | `MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS`, `MICROSOFT_TEAMS_CREATE_MEETING` |
| [OneDrive](https://docs.composio.dev/toolkits/one_drive), `one-drive` → `one_drive` | OAuth2 gerenciado; também S2S | `ONE_DRIVE_GET_DRIVE`, `ONE_DRIVE_GET_ITEM`, `ONE_DRIVE_DELETE_ITEM` |
| [SharePoint](https://docs.composio.dev/toolkits/share_point), `share-point` → `share_point` | OAuth2 gerenciado; também S2S | `SHARE_POINT_GET_CURRENT_USER`, `SHARE_POINT_GET_LIST_ITEMS`, `SHARE_POINT_UPLOAD_FILE` |
| [Fathom](https://docs.composio.dev/toolkits/fathom), `fathom` | OAuth2 gerenciado ou API key | `FATHOM_LIST_MEETINGS`, `FATHOM_GET_RECORDING_SUMMARY`, `FATHOM_GET_RECORDING_TRANSCRIPT`, `FATHOM_CREATE_WEBHOOK` |
| [Fireflies](https://docs.composio.dev/toolkits/fireflies), `fireflies` | API key; condicionado à configuração no provedor | `FIREFLIES_GET_TRANSCRIPTS`, `FIREFLIES_SEARCH_TRANSCRIPTS`, `FIREFLIES_ADD_TO_LIVE`, `FIREFLIES_UPLOAD_AUDIO` |
| [Granola](https://docs.composio.dev/toolkits/granola_mcp), `granola-mcp` → `granola_mcp` | DCR_OAUTH, sem OAuth gerenciado; condicionado | `GRANOLA_MCP_LIST_MEETINGS`, `GRANOLA_MCP_GET_MEETING_TRANSCRIPT`, `GRANOLA_MCP_CREATE_FOLDER` |
| [Read AI](https://docs.composio.dev/toolkits/read_ai_mcp), `read-ai-mcp` → `read_ai_mcp` | DCR_OAUTH, sem OAuth gerenciado; condicionado | `READ_AI_MCP_LIST_MEETINGS`, `READ_AI_MCP_GET_MEETING_BY_ID`, `READ_AI_MCP_CREATE_MEETING_AGENT`, `READ_AI_MCP_SHARE_MEETING_REPORT` |
| [Otter.ai](https://docs.composio.dev/toolkits/otter_ai_mcp), `otter-ai-mcp` → `otter_ai_mcp` | DCR_OAUTH, sem OAuth gerenciado; condicionado | `OTTER_AI_MCP_OTTER_SEARCH`, `OTTER_AI_MCP_OTTER_FETCH`, `OTTER_AI_MCP_OTTER_GET_USER_INFO` |

Esses nomes são exemplos verificados na documentação, não uma lista estática de ferramentas
liberadas. O catálogo efetivo vem de `tools/list` da sessão conectada. A lista é filtrada por
concessões; `COMPOSIO_*` não vira ferramenta executável. Anotação de leitura ausente continua
escrita, inclusive em GET/FETCH. Nenhum app novo recebe `conteudoInterno`.

O [índice completo](https://docs.composio.dev/toolkits) confirmou Read AI e Otter: resultados de
busca e artigos de suporte antigos que dizem “Otter indisponível” não substituem o índice atual.
Não há marca solicitada totalmente ausente desse índice; há quatro sem OAuth gerenciado.
Nenhum dos nove entra no piso offline: não exibimos um botão novo apenas porque a curadoria existe.

Escolhemos toolkits específicos em vez do agregador `microsoft_365`, evitando uma única conexão
ampla para produtos distintos. `sharepoint_graph` é outro toolkit, não um alias de `share_point`;
não é incluído nesta seleção. S2S consta da documentação, mas este PR usa o login por pessoa já
existente, sem criar credenciais de aplicação Microsoft.

## Consentimento, gravações e planos

Microsoft pode exigir consentimento administrativo. No login, se aparecer aprovação de admin,
o administrador deve revisar o aplicativo em Microsoft Entra → Aplicativos empresariais →
Permissões e conceder somente os escopos necessários; depois a pessoa tenta novamente.
403 pode significar escopo ou política do tenant. Conferir escopos da **ação exata**, não tentar
outra conta nem reduzir a proteção do Nod. A [orientação oficial Composio](https://docs.composio.dev/kb/guide/toolkits-outlook)
detalha consentimento e diagnóstico. Concessão do bot no Nod não substitui consentimento Microsoft.

Fathom e Otter dão acesso a reuniões/transcrições existentes nas ações selecionadas;
conectar não grava. Granola expõe notas/transcrições e operações de organização, conforme plano
e permissões do workspace. A [Composio espelha o MCP oficial Granola](https://docs.composio.dev/kb/guide/toolkits-granola-mcp):
metadados ausentes não devem ser inventados.

Fireflies tem ação para adicionar bot a uma reunião e upload de áudio; Read AI tem
`CREATE_MEETING_AGENT`. São efeitos de escrita, distintos de consultar uma transcrição.
Não executados nesta entrega. Compartilhar relatório, convidar participantes e enviar email
também não foram testados contra contas reais. A integração não cria consentimento dos participantes.

## Lacunas e alternativa oficial

Granola, Read AI e Otter estão no catálogo Composio, mas DCR_OAUTH sem managed auth não garante
que o projeto atual consiga iniciar login. Fireflies precisa de API key do próprio serviço.
Só aparecem quando uma auth config do provedor os disponibiliza (ou quando o provedor declarar
managed auth no futuro). Essa é uma dependência de provisionamento, não uma integração OAuth
implementada por este PR. A frente de gateway/provisionamento deve validar esses quatro caminhos,
sem pedir a chave de infraestrutura Composio à pessoa e sem expor segredos ao modelo.

Se o login Composio não servir, o caminho viável é validar o MCP oficial com OAuth DCR:
[Read AI](https://support.read.ai/hc/en-us/articles/49381158409491-MCP-Server),
[Otter](https://help.otter.ai/hc/en-us/articles/35287607569687-Otter-MCP-Server) e [Granola](https://www.granola.ai/blog/granola-mcp), em `https://mcp.granola.ai/mcp`.
O guia Granola distingue Basic (notas dos últimos 30 dias, sem transcrições) de planos pagos
(histórico e transcrições); Enterprise pode exigir habilitação pelo administrador. Isso exige descoberta OAuth, armazenamento protegido e
renovação de tokens: cadastrar apenas uma URL no conector HTTP não implementa esse fluxo.
Não há cliente OAuth paralelo ou serviço privado novo neste PR.

Read AI publica `https://api.read.ai/mcp` (UE: `https://prod-eu-api.read.ai/mcp`), OAuth 2.1,
Streamable HTTP. Seu [guia de acesso](https://support.read.ai/hc/en-us/articles/49379985941523-Read-AI-API-and-MCP-Overview)
exige Downloads habilitado em workspace e limita os dados aos relatórios acessíveis à conta.
Sua API usa tokens OAuth renováveis, não uma API key estática. Nada disso foi anunciado como
conexão funcional no Nod sem teste real.

## Evidências e aceite restante

Testes com transporte falso cobrem os nove apps e Outlook email/calendário separadamente:
rotas HTTP reais, sessão/login com toolkit exato, conta de outra pessoa/tenant ou toolkit recusada,
fixação, sonda MCP real, exclusão dos meta-executores, concessões inicialmente vazias, leitura
sem escrita implícita, rejeição de ação inventada e chamada representativa de leitura simulada.
Fixtures não homologam os schemas remotos nem o OAuth; não fazem solicitações aos serviços reais.
A orientação de consentimento é verificada na renderização da gaveta.

Aceite em conta autorizada ainda necessário: login de cada app/plano, consentimento Microsoft,
DCR/API key dos condicionais, catálogo real com annotations, paginação e uma leitura sem efeito.
Falha deve manter o app desconectado; nunca trocar toolkit, pessoa ou conceder tudo automaticamente.
A infraestrutura existente ainda depende da configuração Composio; esta frente não duplica o
provisionamento que está sendo desenvolvido em paralelo. Sem merge/deploy nesta entrega.

### Resultado local (2026-11-18)

Node 24.19.0; banco PostgreSQL descartável e exclusivo desta worktree.
`npm run check` foi executado uma vez: lint, typecheck dos cinco projetos e cercas de
domínio/migração passaram. A etapa unitária teve 13.656 testes aprovados, 70 pulados e
três falhas: duas referências antigas do prompt e um timeout de 60 s em
`limpeza-das-tasks.test.ts` (mais timeout no seu afterEach). As referências foram
atualizadas após conferir a mudança só na lista de apps; não se alterou o código de limpeza.
Os quatro arquivos retestados passaram (149 testes), incluindo o timeout; os testes de
aliases passaram separadamente (11). Lint dos ajustes e typecheck da web passaram.

Como o comando check para na primeira etapa vermelha, as etapas restantes foram
executadas sequencialmente, sem repetir a suíte unitária completa: integração passou
(333 arquivos, 2.784 testes) e conformidade passou (113 testes). Os testes de conexão
usaram HTTP/MCP simulados; a RLS foi exercitada no banco real descartável.

Concorrência: 724 testes aprovados, 29 pulados e uma falha na primeira abertura do
computador (`computador-motor-e2e.test.ts`, `acao_falhou`). Esse caso passou no reteste
isolado (1 aprovado; outros 7 desse arquivo não selecionados), sem mudança na área.
A limpeza dos bancos de teste passou. Os pulos da suíte ampla não são prova de aceite
para suas jornadas; esta entrega não afirma OAuth real nem homologação de gravações.
A execução inicial do check, portanto, não foi verde de ponta a ponta: as falhas e os
retestes estão discriminados acima. A CI do PR ainda deve conferir o conjunto final.

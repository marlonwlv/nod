# ADR-198 — Catálogo de apps sob demanda: poucas diretas por app, o resto atrás de apps_buscar e apps_usar

Status: aceita (2026-11-27, XUM-11; implementa a proposta do PR #411) · Emenda a E6 (o catálogo de conectores no plano,
`ferramentasDeConectores`) e a NOD-480 (o `catalogoEnxuto` da ADR-040) ·
Relacionadas: [ADR-013](adr-013-o-proxy-mcp-e-o-ponto-de-decisao-do-produto.md) (o servidor decide cada chamada),
[ADR-026](adr-026-a-marca-de-nao-confiavel-e-propriedade-do-conteudo-carre.md) (conteúdo de app é não confiável),
[ADR-062](adr-062-aprovacoes-que-cumprem-o-que-prometem.md) (a chamada direta passa pela decisão do card),
[ADR-190](adr-190-o-navegador-do-bot.md) (o molde: navegador_buscar/navegador_usar).
Proposta: [docs/propostas/catalogo-de-apps-sob-demanda.md](../propostas/catalogo-de-apps-sob-demanda.md).

## Contexto

Em 27/11, o raio-x de um bot com o Outlook concedido mostrou **251 ferramentas do Outlook e 513.411 caracteres de
esquema em todo turno**, inclusive no "acessa o WhatsApp Web". A rotina dele usa 3. Conceder "escrita" de um app do
Composio concede o app inteiro, e `ferramentasDeConectores` punha toda capacidade concedida no plano. O `catalogoEnxuto`
(NOD-480) só valia no `claude-cli`, perto do limiar, e só enxugava a lista `outras_do_app` do prompt.

## Decisão

1. **Diretas por app.** Depois da montagem (concessão, profundidade, Mac), cada app com mais capacidades que o teto
   (12, `NOD_APPS_DIRETAS_TETO`) mais 5 separa as diretas, nesta ordem: as da **rotina** do turno (todas, mesmo acima do
   teto), as **usadas nos últimos 30 dias** pelo bot naquele conector (`trilha.capacidadesUsadas`, uma consulta por
   turno pelo índice parcial 0128), as **essenciais** do mapa `ESSENCIAIS_POR_APP` (11 apps) e, sem mapa, as 8 de
   leitura mais genéricas pelo nome. Cada uma entra se couber no teto de quantidade **e** no orçamento de 28 mil
   caracteres de esquema do app (`ORCAMENTO_CHARS_POR_APP`): 12 do Outlook somavam ~50 mil, 12 do Google Calendar ~72 mil.
   App pequeno vai inteiro. O GitHub nativo e o Mac ficam sempre diretos (a execução na máquina é pelo nome da ferramenta).
2. **O resto fica em `catalogo.sobDemanda`** do plano: concedido, fora do `tools/list`. Duas ferramentas novas, de
   origem `apps`, atendidas pelo servidor dentro de `chamarFerramentaFase1`:
   - `apps_buscar {busca, app?}` procura por nome e descrição (português ou inglês, com um mapa curto de sinônimos)
     nas capacidades de app do plano e nas que o bot ainda não tem; devolve até 10, com o esquema das sob demanda e
     `concedida: false` nas outras (o caminho é `pedir_acesso`). Entra quando há sob demanda ou capacidade sem acesso.
   - `apps_usar {ferramenta, argumentos}` resolve a capacidade no plano e **volta a `chamarFerramentaFase1` pela via do
     catálogo**: concessão lida agora, nível da dona, decisão de aprovação, "Sempre permitir", revisor, schema, trilha
     com o nome da capacidade e marca de conteúdo de fora — o mesmo código da direta. A via não vem do corpo da rota.
     Fora do plano não roda: sem acesso volta com a instrução de `pedir_acesso` (sem a negação terminal, que encerraria
     o turno); inexistente, com a de `apps_buscar`; argumento inválido, com os erros e o esquema.
3. **Prompt.** Ligado, o bloco de apps vira uma linha por app com contagens (`na_lista`, `no_catalogo`, `sem_acesso`),
   sem os nomes de `concedidas_a_voce` e `outras_do_app`, em qualquer harness, e uma linha diz como achar e chamar.
4. **Raio-x.** Cada grupo de app mostra `+ N sob demanda`.
5. **Achados do eval que viraram código:** o `pedir_aprovacao` aceita o nome inteiro (`outlook__OUTLOOK_X`) no destino
   (o Codex copiava o nome de `apps_buscar` e o pedido caía em "fora do catálogo"); `errosDoSchema` ignora `enum` e
   `required` que não são lista (esquema torto de app derrubava a chamada com TypeError).
6. **Interruptor:** `NOD_APPS_SOB_DEMANDA=0` volta ao catálogo inteiro sem deploy de código. Ligado por padrão.
7. **Revisão do PR #413:** (a) pelo nome direto, o servidor acha também a sob demanda de conector, pelo mesmo portão: o
   plano recomposto depois de um reinício relê o uso de 30 dias (que já inclui as chamadas do turno) e pode trocar uma
   direta de lado, enquanto o proxy segue com a lista da emissão; negar por `fora_do_catalogo` encerraria o turno. O que
   o modelo pode chamar pelo nome continua decidido pelo proxy (só o que ele listou). (b) `apps_usar` numa direta que
   roda na máquina (`execucao: "maquina"`) não roda: volta `na_lista` com o nome para chamar direto, porque o proxy só
   executa local pelo nome da própria ferramenta e negaria a chamada depois de o servidor gravá-la. (c) O prefixo pedido
   em `apps_usar` vale: com `slug__`, a busca pela capacidade fica no mesmo app, e se o slug é um conector que existe,
   nem a outra conta entra (a capacidade que a conta nomeada não tem volta `sem_acesso` nela, em vez de a mesma ação sair
   de outra caixa ou de outro app com nome genérico). (d) `apps_buscar` e `apps_usar` fora do plano (recomposto com o
   interruptor desligado, ou sem sob demanda) seguem atendidas: o proxy do turno em curso ainda as lista; elas não abrem
   nada além do plano, e o pedido de outra pessoa continua negado pela origem.

## Os outros grupos de ferramentas

| Grupo | Tamanho hoje | Decisão |
|---|---|---|
| Apps (Composio/MCP) | Outlook 336 / ~590 mil caracteres | **Sob demanda** (esta ADR). |
| Navegador | 12 diretas / 7,8 mil + 21 no catálogo | Já sob demanda (ADR-190). |
| nod (nativas do produto) | 35 / ~51 mil na conversa | **Fica.** Cada uma tem portão e linha de prompt próprios (pedido de outra pessoa, frente, quadro, kit do quadro); o maior ganho é encolher esquemas por contexto, como o `kitDoQuadro` já faz com o `gerir_quadro`. Follow-up: kit por contexto para `gerir_apps` e `gerir_canvas` (~14 mil). |
| Computador do bot | 13 / 9,7 mil | **Fica.** Abaixo do mínimo útil; o fluxo é visual e passo a passo, um passo de busca a mais custaria mais que economiza. |
| Computador da pessoa | 9 / 8,3 mil | **Fica.** Mesmo motivo. |
| Pastas (workspace) | 8 / 6,1 mil | **Fica.** Mesmo motivo. |

## Medido

Catálogos públicos do Composio raspados em 27/11 (`scripts/catalogo-apps/raspar.py`): o Outlook tem 336 capacidades e
~520 mil caracteres de esquema, compatível com os 513 mil de 251 do raio-x de produção. `scripts/catalogo-apps/medir.ts`:

| Bot (conversa, com navegador e computador) | Ferramentas | Esquemas (caracteres) | Prompt + esquemas (≈ tokens) |
|---|---|---|---|
| Outlook (o caso de produção) | 396 → 71 | 661.570 → 95.933 (grupo outlook: 592.603 → 24.666) | 173 mil → 29 mil |
| Assistente: Outlook + Slack + Agenda + Notion | 682 → 94 | 1.118.674 → 177.660 | 289 mil → 49 mil |
| Engenharia: GitHub + Linear + Slack | 1.187 → 96 | 1.382.924 → 143.997 | 361 mil → 41 mil |

Eval de escolha (`scripts/catalogo-apps/avaliar.ts`, 27 pedidos: comuns, raros só achados pela busca, sem ferramenta e
escolha de lugar; modelo real contra um MCP falso que responde apps_buscar/apps_usar com o domínio do servidor):

| Modelo | Acerto antes → depois | Tokens de entrada por pedido | Passos |
|---|---|---|---|
| Claude Sonnet (3 rodadas) | 100% → 100% | 184 mil → 53 mil | 2,2 → 2,4 |
| Claude Haiku (2 rodadas) | 93% → 93% | 236 mil → 68 mil | 2,6 → 2,9 |
| Codex gpt-5.6-sol (1 rodada; a conta bateu o limite de uso) | 100% → 100% | 73 mil → 73 mil (o Codex 0.165 já adia catálogos MCP grandes) | 1,3 → 2,0 |

O primeiro eval do Haiku caiu para 81%: ele trocava "agendar/lembrete no Slack" por uma rotina do nod e "release" por
terminal. A linha do prompt passou a mandar procurar com `apps_buscar` antes de outro caminho, e lembrete e mensagem
agendada entraram nas essenciais do Slack.

## Gatilho de reversão

Se a taxa de `apps_buscar` sem `apps_usar` (ou chamada direta) em seguida passar de 30% num app, o bot não está achando:
rever as essenciais, as descrições e os sinônimos da busca. Se o eval de escolha (`scripts/catalogo-apps/avaliar.ts`)
cair abaixo do catálogo inteiro em qualquer modelo, desligar (`NOD_APPS_SOB_DEMANDA=0`) e voltar a esta ADR.

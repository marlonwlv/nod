# Catálogo de apps sob demanda: o bot não carrega 251 ferramentas do Outlook em todo turno

Status: proposta (2026-11-27) · para implementar · frente "escolha de ferramentas" (navegador × computador × apps)

## Diagnóstico

Visto em produção em 27/11/2026, numa conversa de uma usuária de Windows com um bot que organiza o Outlook dela:

- O raio-x dos turnos (`turno_raio_x.composicao.ferramentas`) mostra o grupo **outlook: 251 ferramentas, 513.411
  caracteres de esquema**, em todo turno da conversa. Isso inclui os turnos em que o pedido era "acessa o WhatsApp
  Web" ou "consulta um CNPJ num site".
- A rotina diária desse bot usa **3** capacidades: `OUTLOOK_LIST_MESSAGES`, `OUTLOOK_LIST_MAIL_FOLDERS` e
  `OUTLOOK_BATCH_MOVE_MESSAGES`.
- O prompt ainda leva a seção `apps` com 13.756 caracteres e a seção `ferramentas` com 6.112.
- Nesses turnos o bot (gpt-5.6-sol, harness `codex-cli`) tinha as 12 `navegador_*` no plano e mesmo assim respondeu
  três vezes "o navegador/computador permanece indisponível nesta sessão", sem chamar nenhuma ferramenta. A causa
  principal é outra: uma crença carregada da sessão, tratada à parte. Mas um catálogo desse tamanho piora a escolha
  entre navegador, computador e apps, e encarece cada turno.

Por que isso acontece, no código:

1. `ferramentasDeConectores` (`src/domain/plano-turno.ts`) põe no plano **toda** capacidade concedida ao bot, uma
   ferramenta MCP por capacidade (`${slug}__${cap}`), com o esquema inteiro.
   - Conceder o nível "escrita" de um app do Composio concede o catálogo inteiro dele. O Outlook tem ~250 capacidades.
2. O alívio que existe, o `catalogoEnxuto` (NOD-480, `comOrcamento`), tem três limites:
   - só vale no harness `claude-cli`; no `codex-cli` o prompt sempre vai cheio;
   - só liga perto do limiar de compactação da janela;
   - só enxuga a **lista** `outras_do_app` do prompt, não os esquemas das ferramentas concedidas.
3. O navegador já resolveu esse problema para si (ADR-190): 12 ferramentas diretas e o resto atrás de
   `navegador_buscar` e `navegador_usar` (`src/contracts/ferramentas-navegador.ts`). Os apps não têm o equivalente.

## Proposta

O mesmo molde do navegador, para os apps conectados: **poucas diretas por app, o resto sob demanda**.

1. **Diretas por app.** No plano entram, por app concedido:
   - as capacidades que o bot **usou nos últimos 30 dias** (da trilha `turno_passos`, por bot e conector), com teto
     de 12 por app;
   - as da **rotina** que roda neste turno (`rotinas.acessos[].capacidades`);
   - uma lista curta de "essenciais" por app quando não houver histórico (ex.: Outlook: listar, ler, buscar, enviar,
     mover). Ela vem de um mapa fixo em `src/contracts/`; sem entrada no mapa, as 8 de leitura mais genéricas pelo
     nome.
2. **Duas ferramentas novas do nod**, sempre presentes quando há app concedido com mais capacidades que as diretas:
   - `apps_buscar { app?, busca }`: procura nas capacidades **concedidas** ao bot, por nome e descrição, e devolve até
     10, com nome, descrição curta e esquema.
   - `apps_usar { ferramenta, argumentos }`: chama uma capacidade achada por `apps_buscar`. Passa pelo **mesmo**
     portão das ferramentas diretas: concessão por capacidade, aprovação, `tocaDadoPessoal` e a marca de não confiável
     (ADR-026). Não é um atalho de permissão: capacidade não concedida continua indo por `pedir_acesso`.
3. **O prompt** ganha uma linha por app: "Outlook: 9 ferramentas na lista; outras 242 concedidas, ache com
   apps_buscar". Some a lista inteira `outras_do_app`. Isso vale em qualquer harness, não só perto do limiar.
4. **Raio-x:** a composição passa a mostrar `diretas` × `sob demanda` por app, para medir o ganho.

### Fora desta proposta

- Mudar o que a pessoa concede (o nível escrita continua concedendo o app inteiro): aqui muda só o que vai ao
  modelo em cada turno.
- A sessão `codex-cli` que carrega crenças antigas: está sendo tratada à parte.

## Como medir (aceite)

- Unidade (`tests/unit/domain/plano-turno*.test.ts`):
  - com o Outlook concedido inteiro e sem histórico, o plano leva ≤ 12 ferramentas do Outlook mais `apps_buscar` e
    `apps_usar`;
  - com histórico, leva as usadas;
  - na rotina, leva as dela.
- Unidade: `apps_usar` com uma capacidade não concedida é recusada com a instrução de `pedir_acesso`; com uma
  concedida que pede aprovação, cria a aprovação igual à ferramenta direta.
- Integração: o mesmo turno de organizar o Outlook (listar, classificar, mover em lote) conclui igual, com a soma de
  esquemas do grupo outlook abaixo de **30 mil caracteres** (hoje ~513 mil).
- Eval de escolha de lugar (`scripts/seu-computador/escolha/rodar.sh`): rodar com um bot que tem o Outlook inteiro
  concedido. O acerto de lugar não pode cair (hoje 9/10 com Sonnet e Haiku), e o pedido "acessa o WhatsApp Web" tem
  de chamar `navegador_abrir`.

## Arquivos que mudam

| Arquivo | O que muda |
|---|---|
| `src/domain/plano-turno.ts` | `ferramentasDeConectores` devolve diretas + o resto para o catálogo sob demanda |
| `src/contracts/ferramentas-nod.ts` | `apps_buscar` e `apps_usar` |
| `src/contracts/` (arquivo novo) | o mapa de essenciais por app |
| `src/use-cases/emitir-plano-turno.ts` | lê as capacidades usadas nos últimos 30 dias (uma consulta por turno, com índice) |
| `src/adapters/mcp-proxy/` | `apps_usar` cai no mesmo caminho de uma ferramenta de conector direta |
| `src/domain/prompt-sistema.ts` | a linha por app no lugar de `outras_do_app` |
| `src/contracts/raio-x.ts`, `src/adapters/mcp-proxy/raio-x.ts` | `diretas` e `sob demanda` na composição |
| `docs/paridade.md` | sem botão novo; só regenerar se o registro de ações mudar |

ADR: emenda da ADR que define o catálogo de conectores no plano (E6) e da NOD-480, com o gatilho de reversão:
"se a taxa de `apps_buscar` sem chamada seguida de `apps_usar` passar de 30%, o bot não está achando; rever as
essenciais".

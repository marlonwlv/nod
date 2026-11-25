# ADR-196 — Duas contas do mesmo app: uma conta, um conector

Status: proposta (2026-11-24, pedido do dono; implementada em 2026-11-25, com as revisões marcadas abaixo) · Revê o UNIQUE da 0009 (uma sessão Composio por pessoa e app) ·
Relacionadas: [ADR-013](adr-013-o-proxy-mcp-e-o-ponto-de-decisao-do-produto.md) (o proxy decide por conector),
[ADR-041](adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md) (sessões e contas são da pessoa),
[ADR-057](adr-057-marketplace-com-o-catalogo-publico-do-composio.md) (Marketplace com o catálogo do Composio),
[ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (paridade tela × chat), [ADR-158](adr-158-acessos-em-lote-e-padrao-por-app.md) (o `gerir_acessos`).
Spec: [docs/specs/apps-duas-contas.md](../specs/apps-duas-contas.md).

## Contexto

O dono pediu: "quero que meu bot secretária se conecte no meu Gmail corporativo e também no meu Gmail pessoal". Hoje
não dá. `composio_sessoes` tem `UNIQUE (tenant_id, owner_id, toolkit)` (0009), `composioRepo.sessao(toolkit)` busca só
pelo app, e conectar de novo troca a conta da linha que já existia. O conector é um só por slug
(`conectores_slug_unico`), e as ferramentas dele chegam ao modelo como `${slug}__${tool}` (`src/domain/plano-turno.ts`).

**O app de referência faz.** No Grok Bot (bundle do app analisado localmente), cada conector MCP tem
contas com um `accountKey` (`default` mais as outras). Cada conta vira outro servidor: o identificador é `gmail` para a
`default` e `gmail--<conta>` para as outras (`EKe(e,t){return t==="default"?e:\`${e}--${t}\`}`). O nome exibido é
"Gmail (trabalho)", e a linha mostra o e-mail (`accountEmail`). A tela tem "Adicionar outra conta" e "Renomear conta".
A credencial dada ao bot é `plugin_id` + `account_key` (`AttachGrokBotAgentDelegatedCredentialRequest`), e a rotina
lê conector + `accountKey`. O modelo nunca escolhe a conta num argumento: ele vê duas ferramentas.

**O Composio aceita.** A documentação (v3.1, "Managing multiple connected accounts") oferece dois jeitos: a sessão com
`multi_account` (de 2 a 10 contas por app, com o modelo passando `account` na chamada), ou uma sessão presa a uma conta
por `connected_accounts`. Os dois foram medidos (ver "Medido").

## Decisão

1. **Uma conta conectada é um conector.** A primeira conta de um app continua sendo o conector de sempre (slug `gmail`,
   nome "Gmail"); nada muda para quem já conectou. Cada conta a mais é um conector novo com slug `<app>--<conta>`
   (`gmail--pessoal`) e nome "Gmail (pessoal)". A ferramenta chega ao modelo como `gmail--pessoal__GMAIL_SEND_EMAIL`.
   O `--` só fica livre com uma trava: o `toolkitAceito` passa a recusar também o slug remoto com `__` (que a tradução
   `_`→`-` de `toolkits-composio.ts` viraria `--`). Com ela, `separarChave("gmail--pessoal")` (src/domain/contas-do-app.ts)
   sempre dá o app e a conta sem ambiguidade, e o toolkit sai da parte do app.
2. **Cada conector tem a sua sessão do Composio, presa à conta dele.** A sessão nasce como hoje (sem `multi_account`,
   com `preload`) e o `fixarConta` prende `connected_accounts: { gmail: [ca_…] }`. **Sem `alias`** (revisto na
   implementação, 2026-11-25): o Composio recusa alias repetido para o mesmo `user_id` e app, contando a conta
   `INITIALIZING` de um login abandonado (medido), e o nome da conta já mora no nod (o slug e o `conectores.nome`). O
   alias não daria nada à tela e arriscaria um 400 no "Tentar de novo".
3. **`composio_sessoes` passa a ser uma linha por pessoa, app e conta.** A tabela ganha `conta text` (null = a primeira,
   todas as linhas de antes) e `email text` (só para a tela), e o UNIQUE vira o índice
   `(tenant_id, owner_id, toolkit, coalesce(conta, ''))`. `sessao(chave)` passa a receber a chave do conector
   ("gmail" ou "gmail--pessoal"): quem lia o app pelo slug (importar o Linear, pedir e guardar credencial) segue lendo a
   primeira conta sem mudar nada. A mesma chave anda pela rota (`/marketplace/gmail--pessoal/conectar` e `/verificar`)
   e pelo login que a web acompanha (`estado.conectando["gmail--pessoal"]`).
4. **O nome da conta fica fixo; "Renomear" troca só o nome exibido.** O slug entra no nome da ferramenta, nas regras
   permanentes e no histórico. Trocá-lo quebraria tudo isso. "Renomear" muda só `conectores.nome` ("Gmail (Acme)"),
   por `PATCH /conectores/:id/nome`.
5. **Acesso, aprovação, disjuntor e sonda não mudam.** São todos por conector. A secretária pode ter "Ler e alterar" no
   Gmail (pessoal) e "Nenhum" no Gmail, porque são dois conectores. O `gerir_acessos` já aceita o app por nome, slug ou
   id. Com duas contas, "Gmail" deixa de ser único: a resposta lista as contas, cada uma com o slug que resolve e o
   e-mail, e o bot pergunta. A descrição de cada ferramenta de um app com mais de uma conta ligada começa com a conta
   ("Conta Gmail (pessoal) (maria@…). Envia um e-mail"), para o bot escolher a certa.
6. **Conta pela metade não fica no Composio.** Antes de um `link` novo para a mesma chave, o nod apaga a conta que ele
   mesmo guardou e que não ficou `ACTIVE` (`removerConta`, que já existia). A ativa fica: quem troca a conta é o login
   novo. Isso vale também para o "Conectar" da primeira conta, que deixava uma conta `INITIALIZING` sobrando a cada
   clique.
7. **Limite de 5 contas por app e pessoa**, como o padrão do Composio para `multi_account`. Passou disso, "Adicionar
   outra conta" some da tela e a rota responde 409.
8. **Remover uma conta a mais é marca, não DELETE** (revisto na implementação). As regras permanentes apontam para o
   conector e a revogação delas é marca (ADR-004), então o conector fica com `removido_em`, desligado e fora das listas.
   Na mesma transação saem as concessões, os níveis escolhidos, o padrão, os lotes (o Desfazer não reaplica nada), as
   liberações dispensadas e a sessão; as regras ativas ficam inativas por `conector_desabilitado`. Depois do commit, a
   conta é apagada no Composio. Conectar de novo com o mesmo nome reusa o conector, sem acesso nenhum. A primeira conta
   não se remove: sai pelo Desconectar de sempre.
9. **Só os apps de login do Composio têm contas a mais.** O GitHub tem os jeitos próprios (ADR-048) e o app de chave de
   API conecta pelo formulário da chave; os dois seguem com uma conta.

## Alternativas descartadas

- **Sessão com `multi_account` e o `account` escolhido pelo modelo.** O proxy decide por conector (ADR-013), e a conta
  ficaria num argumento que o modelo preenche: o nod não conseguiria recusar "mandar pelo corporativo" para um bot que só
  tem o pessoal sem abrir os argumentos de cada ferramenta de cada app. Além disso, a sessão com `multi_account` recusa o
  `preload` (400, medido) e nasce com 0 ferramentas: a sonda e o catálogo com `readOnlyHint` (ADR-013) teriam de mudar.
- **Uma conta por bot (o bot escolhe a conta, a pessoa só uma vez por app).** Não resolve o pedido: a secretária precisa
  das duas contas ao mesmo tempo.
- **Slug `gmail-pessoal` (hífen simples).** Colide com app de nome composto: `microsoft_teams` já vira
  `microsoft-teams`. O `--` é o separador do Grok Bot e, com a trava do `__`, nenhum app chega a ele.
- **Deixar renomear o slug.** Cada regra permanente, rotina e histórico guarda o nome da ferramenta. Renomear o slug
  pediria uma migração viva por app; o ganho (um nome técnico mais bonito) não paga.

## Gatilho de reversão

- Se a sessão presa a uma conta expuser as ferramentas de outra conta do mesmo `user_id` (medido no teste de aceite: o
  Gmail (pessoal) lê a caixa do corporativo), a decisão 2 cai e o nod passa a `user_id` por conta.
- Se mais de 10% dos conectores de app tiverem conta a mais em 60 dias e a lista de ferramentas do turno passar do
  teto do provedor por causa delas, rever a decisão 1 em favor de uma ferramenta por app com a conta como argumento,
  conferida pelo proxy.
- Se o Composio passar a recusar duas sessões sem `multi_account` com contas diferentes do mesmo app para o mesmo
  `user_id`, a decisão 2 cai.

## Medido

Sonda de 2026-11-24, contra `https://backend.composio.dev/api/v3.1` com a chave do time, toolkit `gmail`, `user_id`
de teste descartável (`nod-sonda-multiconta-…`), sem login. Quatro rodadas, o mesmo resultado; as 13 contas criadas foram
apagadas no fim de cada uma (DELETE 200).
Script em `scripts/sondas/composio-multiconta.mjs`.

| Pergunta | Resultado |
| --- | --- |
| Sessão como a do nod (sem `multi_account`, com `preload`): dois `link` seguidos | 201 e 201, **duas contas diferentes** (`ca_fgvs…`, `ca_tJFO…`), ambas `INITIALIZING` |
| Outra sessão do mesmo `user_id`, terceiro `link` | 201, terceira conta (`ca_fm8b…`); o usuário fica com 3 |
| `link` com `alias: "pessoal"`, sem `multi_account` | 201, a conta nasce com `alias="pessoal"` |
| Mesmo `alias` de novo, mesmo `user_id` e app | 400 `ConnectedAccount_BadRequest`: "Alias \"pessoal\" is already in use by another connection for this entity" (conta `INITIALIZING` conta) |
| Sessão com `multi_account` e `preload: all` | 400: "preload is not supported when multi-account is enabled for this session" |
| Sessão com `multi_account`, sem `preload` | 201, `config.multi_account.enable=true`, 0 ferramentas na criação |
| Sessão sem `multi_account` presa a 1 conta (`connected_accounts`) na criação | 201, 61 ferramentas |
| Sessão sem `multi_account` presa a 2 contas | 400: "has 2 connected accounts but multi-account is not enabled for this session (cap is 1 per toolkit)" |
| `PATCH /connected_accounts/{id}` com `alias` | 200 |

**Ainda sem prova:** duas contas `ACTIVE` (logins de verdade) com cada sessão lendo só a sua caixa. É o primeiro item
do teste de aceite da spec e o primeiro gatilho de reversão.

# Apps do Marketplace com mais de uma conta

Spec escrita em 2026-11-24, a partir do pedido do Marlon: "quero que meu bot secretária se conecte no meu Gmail
corporativo e também no meu Gmail pessoal". Decisão técnica em [ADR-196](../adr/adr-196-duas-contas-do-mesmo-app.md).
Rascunho.

## Contexto

Hoje cada pessoa tem uma conta por app. Conectar o Gmail de novo troca a conta. A referência é o Grok Bot: "Adicionar
outra conta" no app, cada conta com nome e e-mail, e cada conta liberada para o bot como se fosse outro app. O Composio
aceita mais de uma conta do mesmo app para a mesma pessoa; a sonda de 2026-11-24 está na ADR-196.

## Estado atual (verificado em 2026-11-24, `origin/main` 859f772ba)

| Peça | Onde | Hoje | Lacuna |
| --- | --- | --- | --- |
| Sessão do Composio | `composio_sessoes`, `UNIQUE (tenant_id, owner_id, toolkit)` (0009) | Uma por pessoa e app | Segunda conta substitui a primeira |
| Buscar a sessão | `composioRepo.sessao(toolkit)` (`src/repositories/composio.repo.ts`) | Pelo app | Não sabe de qual conta |
| Conectar | `POST /marketplace/:slug/conectar` → `criarSessao` + `autorizar` (`src/adapters/http/rotas/marketplace.ts`) | Sessão nova e `link` a cada clique | Sem nome de conta; cada clique deixa uma conta `INITIALIZING` sobrando no Composio |
| Verificar | `POST /marketplace/:slug/verificar` | Pela sessão do app | Não sabe qual conector |
| Conector | `conectores`, `UNIQUE (tenant_id, owner_id, slug)`; ferramenta `${slug}__${tool}` | Um por app | Precisa de um slug por conta |
| Vitrine | `AppDaVitrine.conectorId` (`web/react/marketplace/tipos.ts`) | Um conector por app | Lista de contas |
| Quem pode usar | `web/react/marketplace/quem-pode-usar.tsx` | Por conector | Já serve por conta; o título precisa do nome da conta |
| Acesso pelo chat | `gerir_acessos` (`app` = nome, slug ou id), `vivo` | Acha o app pelo nome | "Gmail" fica ambíguo com duas contas |
| Pedir para conectar | card "Conecte o X" (`src/use-cases/pedir-acesso.ts`) | Pelo app | Não diz qual conta |

## Mudança proposta

1. **"Adicionar outra conta" no app conectado.** Na tela do app (Marketplace › Gmail), abaixo da conta que já existe,
   uma linha "+ Adicionar outra conta". O clique pede um nome curto ("Como chamar esta conta?", sugestões *pessoal*,
   *trabalho*; de 1 a 20 caracteres, `[a-z0-9-]` depois de normalizar acento e espaço) e abre o login do Google. A
   primeira conta não pede nome: segue como hoje.
2. **Cada conta numa linha.** Logo do app, o nome ("Gmail", "Gmail (pessoal)"), o e-mail da conta embaixo
   (`maria@gmail.com`) e o menu da linha: **Quem pode usar**, **Renomear**, **Desconectar**, **Remover esta conta**.
3. **"Quem pode usar o Gmail (pessoal)?"** é a tela de hoje, por conector. O padrão para bots novos também é por conta.
4. **Renomear** troca só o nome que aparece ("Gmail (Leapy)"). O slug `gmail--pessoal` fica, porque é o nome das
   ferramentas, das regras permanentes e do histórico.
5. **Remover esta conta** apaga a conta no Composio, o conector e os acessos dos bots a ela, com a confirmação "Remover
   o Gmail (pessoal)? A Secretária e mais 1 bot perdem o acesso a esta conta." A primeira conta só sai depois das outras,
   ou pelo Desconectar de hoje.
6. **No bot**, cada conta é um app à parte: a lista de apps do bot mostra "Gmail" e "Gmail (pessoal)", cada um com o seu
   nível. As ferramentas chegam ao modelo com o slug da conta (`gmail--pessoal__GMAIL_SEND_EMAIL`), e a descrição do
   conector diz de que conta é ("Gmail (pessoal) · maria@gmail.com"), para o bot escolher a certa.
7. **Limite de 5 contas por app.** Na quinta, a linha "+ Adicionar outra conta" fica desligada com "Até 5 contas do
   Gmail".
8. **Login que não terminou.** Fechar a janela do Google sem entrar não guarda nada. Tentar de novo com o mesmo nome
   funciona, porque o nod apaga a conta pela metade antes (ADR-196 §6).

## No chat

| Ação (id) | O que faz | Risco | cartaoNoChat | Estado | Em que bot |
| --- | --- | --- | --- | --- | --- |
| `apps.conectar` | Conectar um app, agora com `conta` opcional (a conta a mais) | muda | sim | falta (NOD-394) | — |
| `apps.renomear_conta` | Trocar o nome exibido de uma conta | muda | não | vivo, `gerir_acessos` (`renomear_conta`) | todos, em todo modo em que o `gerir_acessos` entra |
| `apps.remover_conta` | Apagar uma conta a mais (Composio, conector e acessos) | arriscada | sim | vivo, `gerir_acessos` (`remover_conta`) | todos, em todo modo em que o `gerir_acessos` entra |
| `acessos.dar_em_lote` | (já existe) dar o nível de uma conta a um ou mais bots | muda / pessoa_confirma | sim | vivo | já é |

**`apps.conectar` fica `falta` (decisão a confirmar pela Ada):** o login é do Google, numa janela do navegador, e
não passa pela conversa. O caminho que já existe é o card "Conecte o X" do `pedir-acesso`. Esta spec só faz o card
levar o nome da conta: "Conecte o Gmail (pessoal)", com o mesmo botão que abre o login. Ligar o `apps.conectar` no chat
continua com a NOD-394.

**Como a pessoa pede:**
- "Conecta meu Gmail pessoal também, além do corporativo, e deixa a Secretária usar os dois."
- "Muda o nome da conta 'pessoal' do Gmail para 'Família'."
- "Tira a conta do Gmail de trabalho antigo, não uso mais."

**O cartão:** `cartaoNoChat` é declarativo. O cartão que aparece sai do risco × modo: `renomear_conta` (`muda`) segue o
modo do bot; `remover_conta` (`arriscada`) vira cartão no manual e no automático; `acessos.dar_em_lote` em "Ler e
alterar" é `pessoa_confirma`, sempre da pessoa.

**Risco:** renomear não muda o que o bot alcança, então é `muda`. Remover tira acesso de bots e não tem Desfazer, então
é `arriscada`. Dar acesso continua cerca 3 (ADR-082): depois de conteúdo de fora, vira cartão.

**Ambiguidade no `gerir_acessos`:** com duas contas, "Gmail" casa com mais de um conector. A ferramenta não escolhe:
devolve `ambiguo` com a lista ("Gmail · marlon@leapy.com.br", "Gmail (pessoal) · maria@gmail.com") e o bot pergunta.

- [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o
  cartão que o risco e o modo pedem.

## Critérios de aceite

- [ ] **Prova primeiro (gatilho da ADR-196):** com duas contas Gmail de verdade conectadas, o Gmail (pessoal) lista só
  a caixa da conta pessoal e o Gmail só a corporativa. Prova: um turno da Secretária com as duas, os dois
  `GMAIL_FETCH_EMAILS` e o remetente de cada um.
- [ ] Quem já tinha o Gmail conectado continua com o mesmo conector, o mesmo slug e os mesmos acessos depois da migração.
- [ ] "Adicionar outra conta" → login → a linha "Gmail (pessoal) · e-mail" aparece, e "Quem pode usar" abre nela.
- [ ] A Secretária com "Ler e alterar" nas duas manda um e-mail por cada conta, quando a pessoa pede "pelo pessoal" e
  "pelo corporativo".
- [ ] Um bot com acesso só ao Gmail (pessoal) não alcança o corporativo: a ferramenta `gmail__…` nem entra no plano.
- [ ] Fechar o login sem entrar e tentar de novo com o mesmo nome conecta, sem "nome em uso".
- [ ] Renomear muda o nome na vitrine, na lista do bot e no cartão; o slug e as regras permanentes ficam.
- [ ] Remover apaga a conta no Composio (DELETE 200 no log), o conector e os acessos, depois do cartão.
- [ ] A sexta conta não abre login, e a linha diz o limite.
- [ ] O `gerir_acessos` com "Gmail" e duas contas devolve `ambiguo`, não escolhe.
- [ ] O Linear do quadro (`importar-linear`) continua lendo a primeira conta.

## Fora desta spec

- Ligar o `apps.conectar` no chat (NOD-394).
- Mais de uma conta nos conectores que não são do Composio (GitHub nativo, MCP registrado à mão).
- Rotinas que escolhem a conta por gatilho ("e-mail novo em qualquer das contas"): cada rotina segue apontando para um
  conector.
- Trocar o nome técnico (slug) de uma conta.

## Ações

- `apps.renomear_conta`: registro em `src/domain/acoes/acessos.ts` · rota `PATCH /conectores/:id/nome` em
  `src/adapters/http/rotas/conectores.ts` · executor em `src/use-cases/acoes/acessos.ts` · ferramenta: `gerir_acessos`
  ganha `renomear_conta` (`src/contracts/ferramentas-acessos.ts`) · contrato em
  `tests/integration/paridade-acessos.test.ts` · piso +1.
- `apps.remover_conta`: registro em `src/domain/acoes/acessos.ts` · rota `DELETE /marketplace/:slug/contas/:conectorId`
  em `src/adapters/http/rotas/marketplace.ts` · executor em `src/use-cases/acoes/acessos.ts`, com o DELETE do Composio
  em `Deps.aposCommit` (efeito novo `remover_conta_composio` em `rodarAposCommit`) · ferramenta: `gerir_acessos` ganha
  `remover_conta` · cartão pelo modo (`arriscada`) · contrato em `tests/integration/paridade-acessos.test.ts` · piso +1.
- `apps.conectar`: a rota que já existe recebe `conta` no corpo; segue `falta` (NOD-394), sem piso.

## Plano curto

1. **Migração** `composio_sessoes`: colunas `conta` e `email`; o UNIQUE vira `(tenant_id, conector_id)` e
   `(tenant_id, owner_id, toolkit, coalesce(conta, ''))`. As linhas de hoje ficam com `conta` null.
2. **Repositório:** `sessaoDoConector(id)`, `sessoesDoApp(toolkit)` e `sessaoPrincipal(toolkit)` no lugar de
   `sessao(toolkit)`. Quem lia `sessao` (importar Linear, pedir e guardar credencial) passa à principal.
3. **Cliente Composio:** `autorizar` manda o `alias`; `conectado` devolve também o `state.val.displayName`;
   `toolkitAceito` recusa `__`.
4. **Rotas:** `conectar` aceita `conta`, apaga a conta pela metade de mesmo nome, cria o conector `<app>--<conta>`;
   `verificar` recebe o `conectorId`; rotas novas de renomear e remover.
5. **Web:** `AppDaVitrine` ganha `contas[]`; linhas por conta, "+ Adicionar outra conta", o campo do nome, Renomear e
   Remover.
6. **Plano do turno:** a descrição do conector leva o nome e o e-mail da conta.
7. **Prova** com duas contas de verdade antes de abrir para o time.

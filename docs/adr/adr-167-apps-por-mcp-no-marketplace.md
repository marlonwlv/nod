# ADR-167 — Qualquer app com servidor MCP entra pelo Marketplace

Status: proposta (2026-11-17), aguarda a validação do Marlon · Protótipos: [`docs/specs/apps-por-mcp.html`](../specs/apps-por-mcp.html) · Emenda a
[ADR-041](adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md) §5 e a
[ADR-057](adr-057-marketplace-com-o-catalogo-publico-do-composio.md) §7 · Relacionadas:
[ADR-049](adr-049-conectar-e-permitir-no-mesmo-lugar.md) (conectar e permitir), [ADR-026](adr-026-a-marca-de-nao-confiavel-e-propriedade-do-conteudo-carre.md)
(não confiável), [ADR-164](adr-164-pacote-compartilhavel-de-app-bot-e-time.md) (pacote), ADA-177 (o nod consumindo MCP
por URL com OAuth).

## Contexto

Hoje um app entra no nod por três caminhos:

1. **Composio**, que faz quase toda a grade. Entram os auth configs do painel e os 123 toolkits com login gerenciado
   (ADR-057). Os 189 que exigem OAuth próprio só entram se alguém configurar o painel do Composio.
2. **Nativo**, escrito no código. Hoje só o GitHub (ADR-048).
3. **MCP próprio.** A rota `registrarConector` aceita `stdio` (comando) ou `http` (URL), sonda o servidor e só
   então habilita. Isso existe desde a 0002, mas fica escondido: é o link "Conectar um servidor MCP próprio" no
   rodapé, que abre Configurações avançadas.

A pergunta que levou a esta ADR: **como deixar as pessoas trazerem um app que não está na grade?** O protocolo
para isso já está no nod, que é o MCP. Muitos produtos já publicam um servidor MCP remoto com login OAuth. Faltam
quatro coisas:

- **Descoberta.** O caminho mora em "Avançado" e pede transporte, comando e cabeçalhos: é um formulário técnico.
- **Login.** Por URL, a credencial é um cabeçalho colado à mão. O nod não fala o OAuth da especificação do MCP (não
  lê o `WWW-Authenticate` nem o metadata do recurso protegido do servidor de fora). É a ADA-177.
- **Time.** O conector é por pessoa (`UNIQUE (tenant_id, owner_id, slug)`). Quem acha um app bom não tem como
  oferecê-lo ao time como o Composio oferece o Slack.
- **Bot.** O modelo só pede acesso a app curado ou já conectado (ADR-057 §7). O app que o time adicionou e a pessoa
  ainda não conectou não existe para o bot.

Há ainda uma lacuna de segurança que um caminho aberto torna urgente: o conector `http` só confere o esquema. Uma
URL `https://` que resolva para rede interna (`10/8`, `169.254.169.254` etc.) é sondada pelo servidor. A lista
`REDES_NEGADAS` existe, mas só para o computador do bot (`computador-instalacao.ts`).

## Decisão proposta

1. **"Adicionar app" na grade do Marketplace.** É um cartão fixo no fim de "Seus apps" e um botão ao lado da busca.
   Ele também aparece quando a busca não acha nada ("Não achou? Adicione pela URL do MCP"). A gaveta pede **uma coisa
   só**: a URL do servidor MCP. Nome, descrição e ícone vêm do `initialize` (`serverInfo`) e a pessoa pode editar.
   Pela tela, só entra **remoto e `https`**. O `stdio` continua em Configurações avançadas, porque roda um programa
   no servidor.
2. **Sondar antes de pedir qualquer segredo.** O nod chama `initialize` e `tools/list` sem credencial:
   - se o servidor responde, mostra a prévia;
   - se responde 401 com `WWW-Authenticate` e o metadata do recurso protegido (RFC 9728), o botão vira "Entrar no
     {App}" e o login segue o fluxo OAuth do MCP (descoberta do servidor de autorização, registro dinâmico de
     cliente quando houver, PKCE). É a ADA-177;
   - se responde 401 sem OAuth, aparece o cartão de credencial que já existe (NOD-50), que guarda um cabeçalho
     `Authorization` ou `X-API-Key` no cofre.

   **A prévia** mostra o domínio em destaque e as ferramentas pelos grupos de `grupos-de-acesso.ts` (Ler, Criar,
   Alterar, Comentar, Apagar, Outras), com contagem. Ela mostra também se o app toca dado pessoal. Nada é concedido:
   termina no "Quem pode usar o {App}?" da ADR-049.
3. **A rede é checada a cada chamada.** O conector `http` passa a recusar o destino em rede privada, link-local ou
   metadata. A checagem vale no registro, na sonda e em cada chamada, com o IP **resolvido** (contra DNS rebinding) e
   em cada redirecionamento. A lista é a `REDES_NEGADAS` movida para o domínio. O modo local (o servidor é o Mac da
   pessoa) mantém `http://localhost`, como hoje. **Esta é a primeira entrega, antes de qualquer tela:** ela fecha uma
   lacuna que já existe.
4. **"Oferecer ao time" separa a definição do login.** Uma tabela nova `apps_do_time` (`visibility = 'equipe'`) guarda
   só a definição: nome, slug, URL, descrição, ícone, quem publicou e a data. Credencial, conta e concessão não entram
   nela. O conector continua por pessoa e passa a referenciar o app do time (`conectores.app_do_time_id`, nulo para o
   resto). Cada pessoa faz o próprio login, como no Composio (ADR-041 §4). Quem adiciona um app usa para si na hora.
   O cartão aparece na grade dos outros em "Do time" quando a pessoa marca "Oferecer ao time". Uma pessoa sem o login
   vê o cartão com "Conectar", como em qualquer app do Composio.
5. **O bot passa a enxergar os apps do time.** `pedir_acesso` aceita, além da curadoria, o slug de um app do time.
   Se a pessoa ainda não conectou, o pedido vira o card "Conecte o {App}" de sempre (ADR-049 §2). Isso emenda a
   ADR-041 §5 e a ADR-057 §7. O prompt lista os apps do time pelo **nome que o time deu**. A descrição que veio do
   servidor de fora vai com a marca de não confiável (ADR-026).
6. **A descrição das ferramentas é dado de fora.** Hoje a sonda guarda o catálogo. Se uma sonda posterior traz
   ferramenta nova, ela nasce sem concessão: o nível dado ("Ler e alterar") **não** se estende a ela sozinho. A pessoa
   vê "{App} ganhou 3 ações" e decide. Se mudar a descrição ou o schema de uma ferramenta já concedida, a concessão
   fica suspensa até a pessoa rever. Isso é a defesa contra o servidor que troca o que a ferramenta faz depois de
   aprovada. O "apagar" continua fora de qualquer nível (ADR-049).
7. **Quem pode oferecer ao time** é uma decisão em aberto (ver abaixo). Até ela ser tomada, a proposta é: todas as
   pessoas adicionam para si, e só o dono do tenant (`nod_dono`) oferece ao time ou tira do time. Tirar do time não
   derruba o login de quem já conectou: o cartão volta a ser só dessa pessoa.

## No chat

Os ids marcados como "existe" já estão no registro (`src/domain/acoes/acessos.ts`). Os outros são novos e vão para
`acessos.ts`.

| Ação (id) | O que faz | Risco | cartaoNoChat | Estado | Em que bot |
| --- | --- | --- | --- | --- | --- |
| `apps.criar` (existe) | Adiciona um app pela URL do MCP. Pela tela, só `https` | arriscada | sim | vivo (hoje `falta`, NOD-394) | todos |
| `apps.conectar` (existe) | Abre o login do app (OAuth do MCP ou do Composio) | muda | sim | vivo (hoje `falta`) | todos |
| `apps.credenciais` (existe) | Guarda o cabeçalho de acesso no cofre | pessoa_confirma | não | nunca (segredo) | — |
| `apps.oferecer_ao_time` | Põe a definição do app no catálogo do time | arriscada | sim | vivo | todos |
| `apps.tirar_do_time` | Tira o app do catálogo do time, sem derrubar logins | muda | não | vivo | todos |
| `apps.rever_acoes` | Aceita ou recusa as ações novas ou mudadas de um app | pessoa_confirma | sim | vivo | todos |

**Como a pessoa pede:**
- "Adiciona o app da Acme, o MCP dele é https://mcp.acme.example"
- "Deixa o Acme disponível para o time todo"
- "Tira o Acme da lista do time"

**Risco.** `apps.criar` e `apps.oferecer_ao_time` são `arriscada`. A URL e a descrição vêm de fora, e oferecer ao
time põe um app de terceiro no prompt de todos os bots. Por isso viram cartão também no modo automático. Uma URL que
o bot leu numa página ou num e-mail (cerca 3 da ADR-082) nunca vira `apps.criar` sem o cartão. `apps.rever_acoes` é
`pessoa_confirma`, porque é a defesa do item 6: um bot não aceita ação nova do app por conta própria.

- [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o
  cartão que o risco e o modo pedem.

## Fases

| Fase | O que entra | Tamanho |
|---|---|---|
| 1 | Checagem de rede no conector `http` (item 3) | PR pequeno, sem tela |
| 2 | "Adicionar app" na grade, com prévia e credencial por cabeçalho (itens 1 e 2 sem OAuth) | Tela + rota |
| 3 | OAuth do MCP (ADA-177) | Adaptador + cofre |
| 4 | "Oferecer ao time" e o bot enxergando os apps do time (itens 4, 5 e 7) | Migração + prompt |
| 5 | Ferramenta nova ou mudada exige rever (item 6) | Domínio + card |

A fase 5 pode vir antes da 4. Do jeito que está hoje, a ressonda já pode trazer ferramenta nova para um conector
próprio. A loja pública (pacote assinado, ADR-164 §Riscos) fica fora desta ADR.

## Perguntas para o Marlon

1. Quem oferece um app ao time: só o dono, qualquer pessoa ou qualquer pessoa com aprovação do dono?
2. O app do time deve ganhar um `nod-pacote.json` (tipo novo, `mcp`) para ser compartilhado fora do tenant, ou isso
   espera a loja?
3. A ordem das fases faz sentido? Em especial: pôr a fase 5 antes da 4?
4. O app adicionado pela URL fica marcado como "toca dado pessoal" por padrão, como hoje (ADR-002, `nao-declarou`)?

## Alternativas descartadas

- **Auth config do Composio como caminho do time.** Já funciona para os toolkits do Composio, mas não serve para
  app fora do catálogo deles e depende do painel e de uma chave do tenant (ADR-041). Continua valendo como atalho.
- **Conector nativo por PR para cada app pedido.** Dá controle total, mas não escala. Fica para apps centrais, como
  o GitHub.
- **Gerar o MCP a partir de um OpenAPI colado.** É mais um formato para manter e um proxy nosso entre o nod e a API.
  O MCP remoto já é o que os produtos publicam.
- **Deixar o "Adicionar" em Configurações avançadas e só mudar o texto.** Não resolve o time nem o bot, que são
  metade do pedido.
- **Aceitar `stdio` pela tela.** Roda um programa no servidor do time. Continua restrito a Configurações avançadas.

## O que isso custa

- Uma tabela nova (`apps_do_time`), uma coluna em `conectores` e a policy `equipe` de leitura, com a escrita pelo
  dono, nos moldes de `nod_equipe_update` (ADR-041 §2).
- Um cliente OAuth do MCP no servidor, com refresh de token no cofre e a rota de callback.
- O prompt cresce com a lista de apps do time. **Gatilho:** mais de ~30 apps do time leva o prompt a listar só os
  nomes e o `ver_apps` a dar o resto.
- Descrições de terceiros, em inglês, na grade, como na ADR-057 §5.

## Gatilho de reversão

- Um incidente em que a descrição ou a resposta de um app do time leve um bot a agir fora do que a pessoa pediu: o
  item 5 volta a "o bot só vê o que a pessoa conectou".
- O caminho do Composio passar a cobrir app por URL MCP com login gerenciado: o item 4 é revisto para não manter dois
  catálogos de time.

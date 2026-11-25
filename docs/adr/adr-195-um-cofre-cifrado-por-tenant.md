# ADR-195 — Um cofre só, cifrado por tenant, que os bots usam sem ver

Status: proposta (2026-11-24, pedido do dono) · Relacionadas: [ADR-015](adr-015-credenciais-dois-regimes-opostos.md)
(a chave do servidor), [ADR-041](adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md) (a chave do Composio é
do tenant), [ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md) (o selo do canal do computador), [ADR-168](adr-168-computador-do-bot-plug-and-play.md) (a chave da Orgo mora no cofre),
[ADR-177](adr-177-dinheiro-e-segredos-sem-o-bot-ver.md) (dinheiro e segredos sem o bot ver),
[ADR-190](adr-190-o-navegador-do-bot.md) (os logins do navegador do bot).

## Contexto

O Chico não conseguiu usar o computador da Orgo: a ADR-168 manda a `ORGO_API_KEY` morar no cofre (conector `orgo`), mas o
cartão de `pedir_credencial` só guarda chave de conector que já existe, e nada no produto cria o conector `orgo`. Para
testar, a chave foi posta no ambiente do `nod-motor` de uma máquina de testes (atalho fora do produto, a remover).

O problema é maior que a Orgo. Os segredos moram em quatro lugares (`conectores.env_cifrado`,
`composio_configuracoes.chave_cifrada`, o token do GitHub e `cofre_logins.senha_cifrada`), todos cifrados direto pela
MESMA chave do servidor (`NOD_CREDENTIAL_KEY`, `src/db/cifra.ts`, formato `v1:iv:tag:dados`, sem dados associados).
Consequências:

- **Trocar a chave do servidor é decifrar e recifrar todas as linhas de todas as tabelas de uma vez.** Um deploy com a
  variável errada deixa tudo ilegível na hora, para todos os tenants.
- Um vazamento da variável abre o cofre de todos os tenants.
- A lista "Chaves" das Configurações sai das propostas `credencial` confirmadas, não dos segredos: o que entrou por outro
  caminho não aparece, e não há quem usa, último uso nem revogar.

Referências estudadas (o app instalado, o código e a documentação):

| | Onde guarda | Chave | Como o bot usa sem ver |
|---|---|---|---|
| Grok Bot (app de referência) | servidor | não visível no app | segredo do bot vira variável de ambiente no computador do bot; login é preenchido no navegador |
| OpenBot, nightly-labs (o app instalado) | arquivo no aparelho | Chaves do sistema (`safeStorage`) ou chave em arquivo no Linux | a chave de API vira arquivo legível só pelo usuário; o agente lê o caminho e o valor é apagado das saídas |
| OpenBot, CopilotKit | Postgres com RLS por organização | uma chave de cifra no ambiente | o servidor chama a ferramenta em nome do bot |
| T3 Code | arquivo com permissão 0600, sem cifra | nenhuma | referência opaca de uso único (24 h) ou caminho de arquivo |

Nenhuma tem chave por tenant nem troca da chave mestra sem recifrar tudo. O nod tem um caso que as locais não cobrem: bots
que rodam em máquinas remotas (motor na nuvem, rotinas de madrugada) com o computador da pessoa desligado, e times que
compartilham.

## Decisão

### 1. Onde cada coisa mora

- **No servidor do nod:** chaves de apps (`chave`), logins de sites com 2 fatores (`login`) e contatos (`contato`). São o
  que os bots usam sozinhos e o que o time compartilha.
- **Só no computador da pessoa:** cartões (`cartao`). O servidor guarda bandeira, final e em qual aparelho está; nunca o
  número, a validade ou o código. Fica fora das regras de cartão (PCI) que valeriam se o número passasse a morar no nod.

### 2. Cifra em envelope, com a chave mestra no KMS desde o primeiro dia

Três níveis:

1. **Chave do item** (32 bytes aleatórios por versão do item). Cifra o valor com AES-256-GCM. Os dados associados (AAD)
   são `nod-cofre-v2|tenant|item|versão`: copiar a cifra para outro item, outro tenant ou outra versão falha na hora.
2. **Chave do tenant** (32 bytes aleatórios, uma viva por tenant). Embrulha as chaves dos itens (AES-256-GCM, AAD
   `nod-cofre-v2-item|tenant|item|versão`).
3. **Chave mestra** no Cloud KMS do Google (`projects/…/locations/southamerica-east1/keyRings/nod/cryptoKeys/cofre`).
   Embrulha só as chaves de tenant, com AAD `nod-cofre-v2-tenant|tenant|versão`. Nunca sai do KMS.

Formato gravado: `v2:<versão da chave do tenant>:<iv>:<tag>:<dados>` para o valor e o mesmo para a chave do item.

**Trocar a chave mestra** é criar uma versão nova no KMS (rotação automática anual) e reembrulhar as chaves de tenant,
uma por tenant. Os itens não são tocados. A versão antiga continua decifrando até o reembrulho terminar e ser conferido;
só então ela é desligada, e destruir exige o prazo de espera do KMS (configurado em 30 dias).

**Trocar a chave de um tenant** (suspeita de vazamento) é criar a versão nova e reembrulhar as chaves de item daquele
tenant; os valores também não são recifrados.

**O pior caso passa a ser a chave mestra destruída ou sem permissão**: tudo fica ilegível. Defesas: só uma conta de
emergência tem `cloudkms.cryptoKeyVersions.destroy`; a conta da VM só tem `encrypter/decrypter` nessa chave; alerta em
qualquer falha de decifrar; o prazo de 30 dias para destruir.

**KMS fora do ar**: a chave de tenant decifrada fica em memória por até 10 minutos (por tenant e versão). Fora disso, o
uso do cofre falha fechado ("o cofre não respondeu"), nunca cai para texto em claro.

**Fora da produção** (dev, testes, servidor no Mac): a chave mestra local é derivada da `NOD_CREDENTIAL_KEY` por HKDF
(`nod-cofre-v2-mestra-local`). O provedor é escolhido por `NOD_COFRE_KMS` (nome completo da chave); sem ele, local. Em
produção o boot recusa subir sem `NOD_COFRE_KMS`.

### 3. As tabelas

- `cofre_chaves_tenant`: a chave de cada tenant embrulhada pela mestra, com versão e a versão da mestra usada. Visível ao
  tenant (`equipe`); só o reembrulho muda a linha.
- `cofre_itens`: tipo, nome (`ORGO_API_KEY`, o site, "Visa •••• 4242"), app, dados públicos (usuário, final, aparelho),
  dono pessoa ou time, cifra do valor e da chave do item (nulas no cartão), versão, `revogado_em`, `ultimo_uso_em`.
  Uma versão viva por (dono, tipo, nome).
- `cofre_concessoes`: qual bot usa qual item, `sempre` ou `perguntar`. Cartão é sempre `perguntar`.
- `cofre_eventos`: guardado, trocado, pedido, aprovado, negado, entregue, revogado, reembrulhado. Nunca o valor.

Os quatro lugares de hoje migram para `cofre_itens` num PR à parte. Enquanto isso, `v1` continua legível pelo mesmo
`decifrar`.

### 4. Entrega no turno

O bot nunca recebe o valor. Ele vê o nome (`ORGO_API_KEY`) e os dados públicos.

1. O motor pede o item pelo nome para o turno.
2. O servidor confere a concessão. Em `perguntar`, abre o cartão "Permitir uma vez / Sempre / Negar" no chat.
3. O servidor decifra e **sela para a chave pública do motor** (X25519 + HKDF + AES-256-GCM, o mesmo selo do canal do
   computador, `src/adapters/computador/selo.ts`), com o id do turno e validade de 5 minutos.
4. O motor guarda o valor só na memória do turno, põe no ambiente do comando que precisa e apaga das saídas das
   ferramentas (o redator de segredos que já existe), inclusive em base64 e em URL.

### 5. O cartão quando a pessoa tem várias máquinas

- O cartão fica em **um aparelho da pessoa**: um Mac ou PC dela com o app do nod e biometria (Touch ID ou Windows
  Hello), escolhido ao cadastrar. Nunca numa máquina do bot ou de motor (VM, computador do bot, máquina compartilhada):
  lá não há a pessoa para aprovar e outros bots têm terminal.
- Quem tem mais de um computador pode guardar no 1Password ou no Bitwarden: aí qualquer aparelho dela com o app do nod
  aberto atende.
- **Não importa onde o bot roda.** O pedido de pagamento vai ao aparelho do cartão; a pessoa aprova com a biometria; o
  app lê o cartão e o sela para a máquina onde está o navegador que vai pagar, só para aquela página e aquele turno. O
  servidor só repassa o envelope, que não consegue abrir. Se o navegador roda no próprio aparelho, nada trafega.
- Aparelho desligado: o bot não paga e avisa ("Abra o nod no MacBook Pro da Rafa").
- Cartão virtual por compra (ADR-177) continua o caminho preferido quando existir o provedor.

### 6. Telas e chat

Desenho no Paper: "nod · Workspace e contas", página "Cofre · chaves e logins" (C1–C7) e "nod · Chat e conversa", página
"Orgo · chave pelo cartão" (O1–O5). O `pedir_credencial` ganha o alvo `app`, que cria o item `chave` no cofre para um app
conhecido (começando pela Orgo), testa a chave antes de guardar e concede ao bot que pediu.

## Entrega

1. **Este PR:** a ADR, a migração 0185 (as quatro tabelas), `src/db/cifra-envelope.ts` (os três níveis, a AAD, o cache),
   os provedores da chave mestra (`kms` pela API REST com o token da conta da VM, sem biblioteca nova; `local` por HKDF),
   o repositório e os testes (unidade e integração sob `withRollback`, troca da mestra sem tocar os itens, AAD trocada
   falha, KMS fora usa o cache e depois falha fechado).
2. A entrega selada ao motor e o redator; a Orgo passa a ler do cofre e o atalho da máquina de testes sai.
3. As telas do Cofre e o alvo `app` do `pedir_credencial`.
4. A migração dos quatro lugares de hoje para `cofre_itens`.
5. O cartão no app do Mac e do PC.

## Gatilhos de reversão

- Latência do KMS pesar no turno (mais de 300 ms no p95 do primeiro uso por tenant): aumentar o cache, não voltar à
  chave única.
- Se o PCI alcançar o envelope do cartão em trânsito, o cartão passa a ser só cartão virtual por compra.

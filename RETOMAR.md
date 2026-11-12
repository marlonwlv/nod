# RETOMAR — frente "Comportamento igual ao Grok" (para o Dante)

> **Atualizado pelo Dante (12/11/2026, nod-motor-teste):** os 12 comportamentos estão no placar
> (`docs/grokbot/COMPORTAMENTO.md`): 11 com e2e no Chrome em `tests/concurrency/igual-ao-grok-chrome.test.ts` (11/11) e o
> 12 (provedor do computador) por configuração, provado no unit. Suítes no Linux e o que ficou de fora estão no placar.
> Servidor de teste deste branch: `~/nod/Dante/comportamento-igual-ao-grok-d9d397/srv-run/` (link em `link.txt`,
> atualizar com `./atualizar.sh`). O texto abaixo é o da transferência, mantido como histórico.

Branch **`frente/comportamento-grok`** (gamefik/nod), a partir de `origin/integracao/grokbot` @ 557bf30a. O SHA final
está no último commit deste branch (o que traz este arquivo). Não abra PR, não faça merge e não empurre no
`integracao/grokbot` nem no marlonwlv/nod: o gamefik/nod está congelado (NOD-485). Corrija comportamento, não visual
(duas frentes mexem no CSS em paralelo): nos e2e use seletores por papel, `data-act` ou texto.

Pedido original: para cada comportamento decidido (DECISOES.md), um e2e no app de verdade (servidor + web + banco) que
prove que o nod faz igual ao Grok; anotar "igual", "diferente (o que difere)" ou "não testável aqui (motivo)" em
`docs/grokbot/COMPORTAMENTO.md` e corrigir o código até virar "igual". Referência do Grok: `docs/grokbot/` (DECISOES,
TELAS, AGENTE e os prints 37–39 de aprovação e 70–72 de onboarding). O app do Grok não está na sua máquina: use os docs.

## Feito

- **Postgres e migrações:** as 168 do branch aplicam limpas, com a 0165.
- **0166 nova** (`src/db/migrations/0166_vm_do_nod_sala_memoria_de_time_passkey.sql`): a persistência que os PRs #732 e
  #735 deixaram só no domínio — `vms_do_nod` (uma viva por pessoa), `vez_na_sala` (uma vez por sala por índice parcial),
  `memorias_time` + `itens_memoria_time` (fila revisada por gente, fusão do "sonho" sem apagar), `passkeys` +
  `desafios_gasto` (desafio de uso único, contador). Repos em `src/repositories/grok-persistencia.repo.ts` (registrados
  em `criarRepos`; no repo em memória dos testes, um Proxy que lança). Teste: `tests/integration/grok-persistencia.test.ts`
  (4/4). Ainda **sem rota nem caso de uso** ligando os repos ao app: é o próximo passo dessa parte, se o Marlon quiser.
- **integration:** consertados ajustes-aprovacao (escopo depois do savepoint), plano-turno e rotina-gate
  (`mostrar_cartoes` no catálogo), turnos-fila (frase da falha tipada da ADR-169). Sobra deploy-azul-verde: `flock` falta
  no macOS — deve passar no Linux.
- **conformidade:** 24/24 verde, antes e depois da 0166.
- **concurrency:** consertados os repos novos (fragmento SQL preguiçoso), fuzz-acoes (semeia regra do revisor de cada pessoa
  e a pessoa do fuzz é admin por `NOD_ADMINS`; `quadro.remover_label`, da main, isento com a NOD-409), e2e-catcher (falha
  tipada). Vistas como ambiente do Mac: quadro-jornada-e2e (falha igual na main 40dc4211), 8 `*-chrome` com `ENOTEMPTY`
  no `rmSync` do perfil, quadro-chrome esperando "Alt" onde o Chrome do Mac mostra "⌥".
- **Revisor falso no e2e:** `servidorCompleto({ revisor: { url } })` agora chega ao `boot` e ao `compor` (antes o boot não
  repassava). Use com `tests/helpers/api-anthropic-falsa.ts` e `env: { NOD_REVISOR: "ligado", NOD_REVISOR_CHAVE:
  "sk-ant-teste-0123456789abcdefghij" }`.
- **Não rodado:** `npm run typecheck` (o `tsc` do servidor estourou o heap de 2 GB no Mac de 8 GB). Rode antes de tudo.

## Falta

1. `npm run typecheck` e `npm run lint` uma vez.
2. A suíte inteira de concurrency no Linux (confirmar que deploy-azul-verde, quadro-jornada-e2e e os `*-chrome` passam lá).
3. Os 12 e2e. Sugestão: um arquivo `tests/concurrency/igual-ao-grok-chrome.test.ts` no padrão de
   `tests/concurrency/conversa-ada2-f5-chrome.test.ts` (servidorCompleto + catcher + `dist/web` + Chrome por CDP via
   `scripts/carga-tela/cdp.ts`). Precisa de `npx vite build` antes.
4. Placar em `docs/grokbot/COMPORTAMENTO.md` e os consertos até "igual".

## Mapa para os 12 e2e (levantado lendo o código)

Cartão comum na conversa: o `exemplo.enviar_email` vira **rascunho** (item 11), não o "Permitir uma vez". Para o item 1,
crie um MCP de teste com uma escrita que não seja envio (copie `scripts/mcp-exemplo.mjs`, ex.: `arquivar_tarefa`).
Setup do conector: `tests/concurrency/e2e-catcher.test.ts` (~l.292): `POST conectores` (stdio, `process.execPath`,
`args:[mcp]`, `declaracao:"nao-toca"`), `POST conectores/:id/sondar`, `POST agentes/:id/concessoes {conectorId,capacidade}`,
`POST agentes/:id/modo-aprovacao {modo}`. O catcher dispara ferramentas por `[[tool: nome {json}]] [[texto: …]]` na fala.

1. **Cartão:** `web/telas/sua-vez.ts` (`renderCardAprovacao`, `botaoSempre`), Esc em `web/main.ts` (~l.650, nega o
   `li.decisao` em foco, não num campo de texto), linha `web/telas/cartao-encolhido.ts`. Seletores:
   `li.decisao.aprov-card[data-decisao]`, `[data-act="decidir-aprovacao"]` ("Permitir uma vez"),
   `[data-act="decidir-aprovacao-sempre"]` ("Sempre permitir <ação>"), `[data-act="decidir-aprovacao-nenhum"]`
   (aria-label "Negar"), `.cartao-encolhido[data-cartao-encolhido] .ce-resultado`. Provável diferença: a linha diz
   "Recusado por você" (o Grok: negado; print 39).
2. **Regras (só Automático):** `web/telas/cartao-revisor.ts`, `web/telas/linha-do-modo.ts` (`linhaDaRegra`),
   `src/use-cases/revisar-acao.ts`. Bot em `automatico`, revisor falso respondendo
   `{"decisao":"pede","motivo":"…","regra":"","sugestao":"…"}` para o cartão e, com uma regra P criada antes
   (`POST aprovacoes/regras {agenteId,lista:"permitir",texto}`), `{"decisao":"libera","motivo":"…","regra":"P1","sugestao":""}`
   para a linha. Seletores: `li.decisao.cartao-revisor`, `input[data-cr-regra-marca]`, `input[data-cr-regra-texto]`,
   `[data-act="decidir-aprovacao-com-regra"]` ("Permitir e salvar regra"), `.linha-modo.linha-regra`,
   `[data-act="apv-editar-da-linha"]`. Provar também que no manual não aparece.
3. **Lote:** `web/telas/pedidos-iguais.ts`; dois pedidos do mesmo bot, mesmo conector e ferramenta. Seletores:
   `li.aprov-iguais[data-iguais]`, `[data-act="iguais-permitir"]` ("Permitir os N"), `iguais-negar`, `iguais-ver`.
   Provável diferença: na conversa cada pedido sai sozinho (`web/telas/conversa.ts` ~l.1767); o lote só na Sua vez.
4. **Níveis, só leitura, teto:** `POST aprovacoes/niveis {agenteId|null,conector,tipo,nivel}`,
   `POST agentes/:id/so-leitura {soLeitura:true}`, `POST aprovacoes/teto {teto}` (admin = `NOD_ADMINS` com o pessoaId:
   passe `pessoaId` fixo ao servidorCompleto). Barrado = resposta recusada sem `li.decisao` (ver `GET dev/catcher`).
   Tela: `web/telas/config-aprovacoes.ts` (`apv-modo`, `apv-so-leitura`, `apv-teto`, `apv-nivel`, `.apv-aviso`).
5. **Aguardando você:** `web/lib/aguardando.ts`, barra em `web/main.ts` (~l.2301), clique `verPerguntaNaConversa`
   (~l.5171). Gatilho simples: `[[tool: pedir_a_pessoa {"tipo":"pergunta","texto":"Posso arquivar o PR 7?"}]]`.
   Seletores: `#sidebar [data-bot-contexto][data-aguardando]`, `.sub-aguardando`, `button[data-act="abrir-conversa"][data-pendente]`,
   alvo `[data-decisao|data-pergunta="<id>"].realce`; cor `var(--aguardando)`.
6. **⌘K e atalhos:** `web/lib/paleta*.ts`, `web/lib/atalhos.ts`. No Chrome do Linux o modificador é **Alt** (⌃ no Mac;
   ⌘ só no app do Mac): CDP `Input.dispatchKeyEvent` com `modifiers` (Alt=1, Ctrl=2, Meta=4, Shift=8). Seletores:
   `.paleta[role=dialog]`, `#paleta-termo`, `.paleta-grupo[aria-label="Bots|Conversas|Ajustes|Ações"] .paleta-item`;
   ⌘B → `document.documentElement.dataset.largura === "recolhida"`; ⌘I foca `#composer-texto`; ⌘⇧N abre Nova sala.
7. **Ajustes com busca e link:** `web/lib/ajustes.ts`, `#busca-ajustes`, `.cfg-achado[data-act="ir-ao-ajuste"]`,
   `.cfg-busca-vazia`, `${url}/#ajuste=tema` → `#ajuste-tema.realce`, `[data-act="copiar-link-ajuste"]`.
8. **Criar bot:** `web/telas/criar-bot.ts`; `.create-trigger[data-tela="novo-bot"]` → `[data-act="criar-rapido"]`;
   `dialog.criar-bot`, `.cb-formas [role=radio][data-forma]`, `.cb-cores [role=radio][data-cor]`, `[data-cb="criar"]`;
   preparo `.cb-barra[role=progressbar][aria-valuenow]`, `.cb-porcento`, `[data-fim="pronto|erro"]`.
9. **Personagem:** `web/lib/mascote.ts`; `nod-mascote[data-estado]`. trabalhando com `[[espera: 5000]]`; aguardando com
   pedido aberto; comemorando só no preparo a 100%.
10. **Onboarding:** `web/telas/apresentacao.ts` e `onboarding-controle.ts`. **Não** chame `POST onboarding/concluir`.
    `.ap-pontos[aria-label="Passo N de 10"]`, `[data-act="apres-seguir|apres-pular|apres-voltar"]`,
    `textarea[data-campo-apres="primeira"]`, `[data-act="apres-criar"]`. Conectar apps: pular (sem contas).
11. **Rascunhos:** `web/telas/rascunhos-de-envio.ts`; `pedir_aprovacao` com 3 itens de `exemplo.enviar_email`
    (o do e2e-catcher). `.re-barra[role=region]`, `[data-act="rascunhos-enviar-todos"]`, `rascunhos-descartar-todos`,
    `textarea.re-corpo`.
12. **Provedor do computador:** só servidor (`src/domain/provedor-computador.ts`, `src/adapters/computador/provedores/`);
    env `NOD_COMPUTADORES=docker`, `NOD_COMPUTADOR_PROVEDOR=orgo`, `…_POR_PESSOA`/`…_POR_BOT` (JSON),
    `NOD_COMPUTADOR_ORGO=1` + `NOD_ORGO_URL` falso; não passe `computador` ao servidorCompleto. Sem tela na web; o
    `sobrepor` da ADR-168 (flag) não é usado. Provável "diferente" ou "não testável na tela".

Não testável sem as contas do Marlon: conectar apps no onboarding (OAuth real), login Cursor/Google, VM do Nod com o
driver `gcp`, Orgo real, passkey real (Touch ID).

## Comandos que usei (Mac; no Linux troque o brew pelo Postgres 16 do sistema ou o `docker compose up -d`)

```bash
# worktree (no Mac era ~/nod/Copiador/nod-base como clone; node_modules por link, sem npm ci)
git -C <clone> fetch origin integracao/grokbot:refs/remotes/origin/integracao/grokbot
git -C <clone> worktree add <pasta>/nod -b frente/comportamento-grok origin/integracao/grokbot
ln -s <clone>/node_modules <pasta>/nod/node_modules

# Postgres 16 leve, só localhost, na porta do repo (5434)
brew install postgresql@16
cat >> /opt/homebrew/var/postgresql@16/postgresql.conf <<'EOF'
listen_addresses = 'localhost'
port = 5434
shared_buffers = 64MB
work_mem = 4MB
maintenance_work_mem = 32MB
max_connections = 60
EOF
brew services start postgresql@16
psql -h 127.0.0.1 -p 5434 -d postgres -c "create role postgres superuser login password 'postgres'"
psql -h 127.0.0.1 -p 5434 -d postgres -f infra/postgres/init/01_roles.sql   # nod_dono, nod_app, nod_poda, bancos nod e nod_test
cp .env.example .env                                                        # já aponta para 127.0.0.1:5434

# migrar e checar
npm run db:migrate
npm run fence:migrations

# suítes (uma por vez; o banco de teste por worktree é criado e migrado sozinho)
npx vitest run --project integration --maxWorkers=3 --reporter=dot
npx vitest run --project conformidade --maxWorkers=2
npx vitest run --project concurrency --reporter=dot
npx vitest run --project integration tests/integration/grok-persistencia.test.ts

# para os e2e
npx vite build            # gera dist/web; o servidorCompleto serve com env NOD_STATIC_DIR=dist/web
brew services stop postgresql@16
```

## Próximo passo

`npm run typecheck`, depois `npx vite build` e o arquivo `tests/concurrency/igual-ao-grok-chrome.test.ts` começando pelos
itens 1, 5 e 11 (os que já têm gatilho pronto no catcher), anotando cada um em `docs/grokbot/COMPORTAMENTO.md`.

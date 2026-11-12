# nod igual ao Grok Bot: placar de comportamento

Branch `frente/comportamento-grok` (gamefik/nod), a partir de `integracao/grokbot` @ 557bf30a. Transferido ao Dante
em 12/11/2026 (ver `RETOMAR.md` na raiz do branch). Referências do Grok copiadas em `docs/grokbot/` (DECISOES, TELAS,
AGENTE e os prints de aprovação 37–39 e de onboarding 70–72).

Banco: Postgres 16 do brew no Mac do Pablo (porta 5434, só localhost, shared_buffers 64MB). As 168 migrações do branch,
com a 0165, aplicam limpas; a 0166 (nova, desta frente) também.

## Suítes com banco

### No Linux (Dante, nod-motor-teste, 12/11/2026, depois dos consertos desta frente)

| Suíte | Resultado | Observação |
|---|---|---|
| typecheck · lint · vite build | verdes | o `tsc` com 6 GB de heap (no Mac de 8 GB estourava) |
| unit | 933/936 arquivos, 13369/13372 testes depois do conserto do `configuracoes.test.ts` (o ⌘K chama `abrirPaleta()`) | **2 falhas que já existem no commit base b2bc30fd (integracao/grokbot), não desta frente:** `desktop/ponte-web-smoke` (a ponte ganhou atalhoQuickChat, capturarTela, desmontarDaMesa, ferramentasMac… e `ponte-web-esperada.json` não foi regravado) e `desktop/atualizacao` (o regex de `parar()` no desktop/main.ts). São do lado do desktop (Quick Chat/mesa), da frente que fez isso. |
| integration | 320/321 arquivos, 2686/2687; o que falhou (`web-sem-app`, `dev/catcher` com registros) era sobra de duas rodadas minhas do e2e cuja limpeza falhou; limpo o banco de teste, passa sozinho | **deploy-azul-verde passa no Linux** (era o `flock` do macOS). `grok-persistencia` 4/4. |
| conformidade | 24/24 arquivos, 113/113 | — |
| concurrency | 137/138 arquivos, 732/734 (1 pulado) | inclui o `igual-ao-grok-chrome` (11/11) e o `revisor-ponte`. **Única falha:** `conversa-ada2-f5-chrome` › 390 (toque longo não abre o menu da fala no Chrome headless do Linux) — falha igual com a web do commit base, antes de qualquer mudança desta frente. quadro-jornada-e2e, os `*-chrome` (ENOTEMPTY) e o quadro-chrome ("Alt") **passam no Linux**. |

### No Mac do Pablo (Copiador, 1ª rodada)

| Suíte | Resultado | O que quebrou e o conserto |
|---|---|---|
| integration | 1ª rodada: 315/320 arquivos, 2669/2683 testes. Depois dos consertos, só falha o deploy-azul-verde | ajustes-aprovacao (ADR-164): o teste não voltava o escopo ao Marlon depois do savepoint da Ana → corrigido no teste. plano-turno e rotina-gate: `mostrar_cartoes` (ADR-173) entrou no catálogo de propósito → listas esperadas atualizadas. turnos-fila: a falha tipada da ADR-169 diz "sem crédito ou com fatura em aberto" no lugar da frase genérica → esperado atualizado. deploy-azul-verde (5): **ambiente** — o macOS não tem `flock`; não é código desta noite (deve passar no Linux). |
| integration (nova) | `tests/integration/grok-persistencia.test.ts` 4/4 | 0166: VM do Nod, vez na sala, memória de time e passkey do gasto, com RLS. |
| conformidade | 24/24 arquivos, 113/113 testes (antes e depois da 0166) | nada a consertar |
| concurrency | 1ª rodada: 118/137 arquivos, 690/723 testes, 7 falhas + 8 arquivos de Chrome | repos novos montavam SQL na criação ("conn is not a function" em webhook-corrida e scheduler-dois-processos) → preguiçosos, passam. fuzz-acoes: as ações novas `aprovacoes.editar_regra/apagar_regra/teto` não passavam da busca → o fuzz semeia uma regra de cada pessoa e a pessoa do fuzz é admin, passam; `quadro.remover_label` (da main, #723) isento com a NOD-409. e2e-catcher: falha tipada (ADR-169) → esperado atualizado, passa. quadro-jornada-e2e: **falha igual na main** (40dc4211) neste Mac → ambiente/carga, não desta noite. 8 testes `*-chrome`: `ENOTEMPTY` no `rmSync` do perfil do Chrome no afterAll (corrida de limpeza no macOS) → ambiente. quadro-chrome (2): espera "Alt", o Chrome no Mac mostra "⌥" → teste feito para o Linux do CI. **A reconferir no Linux:** a suíte inteira de concurrency uma vez. |

## Comportamentos (e2e no app de verdade)

Rodado pelo Dante na nod-motor-teste (Linux, Postgres 16 na 5443, Chromium 1248 headless) em 12/11/2026. Um teste por
comportamento em `tests/concurrency/igual-ao-grok-chrome.test.ts`: servidor completo com banco (`servidorCompleto`), executor
catcher, revisor do Automático numa API falsa (`api-anthropic-falsa.ts`), MCPs de teste (`tests/fixtures/mcp-somar.mjs`,
`scripts/mcp-exemplo.mjs`), a web montada (`npx vite build`) e o Chrome por CDP. **11 de 11 verdes.** Seletores por papel,
`data-act` ou texto (o CSS muda em paralelo e não é o que se prova).

| # | Comportamento | Placar | O que prova (e o que foi consertado) |
|---|---|---|---|
| 1 | Cartão: Permitir uma vez · Sempre permitir · Negar (Esc) → linha de status | **igual** | e2e `1.`: os três verbos; Esc com o foco no cartão nega; Permitir faz e encolhe em "Aprovado por você · feito HH:MM"; Sempre permitir encolhe em "Permitido daqui em diante" e o próximo igual roda sem cartão. **Consertado:** o cartão comum negado dizia "Recusado por você" (o botão é "Negar"; print 39) → "Negado por você"; a regra dizia "Regra nova" (Grok: "Allowed from now on") → "Permitido daqui em diante" (`web/telas/cartao-encolhido.ts`). |
| 2 | Regras em texto só no Automático: "Salvar como regra" e "Aprovado pela sua regra · Editar" | **igual** | e2e `2.`: com o revisor pedindo, o cartão traz "Salvar como regra" marcado com a sugestão editável e "Permitir e salvar regra"; a regra é gravada (`origem: sugestao`); a próxima, liberada pela P1, mostra "Aprovado pela sua regra · <regra> · Editar", e o Editar abre a regra em edição nos Ajustes; no Manual o cartão não tem regra. |
| 3 | Aprovação em lote | **igual** | e2e `3.`: três pedidos iguais (mesmo bot, app e ferramenta) viram UM cartão na conversa ("Permitir os 3"); desmarcar um conta 2 e só os 2 saem; Esc nega o lote. **Consertado:** na conversa cada pedido era desenhado sozinho e o lote só existia em Sua vez → `ancoradosComIguais` (`web/telas/sua-vez.ts`, usado em `web/telas/conversa.ts`). |
| 4 | 4 níveis por ferramenta, só leitura e teto do admin | **igual** | e2e `4.`: Sempre permitir roda no Manual sem cartão; Bloqueado não roda nem pedindo; Sempre pedir põe cartão até no Total; só leitura deixa a leitura e barra a escrita sem cartão; o teto "manual" do admin faz o bot que pediu Total rodar em Manual (`modoEfetivo`) e a tela avisa "Seu admin limitou…"; o seletor de cada app tem os 4 níveis. |
| 5 | "Aguardando você: {motivo}" em laranja na linha do bot, abrindo no cartão | **igual** | e2e `5.`: a linha diz "Aguardando você: Posso arquivar o PR 7?" na cor `--aguardando`, com o ponto; o clique abre a conversa com o pedido realçado e à vista. |
| 6 | ⌘K de tudo e os atalhos | **igual** | e2e `6.` (Chrome do Linux: Ctrl+K e Alt): a paleta acha bots, conversas (salas), ajustes e ações; o ajuste leva à linha; ⌘B recolhe e volta; ⌘I foca o campo; ⌘L cita a seleção no campo; ⌘, abre as Configurações; ⌘⇧N abre Nova sala. **Consertado:** "Conversas" só tinha os trabalhos e eles só hidratavam ao abrir a faixa → a paleta pede os trabalhos ao abrir, relê a cada busca e lista as salas (conversas em grupo) (`web/lib/paleta.ts`, `paleta-na-tela.ts`, `web/main.ts`). |
| 7 | Busca e link por ajuste nas Configurações | **igual** | e2e `7.`: a busca acha por palavra ("escuro" → Tema, com "Geral › Aparência"), mostra o vazio, e acha "Só leitura"; `#ajuste=tema` abre na linha realçada com o "copiar link"; idem para as linhas de Aprovações. **Consertado:** Aprovações era uma seção inteira sem linha com link → `aprovacoes-modo`, `so-leitura`, `teto-do-time`, `regras-revisor` e `nivel-por-app` no catálogo, com âncora e "copiar link"; o link limpa a busca aberta e o realce resiste ao redesenho da seção que carrega depois. Provedores, Máquinas, Agentes, Rotinas, Conta e Feedback continuam com link de seção (são telas de lista, não linhas de ajuste). |
| 8 | Criar bot com cor e forma e preparo em % | **igual** | e2e `8.`: "Criar novo bot" com 13 formas e 14 cores, Criar desligado sem nome, a prévia veste a escolha, a barra sobe com % até 100, o personagem comemora e a conversa do bot novo abre; o bot nasce com a forma e a cor escolhidas. |
| 9 | Estados do personagem | **igual** | e2e `9.`: disponível → trabalhando (na barra e na pílula) → disponível → aguardando você com pedido aberto → disponível ao decidir; comemorando no preparo a 100% (itens 8 e 10). **Consertado:** a mensagem não lida deixava o personagem "aguardando você" (Grok: o não lido é só o ponto azul) → `mascoteComAviso` ignora o não lido (`web/lib/mascote.ts`). Sem sinal de "computador dormindo" no servidor, o `pausado` (sleeping) não tem gatilho na conversa; o fora do ar é `offline`. |
| 10 | Onboarding do Grok inteiro em 10 passos | **igual** (com 1 ressalva) | e2e `10.`: boas-vindas → conhecer → computador → trabalho → delegar → função (pensa, e comemora ao escolher) → origem → apps (pular) → criar (forma, cor sem o preto, primeira mensagem) → preparando com % até 100; Voltar funciona; o bot nasce com a forma e a cor e responde à primeira mensagem. **Ressalva:** função e origem ficam só no navegador (o Grok grava como atributo da pessoa, `SetUserAttribute`); levar ao servidor é dado de marketing da pessoa → decisão do Marlon antes. |
| 11 | Rascunhos com "Enviar todos" | **igual** | e2e `11.`: três e-mails viram três rascunhos editáveis com a barra "Descartar todos · Enviar todos"; o corpo editado sai editado; os três saem pelo conector. |
| 12 | Provedor do computador Docker × Orgo por configuração (ADR-166) | **igual por configuração; sem e2e de tela** | Não há tela nem no Grok nem no nod (decisão: configuração). Provado em `tests/unit/adapters/computador-provedores.test.ts` (21/21): bot > pessoa > global > padrão, valor desconhecido ignorado, Orgo pela documentação com fetch falso (cria, liga, saúde, ações), seletor desligando no provedor antigo. **Não testável aqui de ponta a ponta:** esta máquina não tem Docker e não há conta Orgo; o `sobrepor` da ADR-168 segue sem uso. |

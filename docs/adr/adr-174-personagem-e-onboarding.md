# ADR-174 — O personagem no nod: estados, formas, onboarding em 10 passos e preparo com %

Status: proposta · Data: 2026-11-12 · Emenda a [ADR-077](adr-077-onboarding-por-ligacao.md) (o "olá" vira a apresentação;
a ligação fica como opção), a [ADR-157](adr-157-onboarding-por-texto-e-conta-sem-senha.md) (a jornada A também abre pela
apresentação) e a [ADR-070](adr-070-design-system-grafite-e-cor-do-agente.md) (duas cores de bot a mais). Usa os tokens da
[ADR-167](adr-167-visual-e-design-system.md). Telas 09, 09b e 13 do Paper; decisões do Marlon de
12/11/2026 ("personagem animado" e "onboarding inteiro").

## Contexto

A referência conduz a primeira abertura com um personagem animado (um corpo com forma e olhos, ~50 estados, 25 formas) e
cria cada bot num cartão com nome, forma e cor, seguido de "Setting up your Bot… {0}%". O nod já tinha o motor Bloub
(`web/vendor/bloub`, docs/mascotes.md) com 15 estados e 8 formas, mas só quatro estados ligados a fatos, a abertura era um
"olá" de 3,3 s seguido da ligação, e "Criar novo bot" criava um bot em branco sem perguntar nada. Copiamos comportamento e
visual; nenhum código de terceiros.

## Decisão

1. **Quatro estados novos no motor** (`states.ts`, geometria nossa, declarada como as outras): `reading` (o olhar varre a
   linha e volta), `celebrate` (dois pulos com amassa-e-estica, olhos felizes, confete da cor do bot), `sleeping` (olhos
   fechados, respiração lenta) e `offline` (desbotado, olhos fechados, pose fixa como o repouso). Todos usam a forma
   escolhida. Os estados do nod (`web/lib/mascote.ts`) passam a ser: disponível, pensando, **lendo**, trabalhando,
   aguardando, **comemorando**, pausado (agora desenhado como **dormindo**), **offline** e na fila. As transições são as do
   motor (morph de silhueta e piscada de entrada).
2. **De onde vem cada estado.** `lendo`: o turno rodando com uma ferramenta cujo rótulo começa por Lendo/Buscando/
   Procurando/Pesquisando/Abrindo/Consultando (o mesmo `emUso` da fala viva). `offline`: `computadorForaDoAr` do bot, só
   para o dono e sem turno vivo (o mesmo sinal da barra); ganha do repouso e da fila, perde para trabalhando, pensando e
   aguardando, e o aviso de não lido não o cobre. `comemorando`: só disparo das telas (preparo a 100%, escolha no
   onboarding), nunca inferido do chat — a celebração por entrega precisa de deduplicação e fica para depois. Como a
   barra, a pílula e o cabeçalho leem `estadoMascoteNaConversa`, os três ganham os estados sem mudança neles.
3. **Treze formas** (as 8 de antes + ovo, coração, estrela, flor, trevo, construídas com os mesmos perfis radiais) e
   **catorze cores** (as 12 + magenta `#ff309b` e anil `#5865f2`). O balão de cada cor nova sai de
   `coresDoBalao` (contraste ≥ 4,5:1 nos dois temas). O seletor do perfil passa a mostrar todas.
4. **"Criar novo bot" é um modal** (tela 09): prévia viva do personagem, nome, Forma (13), Cor (14), Cancelar/Criar; o
   nome digitado na busca da Nova conversa vem preenchido. Ao criar, **o mesmo cartão vira o preparo** (tela 09b): o
   personagem trabalhando com a órbita, "Preparando a Lia", a barra com % e quatro passos reais — Bot criado
   (`criarAgente`), Cor e forma ou Apps conectados (`editarPerfil` e o acesso de leitura aos apps), Acordando o
   computador (a frota diz se o computador responde) e Lendo as instruções (a primeira mensagem, quando há). A
   porcentagem nunca mente para cima: o passo em andamento anda até 90% da fatia dele e só fecha com a resposta. No erro,
   o cartão "Se der erro" com Tentar de novo (retoma do passo que parou; o bot não nasce duas vezes) e Ver o que houve. A
   100% o personagem comemora e a conversa abre. **⌘N continua abrindo a Nova conversa**, como o "New chat" da referência;
   o modal está a um Enter dali. Segurar o + continua criando direto (NOD-383).
5. **Onboarding em 10 passos** (tela 13, `web/telas/apresentacao.ts`): boas-vindas, conhecer, tem o próprio computador,
   dar um trabalho, delegar, função, como conheceu, conectar apps, criar o bot e preparando — o personagem conduz cada um
   (pensa, trabalha, lê, comemora a escolha). Avança com Continuar ou ← →; função, origem e apps dá para pular. A função
   sugere o nome e o primeiro trabalho do bot; o passo 9 é o nome, forma, cor (sem o preto) e a primeira
   mensagem; o passo 10 é o mesmo preparo do modal, que no "Acordando o computador" também espera uma IA pronta (o teste
   das IAs da ADR-077 continua rodando por baixo desde a abertura). No fim, o onboarding conclui sem o "Tudo montado" e a
   conversa do bot novo abre com a primeira mensagem já enviada.
6. **A ligação continua como opção**: "Prefiro conversar por voz" na boas-vindas (fora da jornada A) segue o caminho de
   antes (a IA dos bots, a ligação, a entrevista e os cards). "Ver o que houve" no erro do preparo leva a esse caminho, que
   mostra a IA dos bots — o que mais falta num bot que não acorda.

## Consequências

- Função e origem ficam neste computador (`nod.onboarding.respostas`); levá-las ao servidor (os campos `objetivo` e
  `como_conheceu` já existem em `CamposEntrevista`) pede uma rota fora da flag de texto e fica para o próximo PR.
- O preparo dentro do modal (e não numa tela inteira, como no Paper) evita mexer na navegação e na barra lateral, que são
  de outra frente. Gatilho de revisão: a barra mostrar "Preparando… 64%" na linha do bot (tela 09b) — aí o preparo vira
  estado da frota e a tela inteira.
- O Bloub segue isolado em `web/vendor/bloub`: os estados e formas novos estão marcados "nod (ADR-174)" no código.
- Reverter: tirar `criarBot` das dependências do onboarding devolve o "olá" de 3,3 s; `criar-rapido` volta a chamar
  `criarBotAgora`.

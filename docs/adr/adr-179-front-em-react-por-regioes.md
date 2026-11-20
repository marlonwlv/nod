# ADR-179: o front migra para React 19, região por região

Status: proposta (2026-11-12, frente "React fase 1 infra"; decisões do Marlon, não reabrir sem um gatilho abaixo).

## Contexto

A web é desenhada por string: `web/main.ts` (~10 mil linhas) reduz o estado (`web/estado/reducer.ts`) e regrava as
regiões do `index.html` (`#sidebar`, `#cabecalho`, `#timeline`, `#composer`, `#detalhes`, `#quadro`, `#espaco`…), com
eventos por delegação em `data-act`. Funciona e é rápido (ADR-061), mas cada tela nova repete à mão o que um framework
de componentes dá pronto: foco, teclado, popover, diálogo, lista que não perde seleção ao redesenhar. O custo de
manter o desenho por string cresce com cada tela; o de trocar tudo de uma vez é inaceitável (o produto está em uso).

## Decisão

1. **React 19** (`react`, `react-dom`), JSX no runtime automático: pelo esbuild do Vite na web e pelo esbuild do
   desktop (`scripts/desktop/build.mjs`). Sem `@vitejs/plugin-react` por enquanto (o dev recarrega a página).
2. **Primitivos headless do Base UI** (`@base-ui/react`) para o que tem comportamento difícil (diálogo, popover, menu,
   select, tabs, tooltip, collapsible). O visual é nosso.
3. **CSS próprio por componente** sobre os tokens que já existem (`web/tokens.css`, `web/ds.css`, só `var(--…)`):
   cada componente importa o seu `.css`, com prefixo próprio (`rx-`). **Sem Tailwind e sem shadcn**: o design system
   já está nos tokens (ADR-167) e duas fontes de verdade para cor e medida voltariam o problema que o
   `cores-por-token.test.ts` fechou.
4. **Uma região por vez, inteira.** Cada região do `index.html` ganha o seu `createRoot` (`web/react/regioes.tsx`:
   `montarRegiao`/`desmontarRegiao`, marca `data-react-regiao`). Nunca meia tela: a região vai inteira, e o PR que a
   migra tira o desenho por string dela no mesmo diff. Componente React não usa `data-act` (o evento é prop).
5. **A loja entra sem reescrever o reducer.** `web/react/loja.ts` lê o mesmo `estado` do `main.ts` e avisa no
   `render()`; `useLoja(loja, seletor, igual?)` (`web/react/use-loja.ts`) entrega ao `useSyncExternalStore`. O
   componente só redesenha quando o pedaço selecionado muda — um frame do SSE de outra conversa não o toca.
6. **Fica como está**: o reducer, `api.ts`, `live-events.ts`, o SSE, `texto-formatado.ts` e a lógica pura de `web/lib`.
   Os componentes chamam essas funções; não há "versão React" delas.
7. **Bibliotecas extras só na fase que pedir**: react-query, dnd-kit e motion não entram agora. Quais são e as regras de cada uma: [ADR-180](adr-180-bibliotecas-da-migracao-react-e-grade-do-quadro.md).
8. **Testes de componente** no projeto `componentes` do vitest (happy-dom + Testing Library, `tests/unit/**/*.test.tsx`),
   rodado junto pelo `npm run test:unit`. `tests/unit/web/react-regras.test.ts` trava: `.tsx` sem `data-act`, CSS de
   componente sem cor literal e sem `@tailwind`/`@apply`, e o componente de exemplo fora do app.

## Fases

| Fase | O quê | Portão para seguir |
|---|---|---|
| 0 | Bugs e régua antes de mexer: corrigir o que a medida de tela apontar e gravar a linha de base do `scripts/carga-tela` | linha de base gravada |
| 1 | Infra (este ADR): React, Base UI, regiões, loja, testes, peso do bundle; nenhuma região migrada | suíte verde, bundle medido |
| 2 | Primeira região pequena e de pouco tráfego (ex.: `#cabecalho`), para provar o caminho de ponta a ponta | régua sem piora |
| 3 | Barra lateral (`#sidebar`): a lista que mais redesenha fora da conversa (ADR-061, "barra linha a linha") | régua sem piora |
| 4 | Detalhes do bot e Configurações (`#detalhes`, `#espaco`): diálogos e formulários com Base UI | régua sem piora |
| 5 | Quadro (`#quadro`): arrastar (dnd-kit entra aqui, se a fase pedir) | régua sem piora |
| 6 | Conversa (`#timeline`, `#composer`): a região mais quente (streaming, frentes); depois dela sai o desenho por string | régua sem piora |

As fases 3 (barra lateral) e 6 (conversa) foram feitas em 2026-11-19 pela [ADR-189](adr-189-barra-e-conversa-no-react-e-has-sem-sujeito-universal.md), que também achou e corrigiu o que de fato travava a tela (CSS com `:has()` de sujeito universal).

A fase 5 (quadro) começou em 2026-11-19 medindo: abrir o quadro e arrastar com 160 tarefas, servidor × tela
(`scripts/carga-tela`, cenário `quadro`, que agora mede a abertura, arrasta por ponteiro — a grade dnd-kit não ouve o
arrasto nativo — e mede soltar → card na coluna nova e o PATCH). O primeiro passo não é React: é a emenda da
[ADR-189](adr-189-barra-e-conversa-no-react-e-has-sem-sujeito-universal.md) (a conversa por baixo do quadro saía do
estilo a cada troca). A grade em React de hoje (ADR-180) mediu **mais lenta** que a por string (o root redesenha a grade
inteira a cada desenho, com um Menu do Base UI por card); ela continua atrás de `?quadro-react=1` até ser refeita nos
passos seguintes da fase: a página do quadro inteira num root que fica, os cards em JSX a partir da tarefa com um só
"Mover para…", as jornadas de Chrome arrastando por ponteiro e o teste de mão antes de ligar por padrão.

**As telas no lugar da conversa** (2026-11-19). Sua vez, Não lidos, Tarefas de todos, Trabalhos, Rotinas, Conectores,
Novo bot e o quadro compartilhado ocupam a região `#timeline` no lugar da conversa e eram regravadas por `innerHTML`. A
régua ganhou um cenário por tela (`tela-sua-vez`, `tela-nao-lidos`, `tela-trabalhos`, `tela-tarefas`: a tela aberta pela
barra com 8 bots escrevendo, no banco do `povoar.ts`) e mostrou todas já abaixo do portão na `main` (maior tarefa 0 ms,
TBT 0, tecla p95 ≤ 22 ms): aqui a migração é pelo código, não pela performance, e o portão é não piorar. O mecanismo:
com uma tela migrada aberta, o main escreve na região só a vaga dela (`vagaDaTela`, `web/react/telas/telas.tsx`) e a tela
monta ali um root próprio, que lê a loja (`useLoja`, só os pedaços que usa) e recebe as ações por prop; trocar de tela
desmonta o root antes de a região ser regravada. Chave `?telas-react=0` (`react-na-regiao.ts`), ligada por padrão; com
ela desligada (ou com o módulo a caminho), o desenho por string de sempre. A primeira é **Não lidos**
(`web/react/telas/nao-lidos.tsx`), com o mesmo DOM da tela por string (o teste compara os dois): o teclado e o deslize do
celular seguem nas mesmas classes. Na régua, Não lidos com 8 bots: 0 / 0 / 6,3 ms (maior tarefa / TBT / tecla p95) em
React e 0 / 0 / 6,9 por string no mesmo build; 106 nós criados contra 147. A segunda é **Rotinas** (`web/react/telas/rotinas.tsx`): a estrutura
e os botões da rotina em componentes (pausar, ativar, testar, execuções, conversa, nova rotina, ver a pergunta), com as
ações extraídas no main em funções que a tela por string também chama; os pedaços que `web/lib/execucao.ts` monta para
várias telas (a parada, a espera, onde roda) entram pelo conversor da ADR-189, com a ação deles na delegação, até
`execucao.ts` virar componente. A terceira é a **nova conversa** (Novo bot, `web/react/telas/novo-bot.tsx`): o campo
"Para:" fica sem controle do React e o filtro das linhas e as setas seguem com o main sobre o DOM (`filtrarBots`), refeito
depois de cada desenho (`aoDesenhar`). O 1º desenho de cada tela é síncrono (`flushSync`), para o foco que o main põe
no fim do render achar os nós. A quarta é **Tarefas de todos** (`web/react/telas/tarefas-de-todos.tsx`): o controlador
(`web/lib/tarefas-de-todos-na-tela.ts`) segue lendo os quadros e relendo no `quadro.mudou` e passa a avisar quem assina
(`dados`/`assinar`); a tela guarda a vista, a busca e os filtros. A vaga leva a classe do casco que o CSS lê
(`tdt-casco`), mas não o `id="tdt"`: o controlador só desenha nele por string. Na régua, 0 / 0 / 6,2 ms em React e
0 / 0 / 7,7 por string. A quinta é a tela **Tarefas** (`trabalhos`, ADR-187 §8; `web/react/telas/tarefas.tsx`), Por bot
e Por estado: as regras (o grupo de cada bot, o título, as contas, o tempo, o passo) são as funções puras de
`web/telas/tela-tarefas.ts`, exportadas e usadas pelas duas; o componente só troca a marcação. As esperas de colega
(Cobrar, Desistir) e a pílula da cota entram pelo conversor. Também **Nova rotina** e o **novo chat em grupo** (Nova sala), os dois formulários:
sem `data-form`, o envio é prop e chama o mesmo tratamento do main (`FORMS`) com o próprio formulário; os campos ficam
sem controle do React. **Sua vez** (`web/react/telas/sua-vez.tsx`): a casca é componente (o título com a conta, o vazio, os
fora do ar, os vencidos recolhidos e o "Limpar vencidos" por prop); os cartões de decisão são os mesmos da conversa
(`renderItem`) e entram pelo conversor, com a chave `data-decisao` e as ações deles na delegação, até os cartões virarem
componentes — um passo que vale para a conversa e para Sua vez de uma vez.

**O campo de mensagem** (fase 6, por pedaços; 2026-11-19). O campo é desenhado uma vez por conversa e o resto é
imperativo (`atualizarComposer`, os anexos, o ditado, o menu da IA, a folha do "+"), dividido com a pílula do Quadro
(`composer-ligado.ts`): não é regravado a cada frame, então a migração dele é pelo código, em pedaços, cada um com a
volta `?composer-react=0`. O 1º pedaço é **a fila de anexos** (`web/react/composer/fila-de-anexos.tsx`), a do campo do chat
e a da pílula: a cada passo do upload o desenho por string regravava a fila inteira (a miniatura nascia de novo); em
React só a barra do item que andou muda, e o "remover" é prop. Os itens seguem no main (`anexosPendentes`). O 2º é **o topo
do campo** (`web/react/composer/topo-do-campo.tsx`): a caixa "Respondendo" de uma pergunta (Trocar, ×) e a de uma fala
citada (×), a partir de `topoDoComposer` (o dado; `renderTopoComposer` é o mesmo por string). Os próximos pedaços, nesta
ordem: o seletor de IA e a folha do "+", o
ditado, e por fim o próprio campo (o `<textarea>` sem controle do React, com as menções e os comandos `/`), com as
jornadas de Chrome de digitação, foco e acento em composição.

**Os diálogos criados por código** (item 4; 2026-11-19), com o Dialog do Base UI (ADR-180), cada um com a volta
`?dialogos-react=0`. O 1º é **o diálogo de handoff** do Quadro (`web/react/dialogos/handoff.tsx`): o mesmo conteúdo e as
mesmas classes do `<dialog>` nativo, a mesma resposta (a promessa: não mover, ou mover parando ou não o anterior), o foco
em "Mover" ao abrir, preso no diálogo e de volta a quem estava ao fechar. A escolha vale na hora do fechar; o root sai
quando a saída termina, fechado pelo próprio Base UI (`actionsRef.close`); se o fim não for avisado em 1 s, o Base UI desmonta (`unmount`) — arrancar o root no meio do fechamento deixava o foco preso para o diálogo seguinte. O `quadro-na-tela`
recebe quem abre o diálogo (`dialogoDeHandoff`); sem isso, o nativo. O 2º é **a confirmação** (`bot-dialogo`,
`web/react/dialogos/confirmar.tsx`: título, texto, "Cancelar" com o foco e a ação), começando pelo "Rodar mais uma
execução?" do Testar agora e o aviso dos termos da troca de conta (corpo próprio, "Cancelar" como o principal). O 3º é o
"Conectar este Mac?" (ADR-069), com a ação assíncrona no próprio diálogo (o botão desligado no pedido, o erro e a volta). E
**a paleta ⌘K** (ADR-167, `web/react/dialogos/paleta.tsx`): o mesmo DOM e o mesmo comportamento (combobox com
`aria-activedescendant`, ↑ ↓, Enter, Esc, o fundo, o Tab de volta ao campo, o foco de volta ao fechar), com o termo e a
seleção como estado e as regras de `web/lib/paleta.ts`; o main passa a usá-la quando o módulo dos diálogos chega. Os dois fecham pelo Base UI (`Dialog.Close`, `actionsRef.close`) com um fade curto de saída
(sem movimento, some na hora). Achado da jornada de Chrome: numa aba headless sem foco emulado, o relógio das animações
não anda só com o teclado — a saída nunca terminava e a página parecia inerte; com `Emulation.setFocusEmulationEnabled`
(como na régua) ela anda como numa janela à vista. E **a prévia de arquivo** (NOD-327,
`web/react/dialogos/previa-arquivo.tsx`): a mesma casca, o mesmo carregamento (a rota de anexos, os limites de tamanho e
de 15 s) e os mesmos módulos de formato (`previa-csv`, `previa-pdf`), que desenham por conta própria no nó que o
componente lhes entrega; o erro e a contagem são estado, fechar cancela o carregamento e o foco volta ao card (ou ao card
novo do mesmo anexo na mesma casa, se a conversa redesenhou). Um controlador de cancelamento por execução do efeito: o
StrictMode roda o efeito duas vezes, e o 2º não pode herdar o sinal já abortado. E **a tela cheia da mídia** (NOD-323,
`web/react/dialogos/luz.tsx`): o DOM de `htmlDaLuz` (as classes e os `data-luz`), as setas que somem nas pontas passando
o foco para a outra, ← →, o deslize, as miniaturas, o duplo clique no tamanho real, o clique fora da mídia que fecha, o
vídeo com a barra mínima e as velocidades, e o Finder no Mac do arquivo; o item da vez, o tamanho real e o tempo do vídeo
são estado. O popup é um `<div>` no portal (sem o top layer do `<dialog>`): `.luz.rx-luz` divide as regras de
`dialog.luz` e fica por cima do app pelo `z-index`. E **a tela cheia do artefato** (`web/react/dialogos/artefato.tsx`): o
mesmo cabeçalho e o mesmo iframe vivo, que `artefatos-vivos` segue montando (a ponte, o estado, as gravações) no corpo que
o componente lhe dá (`telaCheiaPorFora`), pela ref com limpeza do React 19 — o portal põe o conteúdo depois do 1º
efeito. A jornada de Chrome prova que o foco preso do Base UI deixa clicar e digitar dentro do iframe sandbox; o Esc
dentro dele é do artefato, como no `<dialog>` nativo. E **o menu do bot** na lista (`web/react/dialogos/menu-do-bot.tsx`), pelo Menu do Base UI: as
mesmas linhas (`linhasDoMenu`, que o HTML nativo também lê), ao lado da linha ou no cursor, deslizando para caber (sem
virar de lado); o foco abre no 1º item, e a ação roda depois de o menu sair e de o foco voltar à linha — o foco é
devolvido pelo componente, não pelo Base UI, cuja volta chegaria depois e tiraria o foco do que a ação abriu (Renomear).
No celular, a folha curta e o bot segurado (NOD-379/382) seguem no `<dialog>`. O que ele faz de
comum virou `MenuAncorado` (`web/react/dialogos/menu-ancorado.tsx`), que também serve **os menus da barra** (a aba de
tarefa, os bots e as outras abas, a nova tarefa, os times; `abrirMenuDaBarra`): `web/react/dialogos/menu-de-html.tsx` lê o
MESMO HTML do `<dialog>` nativo — o papel e o rótulo do `<div role="menu">` vão ao popup, o `<div>` fica com a classe que o
CSS lê, cada botão vira item com os mesmos atributos e miolo, e a escolha recebe o botão. Uma diferença de propósito: o
item desligado fica focável (e inerte), como a APG pede para menus; no nativo as setas o pulavam. Pelo mesmo caminho
vão **o menu da pílula** (embaixo e centrado nela; as páginas seguem `menuitemradio`) e **o menu da fala** (reagir e ⋯; os
emojis seguem `menuitemcheckbox`, o "+" troca a linha sem fechar e põe o foco no 1º emoji, ← → andam como ↓ ↑, e o
"Desfazer" com `aria-disabled` não escolhe). O bot segurado e a fala segurada do celular seguem no `<dialog>`. E o **Compartilhar** da gaveta (`htmlMenuCompartilhar`). As folhas do celular (a do "+" do campo, a do Compartilhar do perfil) ficam no `<dialog>`: a do "+" precisa fechar antes de o seletor de arquivo abrir, o que o modal nativo já dá. E **o menu do modo de aprovação** (ADR-059, `web/react/dialogos/menu-modo.tsx`): o mesmo
HTML e a mesma regra pura (`reagirMenuModo`), acima do botão com o foco no modo atual; a confirmação do total entra
logo depois do item, com o foco em "Agora não", e o Esc com ela aberta fecha só ela (o fechamento do Base UI é cancelado
pelo `reason` `escape-key`). E **o seletor de IA do campo** (`web/react/dialogos/menu-ia.tsx`): o botão fica onde está
(filho do `.box`), só o menu muda — acima dele, alinhado à direita, com o foco na escolha atual; o main o fecha por código
quando o campo troca de conversa.

**As sobreposições do Base UI contam como modal para o main** (achado da migração dos menus). Os atalhos globais
(`SELETOR_MODAL`), a camada sobre a busca, o Esc do quick chat, o Esc que fecha Seu espaço e os Esc das telas por baixo
liam `dialog[open]`/`dialog:modal` ou `closest("dialog")` — e um diálogo ou menu do Base UI não é `<dialog>` (o popup
vai para um portal no `body`). Cada host marca `data-rx-modal` enquanto existe; `SELETOR_SOBREPOSICAO` ("há algo por
cima") e `SELETOR_DENTRO_DA_SOBREPOSICAO` ("o alvo está dentro de uma"), em `web/lib/atalhos.ts`, servem todos esses
pontos. A tela cheia da ligação (`role="dialog"`) fica de fora de propósito: o Esc dela segue encolhendo. A trava do toque
duplo da folha "+" vale no popup do Base UI, e o zoom (+/−) da prévia de PDF passou a ler o popup também.

A ordem das fases 2–6 é a proposta desta ADR (da menos para a mais quente); trocar a ordem não muda as regras acima.

**A régua de fps e tarefa longa é o portão de cada fase.** Antes e depois de cada região, `node scripts/carga-tela/rodar.ts
medir <rotulo>` no build de produção (ADR-061). A fase não entra se, no cenário de 8 bots, aparecer tarefa longa acima
de 250 ms, a tecla no campo passar de 200 ms no p95, ou os quadros (rAF) ficarem piores que a linha de base da fase 0.

## Peso no celular

O celular baixa o mesmo `index-*.js` do computador (o Caddy serve com zstd/gzip). Medido em 2026-11-12 no build de
produção (`vite build`, gzip -9 e brotli do Node), JS inicial:

| Build | gzip | brotli | diferença (gzip) |
|---|---|---|---|
| Antes (grokbot/transicao, a66bc91) | 664,6 KB | 519,8 KB | — |
| Fase 1 (nenhuma região montada) | 664,7 KB | 520,2 KB | +0,07 KB |
| Com a 1ª região montada (regiões + useLoja) | 737,3 KB | 581,1 KB | +72,7 KB |
| Idem + um primitivo do Base UI (Collapsible) | 744,3 KB | 587,2 KB | +79,7 KB |

Na fase 1 o React não entra no bundle (nenhum código do app monta região; o Rollup o deixa de fora). O custo de
~73 KB gzip (61 KB brotli) aparece na fase 2, com a 1ª região; cada primitivo do Base UI soma alguns KB.

## Alternativas descartadas

- **Reescrever tudo de uma vez**: meses sem entregar, e a régua da ADR-061 só valeria no fim.
- **Preact/Solid/Svelte**: mais leves, mas o Base UI e o ecossistema de componentes acessíveis são do React.
- **shadcn + Tailwind**: traz um segundo design system por cima dos tokens.
- **Reescrever o reducer como store React (Redux, Zustand)**: o reducer é testado e é o contrato com o SSE; o
  `useSyncExternalStore` lê o que já existe.

## Gatilho de reversão

- Se a régua mostrar piora numa fase e não houver correção dentro dela, a região volta ao desenho por string
  (`desmontarRegiao`) e a fase é revista.
- Se o JS inicial do celular passar de +120 KB gzip sobre a linha de base da fase 0 (React, Base UI e os componentes
  migrados, sem o que sair do desenho por string), avaliar `preact/compat` ou dividir o bundle por região antes da
  fase seguinte.

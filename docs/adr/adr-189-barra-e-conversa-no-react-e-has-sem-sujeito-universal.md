# ADR-189 — A barra, a conversa, o cabeçalho, o painel e Seu espaço no React, e `:has()` sem sujeito universal

Status: proposta (2026-11-19, frente "React: as partes mais importantes, pela performance do chat") · Executa as fases 3
(barra lateral), 4 (painel do bot e Seu espaço) e 6 (conversa e cabeçalho) da [ADR-179](adr-179-front-em-react-por-regioes.md) · Emenda a
[ADR-061](adr-061-a-tela-aguenta-varios-bots-escrevendo.md) (a régua e o que mais pesava) e a
[ADR-114](adr-114-chat-limpo.md) (o morph da fala viva, emenda da NOD-348, que passa a ser a reconciliação do React).

## Contexto

O pedido foi levar ao React as partes mais importantes do nod para melhorar a performance, principalmente a do chat. A
fase 0 da ADR-179 manda medir antes de mexer. A régua (`scripts/carga-tela`, build de produção, 12 bots, conversa de 300
mensagens, máquina quieta), rodada na `main` em 2026-11-19, mostrou a tela pior do que a ADR-061 deixou:

| Cenário | Maior tarefa | TBT | Tecla p50/p95 |
|---|---|---|---|
| ocioso (8 s) | 196 ms | 146 ms | 14 / 26 ms |
| 8 bots escrevendo fora da tela | 246 ms | 1.596 ms | 14 / 127 ms |
| turno pesado na conversa aberta | **320 ms** | 1.494 ms | 10 / 146 ms |
| os dois juntos | **449 ms** | 3.349 ms | 12 / **266 ms** |
| 5 frentes narrando na conversa | **574 ms** | 5.808 ms | 11 / **442 ms** |

Três cenários passam do portão da ADR-061 (tarefa > 250 ms, tecla p95 > 200 ms): a pessoa sentia o campo da conversa
travar enquanto os bots trabalhavam.

O perfil de CPU (com `CARGA_SEM_MINIFICAR=1`) apontou a barra lateral: `redesenharSidebar` regravava a barra inteira a
cada frame de outro bot, e as medidas logo depois (`marcarBordasDaLista`, a pílula do topo, o topo encolhido) pagavam o
layout forçado. Mas a barra em React sozinha **não** melhorou a régua (vários bots: TBT 1.596 → 1.458 ms, tecla p95
127 → 199 ms). O número que explicou foi o do Chrome: 1.168 recálculos de estilo num turno pesado que tinha só 7 frames
de SSE — um por quadro de animação. Com `prefers-reduced-motion` (os mascotes parados) o tempo de thread principal caiu
de 9,0 para 3,1 s.

O trace do Chrome com rastreio de invalidação (`CARGA_TRACE_S`, resumido por `scripts/carga-tela/trace.ts`) achou a
causa: o recálculo típico visitava 9 elementos (o SVG do mascote), mas alguns visitavam **42.305** — a página inteira —,
cada um com ~180 ms. Quem os disparava era `:has()`: regras cujo sujeito casa com qualquer elemento
(`html:has(.borda-barra.arrastando) :is(.app, .app *)`, `… > :not(.qd-anuncio)`, `… > .cabecalho-pilula > *`,
`:is(:focus-visible, :has(:focus-visible))`), com `::placeholder` (a shadow do navegador) ou só com tag (`… svg`,
`… span`). O Chrome junta as regras de `:has()` num conjunto de invalidação só; com um sujeito universal nele, cada nó que
entra no DOM perto de uma âncora (o mascote repintando o SVG, o bloco da fala) invalida a subárvore inteira da âncora —
e o `html` e o `main.stage` são âncoras.

## Decisão

1. **`:has()` nunca termina num sujeito largo.** Quando há um `:has()` antes do sujeito, o sujeito nomeia o que estiliza
   com classe, id ou atributo: não `*`, não `:not(…)` sozinho, não `:is()` com ramo universal, não só uma tag, e não um
   pseudo-elemento da shadow do navegador (`::placeholder`, `::-webkit-*`). Estado da página inteira vira classe no
   `<html>` posta pelo JS (`html.borda-arrastando`). `:has()` só no próprio sujeito (`label:has(input:checked)`) é livre:
   a invalidação fica nele. Travado por `tests/unit/web/css-has-sem-sujeito-universal.test.ts`, que varre todo o CSS da
   web. As 16 regras que o teste achou foram reescritas no mesmo PR, cada uma com o mesmo efeito na tela.
2. **A barra lateral (`#sidebar`) é desenhada pelo React**, a partir do mesmo HTML de `renderSidebar`
   (`web/react/html/`). O conversor lê o HTML num `<template>` e devolve elementos com chave estável (`data-bot-contexto`,
   `id`, `data-chave`…); o pedaço com chave cujo HTML não mudou devolve o MESMO elemento React (o React o pula sem
   comparar), o pedaço sem nada vivo por dentro vai num miolo por string, e o `<nod-mascote>` é sempre o mesmo nó (só os
   atributos mudam: o motor do mascote não repinta). O DOM é o mesmo do `innerHTML`; CSS, `data-act`, arrasto e testes de
   DOM seguem. É um desvio consciente da ADR-179 (item 4: "componente React não usa data-act"), como o da grade do quadro
   na ADR-180: o HTML continua da tela, e o React decide o que tocar.
3. **A conversa (`#timeline-historico`, `#timeline-ao-vivo`) é desenhada pelo React, bloco a bloco**, no lugar do
   `regiaoPorBlocos` (`montarBlocosNoReact`). O bloco de HTML igual ao anterior nem é lido; o que mudou é reconciliado no
   lugar. As marcas do morph da ADR-114 (`data-morfar`, `data-no-lugar`, `data-parte`) dão nó próprio à vaga do rótulo e
   ao mascote da fala viva: a troca de etapa refaz só o rótulo, como o morph fazia. As vagas que outras partes enchem por
   fora (progresso das frentes, iframe do artefato, diagrama) chegam vazias do HTML, e o React não as desfaz.
4. **O cabeçalho (`#cabecalho`), o painel do bot (`#detalhes`) e Seu espaço (`#espaco`) vão pelo mesmo conversor**,
   entregues pelo registro de `web/lib/regioes.ts` (`entregarRegiao`/`devolverRegiao`): `regiao()`, `regiaoMudaria()` e
   `esquecerRegiao()` delegam à região entregue, então quem escreve nelas (`gaveta-render`, `regiaoReabrindo`, o
   `renderPrincipal`) não mudou. A troca guarda a rolagem e o foco do desenho que sai. O cabeçalho volta ao desenho por
   string enquanto a busca na conversa está aberta: ela leva a pílula do bot para dentro do campo
   (`encaixarNoCabecalho`), e o React não aceita que um nó dele seja levado para fora.
5. **Cada região tem chave de volta, ligada por padrão**: `?barra-react=0`, `?conversa-react=0`, `?cabecalho-react=0`,
   `?detalhes-react=0` e `?espaco-react=0` desligam neste navegador (`web/lib/react-na-regiao.ts`), e a região volta ao
   desenho por string. O módulo React chega por `import()` logo depois do boot; até lá, e sem ele, tudo segue por string.
6. **A grade do quadro continua atrás de `?quadro-react=1`** (ADR-180): ligá-la por padrão pede o teste de mão e os três
   testes de Chrome que arrastam pelo evento nativo passando a arrastar por ponteiro, condição que esta frente não muda.
7. **A régua ganhou três ferramentas**: `CARGA_SEM_MINIFICAR=1` (perfil com o nome das funções), `CARGA_TRACE_S=N`
   (trace com invalidação de estilo) e `CARGA_SEM_REACT=barra,conversa` (o mesmo build com as regiões por string).

## Resultado

Medido em 2026-11-19, mesma máquina e mesmo banco restaurado, uma variante depois da outra (maior tarefa / TBT / tecla
p95, em ms):

| Cenário | `main` | só o CSS (regiões por string) | CSS + barra React | CSS + barra + conversa React |
|---|---|---|---|---|
| ocioso | 196 / 146 / 26 | 0 / 0 / 10 | 0 / 0 / 11 | 0 / 0 / 11 |
| 8 bots fora da tela | 246 / 1.596 / 127 | 58 / 8 / 28 | 0 / 0 / 12 | 0 / 0 / 12 |
| turno pesado | 320 / 1.494 / 146 | 90 / 109 / 37 | 71 / 42 / 12 | 54 / 6 / 13 |
| os dois juntos | 449 / 3.349 / 266 | 72 / 42 / 31 | 133 / 124 / 13 | 62 / 19 / 15 |
| 5 frentes | 574 / 5.808 / 442 | 113 / 328 / 117 | 76 / 60 / 33 | 76 / 67 / 37 |

Com as duas regiões no React, nenhum cenário passa de 76 ms de tarefa nem de 37 ms de tecla no p95 (o portão é 250 e
200). Nas frentes, a tecla mais lenta levou 745 ms com os quadros nunca acima de 100 ms e o laço de eventos no máximo em
114 ms: a espera foi fora do thread principal da página (o mesmo pico aparece na `main`, 767 ms, e só com o CSS, 902 ms).

**As cinco regiões no React** (barra, conversa, cabeçalho, painel e Seu espaço), num banco preparado de novo e com a
máquina quieta (carga de 1 min abaixo de 4 no início de cada variante), uma variante depois da outra no mesmo build — a
fase 4 só entra se não piorar a régua (ADR-179):

| Cenário | barra + conversa | as cinco regiões |
|---|---|---|
| ocioso | 0 / 0 / 14 | 0 / 0 / 11 |
| 8 bots fora da tela | 0 / 0 / 15 | 0 / 0 / 7 |
| turno pesado | 51 / 1 / 10 | 71 / 37 / 11 |
| os dois juntos | 0 / 0 / 7 | 62 / 12 / 13 |
| 5 frentes | 58 / 11 / 10 | 54 / 11 / 24 |

As duas ficam no ruído uma da outra: o cabeçalho, o painel e Seu espaço no React não pioram a régua (e não a melhoram:
eles quase não redesenham com os bots trabalhando).

**Resultado consolidado** (2026-11-19, 12h, mesmo banco, uma variante logo depois da outra). A `main` foi medida com a
máquina quieta (carga de 1 min 2,8 no começo e no fim); a branch final, logo depois, com a carga subindo até 7,6 (outros
processos na máquina) — a comparação desfavorece a branch:

| Cenário | `main` | branch final (as cinco regiões no React + CSS) |
|---|---|---|
| ocioso | 192 / 142 / 18 | 0 / 0 / 13 |
| 8 bots fora da tela | 248 / 1.240 / 110 | 83 / 62 / 68 |
| turno pesado | **405** / 2.210 / 192 | 139 / 190 / 17 |
| os dois juntos | **493** / 3.398 / **248** | 74 / 31 / 59 |
| 5 frentes | **615** / 6.124 / **439** | 69 / 31 / 19 |

A `main` passa do portão da ADR-061 em três cenários (em negrito); a branch fica abaixo dele em todos, com 3 a 200 vezes
menos tempo de bloqueio (TBT). A medida da `main` das 11h37 (carga subindo até 18) foi descartada.

O CSS é o que tira a tela do vermelho: sem ele, a barra em React não mudava nada. O React soma por cima no que a pessoa
sente — a tecla no p95 cai 2 a 3,5 vezes em relação ao CSS sozinho, porque a barra deixa de criar centenas de nós (e
mascotes) por frame.

Peso no celular (build de produção, gzip -9): o `index-*.js` cresce 0,5 KB; o módulo novo tem 2,8 KB; o chunk do React
(69 KB) passa a baixar logo depois do boot, e não só ao abrir o onboarding ou o Marketplace. Dentro do teto de +120 KB
da ADR-179.

## Emenda (2026-11-19, fase 5 da ADR-179: abrir o quadro)

A medida do quadro (`scripts/carga-tela`, cenário `quadro` com 160 tarefas e a conversa de 150 trocas aberta por baixo)
achou o mesmo problema por outros dois caminhos. Abrir o quadro levava 300–620 ms até pintar com o servidor respondendo
em 65–270 ms: o JS era 60–75 ms, e o resto eram **quatro recálculos de estilo da conversa escondida por baixo** (31 a 42
mil elementos cada) a cada ida e volta. O trace com invalidação mostrou três causas:

1. **A conversa saía por `inert` + `visibility: hidden`.** As duas são herdadas: pô-las e tirá-las recalcula cada nó da
   conversa. Agora a `.qd-saiu` é `content-visibility: hidden` (o Chrome pula a subárvore no estilo e no layout, e ela não
   recebe foco, clique nem leitor de tela) e só a vista do quadro fica `inert`. A rolagem da conversa volta igual (medido).
2. **O Chrome junta todas as regras de `:has()` num conjunto de invalidação só.** A decisão 1 achava que bastava o sujeito
   ser estreito; não basta quando a âncora é um ancestral da conversa. Com `body:has(#pg-menu)` ou
   `.stage:has(> #quadro:not([hidden]) .pg-app)`, o `hidden` do `#quadro` que muda (ou os cards que entram) agenda a
   invalidação no `body` e no `.stage` com o conjunto juntado — que tem `.message`, `.bubble`, `.msg-actions`, `tr.md-extra`
   e os mascotes, sujeitos de outras regras. **Regra nova: nenhum `:has()` fora do sujeito ancorado em `html`, `body`,
   `main`, `.app` ou `.stage`.** O estado vira classe: `palco-*` no `.stage`, posta por `marcarEstadoDaPagina`
   (`web/lib/estado-da-pagina.ts`) depois de cada desenho que pode mudá-lo, e `pg-menu-aberto`/`menu-conta-aberto` no
   `<html>`, postas pelos próprios menus. As 14 regras foram reescritas com o mesmo efeito.
3. **Sujeito universal sob uma classe do `.stage`** (`.stage.qd-no-quadro > .cabecalho-pilula > *`,
   `.stage.qd-no-quadro .abas-com-pilula > :not(.at-pilula)`): trocar `qd-no-quadro` invalidava o palco inteiro. **Regra
   nova: sob uma classe do `.stage`, o sujeito nomeia o que estiliza.**

As duas regras novas estão travadas em `tests/unit/web/css-has-sem-sujeito-universal.test.ts`. Ficam como dívida, fora
desta emenda, as regras com sujeito universal sob estado do `<html>` ou da `.app` (`html[data-foco]`,
`html.borda-arrastando`, `.app.painel-entrando`), que trocam raramente, e os `:has()` no próprio `#timeline`
(`.timeline-wrap:has(> .tdt-casco)`), que só disparam ao trocar de tela.

**Resultado** (2026-11-19, build de produção, mesmo banco, uma variante logo depois da outra, carga de 1 min entre 2,3 e
3,3 do começo ao fim; 160 tarefas no quadro, maior tarefa / TBT / tecla p95 em ms):

| Cenário | `main` | com a emenda |
|---|---|---|
| ocioso | 0 / 0 / 11 | 0 / 0 / 11 |
| 8 bots fora da tela | 0 / 0 / 18 | 0 / 0 / 10 |
| turno pesado | 70 / 22 / 11 | 0 / 0 / 7 |
| os dois juntos | 54 / 4 / 16 | 55 / 5 / 9 |
| 5 frentes | 58 / 16 / 15 | 0 / 0 / 7 |
| quadro (bots escrevendo + arrastos) | 141 / 1.819 / 138 | 157 / 1.252 / 97 |

| Quadro (ms) | `main` | com a emenda |
|---|---|---|
| 1ª abertura: até pintar / maior tarefa / servidor | 500 / 233 / 57 | 197 / 77 / 71 |
| abrir de novo (p50): até pintar / maior tarefa / servidor | 307 / 252 / 76 | 136 / 91 / 91 |
| soltar → card na coluna nova, p50 / p95 | 95 / 273 | 76 / 146 |
| PATCH do mover (servidor), p50 / p95 | 125 / 353 | 135 / 355 |

No trace, a ida e a volta não têm mais nenhum recálculo da página inteira (antes, quatro de 31 a 42 mil elementos); o
maior visita a própria grade (~2,5 mil). Com a grade em React ligada (`?quadro-react=1`), a emenda também ajuda (abrir de
novo 318 → 183 ms), mas a grade continua mais lenta que a por string (soltar p50 123 contra 76 ms): ela é refeita nos
passos seguintes da fase 5 (ADR-179).

## Alternativas descartadas

- **Reescrever a barra e a conversa em JSX, componente a componente.** É o fim do caminho, mas as duas regiões somam
  ~4 mil linhas de desenho por string com regras de produto em cada linha; reescrever tudo antes de medir teria mudado o
  DOM de dezenas de testes e não teria achado a causa, que estava no CSS.
- **Só o CSS, sem React.** Resolve o vermelho, mas a barra continuava criando todas as linhas e mascotes a cada frame de
  outro bot (tecla p95 28–117 ms contra 12–33 ms com a barra no React).
- **`morfarDom` na barra, em vez do React.** Daria o mesmo "só a linha que mudou", mas é mais um mecanismo à mão (a ADR-179
  escolheu o React para não repetir isso tela a tela).
- **Animar o mascote a 30 quadros por segundo.** Corta o custo por quadro pela metade, mas a causa era a invalidação
  larga; com o CSS corrigido, o recálculo do mascote voltou a visitar só o SVG dele.

## Gatilho de reversão

- A régua pior com uma região no React e sem correção no mesmo PR: a chave daquela região vira desligada por padrão
  (`react-na-regiao.ts`) e a região volta ao desenho por string.
- Erro de reconciliação na tela ("The node to be removed is not a child of this node"): algum código passou a mexer por
  fora num nó que o React acompanha. Corrigir o código (a vaga chega vazia do HTML) ou desligar a região até lá.
- Um `:has()` que precisa de sujeito largo de verdade: abrir exceção no teste com o motivo e a medida do trace.

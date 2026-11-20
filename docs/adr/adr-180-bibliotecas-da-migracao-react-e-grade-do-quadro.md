# ADR-180: as bibliotecas da migração para React e a grade do quadro (fase 2)

Status: proposta (2026-11-13, frente "React fase 2 · Quadro"; as escolhas de biblioteca são do Marlon). Estende a
[ADR-179](adr-179-front-em-react-por-regioes.md), que deixou o item 7 ("bibliotecas extras só na fase que pedir") em
aberto. Esta é a única ADR que registra as bibliotecas da migração: as outras frentes citam esta, não abrem outra.

## Contexto

A ADR-179 trouxe React 19 e Base UI e disse que react-query, dnd-kit e motion entrariam quando uma fase pedisse. As
frentes abertas ao mesmo tempo (barra lateral e detalhes, animações dos bots, chat, computador, backend de estado vivo)
precisam saber agora quais são, para não escolher cada uma a sua. A fase 2 é o quadro: a primeira que pede o arrasto.

## Decisão 1 — as bibliotecas (valem para todas as fases)

| Para quê | Biblioteca | Regra |
|---|---|---|
| Menus, diálogos, popovers, tooltips, select, tabs | `@base-ui/react` 1.9 | Headless; o visual é o nosso (as classes que já existem ou `rx-` sobre `var(--…)`). Nada de outro kit de componentes. |
| Arrastar no quadro e na barra lateral | `@dnd-kit/core` 6.3 + `@dnd-kit/sortable` 10 (+ `@dnd-kit/utilities`) | Ponteiro (não o arrasto nativo do HTML). `DragOverlay` só com o item arrastado; os itens em `memo`, com key estável (o id). A regra de soltar fica fora do componente (uma só para arrasto, menu e teclado). |
| Dados do servidor | `@tanstack/react-query` | Cache por consulta com stale-while-revalidate, ligado ao cursor por conversa do backend de estado vivo: consulta incremental com `depois_de`/`geracao`; `cursor_velho` → refetch da consulta. A réplica em IndexedDB é o *persister* do Query; nenhum cache paralelo feito à mão. Entra na fase que migrar a primeira tela que lê dado (não nesta). |
| Animações de interface | `motion` | Entrada do balão, indicador Digitando/Refletindo, prévia da barra compacta, abrir/fechar de menus. Sempre com `prefers-reduced-motion` (sem deslocamento, fade curto ou nada). O personagem segue no `<nod-mascote>` (não vira motion). |

Cada biblioteca entra no `package.json` no PR da primeira fase que a usa, com versão exata. Fora desta tabela, uma
dependência nova de front precisa de outra ADR.

## Decisão 2 — a grade do quadro (fase 2)

1. **O que vai para o React é a grade do computador** (`.qd-quadro.qd-so-largo`: as colunas e os cards), não a região
   `#quadro` inteira. A região tem ainda a barra, a tarefa aberta, a pílula, a faixa, o celular e as páginas de app
   (~6 mil linhas no `quadro-na-tela.ts`), e as outras frentes mexem em volta. É um desvio consciente da regra "região
   inteira" da ADR-179 (item 4), só para o quadro e só nesta fase: a grade é a parte que pedia React (o arrasto que
   sobrevive ao frame), e o resto entra por partes nas fases seguintes.
2. **Uma vaga e um root só.** O `quadro-na-tela` continua regravando `.qd-conteudo` a cada desenho; o desenho por
   string deixa `.rx-qd-vaga` no lugar da grade e `web/react/quadro/grade-na-tela.tsx` põe ali o MESMO nó do React
   (um `createRoot` criado no primeiro desenho), redesenhando com `flushSync` para a rolagem e o foco restaurados logo
   depois acharem os nós. O card que não mudou não é redesenhado (memo por valor do HTML do corpo).
3. **O mesmo DOM.** Seções `section.qd-col[data-coluna]`, cards `li.qd-card[data-tarefa]` e o corpo do card do
   `partesDoCard` (o mesmo HTML por string): o CSS do `quadro.css`, a delegação dos botões de dentro do card (abrir,
   prioridade, Responder) e os testes de DOM seguem valendo. O que é do React é o `li` arrastável e o "Mover para…".
4. **Uma regra de soltar.** O arrasto e o "Mover para…" da grade chamam o `soltarCardEm` do `quadro-na-tela`, o mesmo
   do arrasto por string: trava (com o "Mandar para…"), diálogo de handoff na coluna com responsável, `mudar_tarefa`
   otimista com o Desfazer, e a frase da ordem ao soltar na própria coluna com ordem que não é a manual.
5. **Reordenar dentro da coluna**: a grade já usa o `SortableContext` por coluna, mas o servidor não grava a ordem
   manual (o `mudar_tarefa` não tem o campo; `ordem` só nasce na criação). Enquanto não houver o campo, os cards não
   abrem espaço no arrasto (estratégia parada) e soltar na própria coluna faz o que fazia. Com o campo, basta ligar
   `acoes.reordenar` (a estratégia vira `verticalListSortingStrategy`).
6. **Atrás de uma chave, desligada por padrão.** `?quadro-react=1` liga (fica no `localStorage` do navegador) e
   `?quadro-react=0` desliga (`web/lib/react-no-quadro.ts`). O módulo é carregado por `import()` só com a chave ligada:
   sem ela o JS inicial não muda. Ligar por padrão é outro PR, depois do teste de mão e dos três testes de Chrome que
   arrastam pelo evento nativo (`quadro-jornada`, `quadro-composer`, `quadro-rolagem`) passarem a arrastar por ponteiro.

## Gatilho de reversão

- A régua do `scripts/carga-tela` (cenário `quadro`) pior com a chave ligada e sem correção nesta fase: a chave fica
  desligada e a grade volta a ser só por string (apagar `web/react/quadro/` e o `grade` do `quadroDaMeta`).
- Uma biblioteca da tabela que não se pague (peso no celular acima do teto da ADR-179, ou o mesmo resultado com o que
  já existe): sai na fase em que isso aparecer, com a troca registrada aqui.

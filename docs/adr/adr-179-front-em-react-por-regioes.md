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
7. **Bibliotecas extras só na fase que pedir**: react-query, dnd-kit e motion não entram agora.
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

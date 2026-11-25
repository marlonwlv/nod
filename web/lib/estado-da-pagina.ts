/**
 * Fase 5 da ADR-179 (medido em 2026-11-19, scripts/carga-tela com trace de invalidação): o Chrome junta TODAS as regras
 * com `:has()` fora do sujeito num conjunto de invalidação só. Uma regra ancorada num ancestral da conversa (`body`,
 * `.stage`) faz o nó que entra perto dela (os cards do quadro, a barra do quadro, o `hidden` do `#quadro`) invalidar
 * desse ancestral para baixo com o conjunto juntado — que tem `.message`, `.bubble`, `.msg-actions`, os mascotes: abrir
 * o quadro recalculava o estilo dos ~40 mil elementos da conversa por baixo. O estado que essas regras liam vira classe,
 * posta aqui depois de cada desenho que pode mudá-lo; o CSS casa a classe, sem `:has()`.
 *
 * Travado por tests/unit/web/css-has-sem-sujeito-universal.test.ts (nenhum `:has()` ancorado em html, body, .app ou
 * .stage).
 */
export const ESTADOS_DO_PALCO = {
  /** A página do canvas à vista no lugar da conversa (web/canvas.css). */
  "palco-canvas": "#quadro:not([hidden])[data-pagina='canvas']",
  /** A página de um app à vista (web/casca.css: o campo da conversa por cima, embaixo). */
  "palco-app": "#quadro:not([hidden]) .pg-app",
  /** A barra do quadro mínimo à vista (web/quadro-min.css: sem o véu da pílula). */
  "palco-barra": "#quadro:not([hidden]) .qm-barra",
  /** A tarefa aberta (ta) à vista (web/tarefa-aberta.css). */
  "palco-tarefa-aberta": "#quadro:not([hidden]) .qd-tarefa.ta",
  /** Alguma tarefa aberta no quadro, computador ou celular (web/celular-base.css). */
  "palco-tarefa": "#quadro .qd-tarefa",
  "palco-tarefa-cel": "#quadro .qd-tarefa-cel",
  /** A pílula das frentes aberta (web/casca.css: a conversa sem a folga da pílula fechada). */
  "palco-frentes-abertas": ".pilula-frentes[data-estado='aberta']",
} as const;

/**
 * Põe ou tira cada classe de estado no `.stage`; só escreve o que mudou. Os menus que cobrem a página (o da página e o da
 * conta) marcam o `<html>` eles mesmos ao abrir e fechar (`pg-menu-aberto`, `menu-conta-aberto`).
 */
export function marcarEstadoDaPagina(doc: Document): void {
  const palco = doc.querySelector<HTMLElement>("main.stage");
  if (palco) for (const [classe, seletor] of Object.entries(ESTADOS_DO_PALCO)) trocar(palco, classe, !!palco.querySelector(seletor));
}

function trocar(el: HTMLElement, classe: string, ligada: boolean): void {
  if (el.classList.contains(classe) !== ligada) el.classList.toggle(classe, ligada);
}

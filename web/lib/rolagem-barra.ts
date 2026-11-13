/**
 * A rolagem da barra lateral (definido em 2026-10-06, pedido do Marlon). A barra é refeita por innerHTML a cada mudança
 * que ela lê (web/main.ts, redesenharSidebar) e a lista nova nascia no topo: clicar num bot do fim da lista, um turno
 * rodando, uma mensagem chegando ou soltar um bot arrastado jogavam a pessoa de volta ao começo. A regra: a lista fica
 * onde estava; só quando a conversa aberta muda, a linha dela entra na vista — com o mínimo de movimento, e nada se
 * já está inteira à vista.
 */
export type Faixa = { topo: number; base: number };

/** Folga para a linha não encostar na borda da lista quando entra na vista. */
export const MARGEM_NA_VISTA = 8;

/**
 * O scrollTop da lista depois de refeita. `linha` é a faixa da linha da conversa aberta em coordenadas do conteúdo
 * (topo 0 = início da lista), e só vem quando a conversa mudou desde o último desenho; `altura` é a parte visível.
 */
export function rolagemDaBarra(p: { anterior: number; altura: number; linha: Faixa | null; margem?: number }): number {
  const margem = p.margem ?? MARGEM_NA_VISTA;
  if (!p.linha || p.altura <= 0) return p.anterior;
  if (p.linha.topo < p.anterior) return Math.max(0, p.linha.topo - margem);
  if (p.linha.base > p.anterior + p.altura) return Math.max(0, p.linha.base - p.altura + margem);
  return p.anterior;
}

/**
 * COP-12 (spec da barra, "rolável com fade nas bordas"): de que lado a lista tem conteúdo escondido. A máscara só
 * dissolve a borda que esconde algo; no topo da lista a primeira linha (os fixados) aparece inteira. `folga` absorve o
 * scrollTop fracionário do zoom (a base nunca chega exata a scrollHeight − clientHeight).
 */
export function bordasDaLista(p: { rolagem: number; altura: number; total: number; folga?: number }): { topo: boolean; base: boolean } {
  const folga = p.folga ?? 1;
  if (p.altura <= 0 || p.total <= p.altura + folga) return { topo: false, base: false };
  return { topo: p.rolagem > folga, base: p.rolagem + p.altura < p.total - folga };
}

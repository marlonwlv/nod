/**
 * ADR-167 (telas 02–05 do Paper "nod x Grok Bot"): a linha fixa "Tarefas" da barra mostra quantas tarefas estão em
 * andamento nos quadros da pessoa — as das colunas do grupo "iniciado" (Fazendo, Em revisão, Bloqueado). Backlog, A fazer,
 * Feito e Cancelado não contam. Puro: a tela lê os quadros e chama isto.
 */
type ColunaDaConta = { id: string; grupo: string };
type TarefaDaConta = { status: string };

export function tarefasEmAndamento(quadro: { colunas: readonly ColunaDaConta[]; tarefas: readonly TarefaDaConta[] } | null | undefined): number {
  if (!quadro) return 0;
  const andando = new Set(quadro.colunas.filter((c) => c.grupo === "iniciado").map((c) => c.id));
  return quadro.tarefas.filter((t) => andando.has(t.status)).length;
}

/** Para onde a linha leva: o bot aberto, se tem quadro; senão o primeiro quadro da lista; sem quadro, nenhum. */
export function botDasTarefas(aberto: string | null, comQuadro: readonly string[]): string | null {
  if (aberto && comQuadro.includes(aberto)) return aberto;
  return comQuadro[0] ?? null;
}

/** O resumo do Quadro em Ajustes do painel (Paper 02): "2 em andamento · 1 bloqueada". */
export type ResumoDoQuadro = { andando: number; bloqueadas: number };
export function resumoDoQuadro(quadro: { colunas: readonly ColunaDaConta[]; tarefas: readonly TarefaDaConta[] } | null | undefined): ResumoDoQuadro | null {
  if (!quadro) return null;
  const bloqueadas = quadro.tarefas.filter((t) => t.status === "bloqueado").length;
  return { andando: tarefasEmAndamento(quadro) - bloqueadas, bloqueadas };
}
/** Os resumos que a tela já leu, por bot (a barra lê os quadros no fundo; o painel só mostra o que já sabe). */
export const resumosDosQuadros = new Map<string, ResumoDoQuadro>();

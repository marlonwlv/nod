import type { Invalidacao, Tela } from "../estado/reducer.ts";

/**
 * Instantâneo (2026-11-13): a ordem em que as leituras de uma passada do `reidratar` saem. Todas vão juntas, mas o
 * navegador abre até seis de cada vez no HTTP/1.1 (o nod diário em 127.0.0.1) e a conversa da tela é a que a pessoa
 * está esperando: ela sai primeiro; o resto fica na ordem em que veio.
 */
export function ordemDasLeituras(leituras: readonly Invalidacao[], tela: Pick<Tela, "tipo"> & { conversaId?: string }): Invalidacao[] {
  const daTela = (tela.tipo === "conversa" || tela.tipo === "sala" || tela.tipo === "linha") && tela.conversaId ? (`conversa:${tela.conversaId}` as const) : null;
  if (!daTela || !leituras.includes(daTela)) return [...leituras];
  return [daTela, ...leituras.filter((q) => q !== daTela)];
}

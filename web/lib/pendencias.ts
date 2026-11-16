import type { SuaVezDto } from "../../src/contracts/api.ts";
import { ehPergunta } from "./perguntas.ts";

/**
 * A pílula "N esperam você" acima do campo (definido em 2026-11-16, item 10 dos acessos devolvidos; Paper "Acessos ·
 * pendências"). Volta o acesso que a faixa "N coisas esperam você" dava, sem repetir o cartão: só conta, mostra o prazo
 * quando aperta e leva ao cartão. Aqui, as regras puras: o que conta, a ordem do clique, quando aparece e o ciclo.
 */

export type ItemPendente = SuaVezDto["itens"][number];

/** Menos que isto até vencer, a pílula ganha o prazo no tom de aviso. */
export const PRAZO_PERTO_MS = 60 * 60_000;
/** Um pedido dispensado volta a pedir a pílula quando falta menos que isto (para não vencer sem ser visto). */
export const VOLTA_ANTES_DE_VENCER_MS = 10 * 60_000;

/**
 * Os pedidos abertos da conversa que NÃO são pergunta (aprovação, acesso, gate de rotina…), do mais antigo ao mais novo —
 * o mesmo que a faixa antiga contava. A pergunta fica de fora: já vive no cartão e na caixa "Respondendo".
 */
export function pendenciasDaConversa(suaVez: Pick<SuaVezDto, "itens"> | null | undefined, conversaId: string): ItemPendente[] {
  return (suaVez?.itens ?? [])
    .filter((i) => i.decisao.conversaId === conversaId && i.estadoColuna !== "vencido" && !ehPergunta(i.decisao.tipo))
    .sort((a, b) => Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm));
}

/** Quanto falta para o pedido vencer: pelo relógio da tela quando ele já andou, senão pelo que o servidor mandou. */
export function venceEmMs(item: ItemPendente, agora: number): number {
  return agora ? Date.parse(item.decisao.prazoDecisaoEm) - agora : item.recusaAutomaticaEmMs;
}

/** A ordem do clique: o que vence primeiro antes (no empate, o mais antigo). */
export function emOrdemDePrazo(itens: readonly ItemPendente[], agora: number): ItemPendente[] {
  return [...itens].sort((a, b) => venceEmMs(a, agora) - venceEmMs(b, agora) || Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm));
}

/**
 * A pílula aparece com algum pedido que a pessoa não dispensou, ou com um dispensado a menos de 10 min de vencer. O ×
 * guarda os ids só em memória: chegou um id novo, ela volta.
 */
export function pilulaPendenciasVisivel(itens: readonly ItemPendente[], dispensadas: readonly string[] | undefined, agora: number): boolean {
  if (itens.length === 0) return false;
  const vistos = new Set(dispensadas ?? []);
  return itens.some((i) => !vistos.has(i.decisao.id) || venceEmMs(i, agora) < VOLTA_ANTES_DE_VENCER_MS);
}

/**
 * O próximo do ciclo: o primeiro da ordem quando nada foi visto (ou o visto saiu da lista), senão o seguinte, voltando ao
 * começo depois do último. Sem pedido, null.
 */
export function proximoDoCiclo(ordem: readonly string[], ultimo: string | null): string | null {
  if (ordem.length === 0) return null;
  const k = ultimo === null ? -1 : ordem.indexOf(ultimo);
  return ordem[(k + 1) % ordem.length] ?? null;
}

import { ErroDeDominio } from "./erro.ts";

/**
 * ADR-170 (definido em 2026-11-12): memória de TIME, revisada por gente, com consolidação periódica — o que o Grok Bot
 * faz com `PromoteGrokBotMemoriesToTeam`, os itens de revisão do time e o "dream" (`AdminStartGrokBotDream`).
 *
 * - O bot PROPÕE guardar (uma memória, uma skill, uma memória de pasta); nada entra na memória do time sem uma pessoa do
 *   time aprovar. A proposta guarda quem propôs, o texto, de onde veio e quando; a revisão, quem revisou e quando.
 * - Proposta igual a uma memória que o time já tem (mesmas palavras, na ordem que for) nem entra na fila: vira `duplicada`.
 * - A consolidação (o "sonho") roda fora do turno, de tempos em tempos: junta as memórias do time que dizem quase a mesma
 *   coisa (Jaccard das palavras ≥ 0,8) e PROPÕE a fusão — que volta para a mesma fila de revisão. Ela nunca apaga nada sozinha.
 * Puro: sem banco, sem relógio próprio.
 */
export type TipoItemDeMemoria = "memoria" | "skill" | "memoria_de_pasta";
export type EstadoRevisao = "proposta" | "aprovada" | "recusada" | "duplicada";
export type ItemDeRevisao = {
  id: string;
  tipo: TipoItemDeMemoria;
  texto: string;
  propostoPor: { agenteId: string; pessoaId: string };
  origem: string | null;
  em: number;
  estado: EstadoRevisao;
  revisadoPor: string | null;
  revisadoEm: number | null;
  /** Na fusão da consolidação: as memórias que esta substitui (só saem se a fusão for aprovada). */
  substitui?: string[];
};
export type MemoriaDoTime = { id: string; texto: string };

export const TETO_TEXTO_MEMORIA = 2000;
export const LIMIAR_PARECIDAS = 0.8;

const PALAVRA = /[\p{L}\p{N}]+/gu;
export function palavrasDe(texto: string): Set<string> {
  return new Set((texto.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(PALAVRA) ?? []).filter((p) => p.length > 2));
}

export function parecenca(a: string, b: string): number {
  const pa = palavrasDe(a);
  const pb = palavrasDe(b);
  if (pa.size === 0 && pb.size === 0) return 1;
  let comum = 0;
  for (const p of pa) if (pb.has(p)) comum++;
  return comum / (pa.size + pb.size - comum);
}

export function proporItem(p: { id: string; tipo: TipoItemDeMemoria; texto: string; agenteId: string; pessoaId: string; origem?: string | null; agora: number }, time: readonly MemoriaDoTime[], fila: readonly ItemDeRevisao[]): ItemDeRevisao {
  const texto = p.texto.trim().slice(0, TETO_TEXTO_MEMORIA);
  const jaTem = [...time.map((m) => m.texto), ...fila.filter((i) => i.estado === "proposta").map((i) => i.texto)].some((t) => parecenca(t, texto) === 1);
  return { id: p.id, tipo: p.tipo, texto, propostoPor: { agenteId: p.agenteId, pessoaId: p.pessoaId }, origem: p.origem ?? null, em: p.agora, estado: jaTem ? "duplicada" : "proposta", revisadoPor: null, revisadoEm: null };
}

/** Só a proposta aberta se revisa, e quem revisa é uma pessoa (o bot que propôs não se aprova). */
export function revisar(item: ItemDeRevisao, decisao: "aprovada" | "recusada", pessoaId: string, agora: number): ItemDeRevisao {
  if (item.estado !== "proposta") throw new ErroDeDominio("estado_invalido");
  return { ...item, estado: decisao, revisadoPor: pessoaId, revisadoEm: agora };
}

/**
 * O "sonho": grupos de memórias parecidas (união por pares acima do limiar) viram UMA proposta de fusão, com o texto
 * mais longo do grupo como base (o que tem mais detalhe). A pessoa aprova ou recusa na fila.
 */
export function consolidar(time: readonly MemoriaDoTime[], novoId: () => string, agora: number, quem: { agenteId: string; pessoaId: string }): ItemDeRevisao[] {
  const pai = new Map<string, string>(time.map((m) => [m.id, m.id]));
  const raiz = (id: string): string => { let r = id; while (pai.get(r) !== r) r = pai.get(r)!; return r; };
  for (let i = 0; i < time.length; i++) for (let j = i + 1; j < time.length; j++) {
    if (parecenca(time[i]!.texto, time[j]!.texto) >= LIMIAR_PARECIDAS) pai.set(raiz(time[j]!.id), raiz(time[i]!.id));
  }
  const grupos = new Map<string, MemoriaDoTime[]>();
  for (const m of time) grupos.set(raiz(m.id), [...(grupos.get(raiz(m.id)) ?? []), m]);
  const propostas: ItemDeRevisao[] = [];
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const base = [...g].sort((a, b) => b.texto.length - a.texto.length)[0]!;
    propostas.push({ id: novoId(), tipo: "memoria", texto: base.texto, propostoPor: quem, origem: "consolidacao", em: agora, estado: "proposta", revisadoPor: null, revisadoEm: null, substitui: g.map((m) => m.id) });
  }
  return propostas;
}

/** definido em 2026-11-12: o sonho roda no máximo uma vez a cada 24 h por time, e só com memórias novas desde o último. */
export const INTERVALO_CONSOLIDACAO_MS = 24 * 3600_000;
export function deveConsolidar(p: { ultimaEm: number | null; memoriasNovasDesde: number; agora: number }): boolean {
  return p.memoriasNovasDesde > 0 && (p.ultimaEm === null || p.agora - p.ultimaEm >= INTERVALO_CONSOLIDACAO_MS);
}

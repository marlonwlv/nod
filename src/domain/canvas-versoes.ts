/**
 * definido em 2026-11-05 (ADA-228, emenda da ADR-150): o que a página Canvas deriva das versões e dos comentários, puro.
 *
 * - O estado do canvas na lista "Todos os canvas" (J7-3): Esperando você, Em produção (com a etapa) ou Aprovado. O
 *   protótipo não tem botão de aprovar; a regra é a da Ada (2026-11-05, na ADA-228): Aprovado = a tarefa ligada ao canvas
 *   (pela issue) já saiu de Prototipando, com a data dessa passagem; sem tarefa ligada, nunca. Os comentários só
 *   decidem entre Em produção e Esperando você.
 * - As telas que mudaram de uma versão para a outra (o hash do html), para o histórico (J5-6) e o contorno "mudou" (J4-7).
 * - Os comentários que cada versão resolveu ("resolveu J1-2 e J1-3 · J1-1 segue aberto").
 */

import { normalizarNome } from "./colunas.ts";

export type EstadoCanvas = "esperando_voce" | "em_producao" | "aprovado";
export type EstadoDoCanvas = { estado: EstadoCanvas; etapa: string | null; aprovadoEm: number | null };

/** A tela como a regra a vê: o id, o hash do html e se ainda está em produção. */
export type TelaDaVersao = { id: string; html: string; pendente?: boolean };
export type ComentarioDoEstado = { id: string; paiId: string | null; telaId: string | null; jornada: string | null; autorTipo: "pessoa" | "bot" | "importado"; rodada: number | null; resolvidoEm: number | null; arquivadoEm: number | null; criadoEm: number };

const raizesVivas = <C extends ComentarioDoEstado>(cs: readonly C[]): C[] => cs.filter((c) => c.paiId === null && c.arquivadoEm === null);
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/**
 * O estado do canvas pela tarefa ligada, pela versão atual (as telas e quando nasceu) e pelos comentários:
 * 1. Aprovado: a tarefa ligada saiu de Prototipando (`aprovadoEm`, de `aprovadaEm`).
 * 2. Em produção: a versão atual tem tela pendente ("montando a J2-3 · 5 de 9 telas"), ou a última rodada da pessoa
 *    saiu depois da versão atual e ainda tem pino aberto ("ajustando a rodada 1 · 2 de 3").
 * 3. Esperando você: o resto ("1 comentário aberto" ou "pronto para você ver").
 */
export function estadoDoCanvas(atual: { telas: readonly TelaDaVersao[]; criadoEm: number } | null, comentarios: readonly ComentarioDoEstado[], aprovadoEm: number | null = null): EstadoDoCanvas {
  if (aprovadoEm !== null) return { estado: "aprovado", etapa: null, aprovadoEm };
  const telas = atual?.telas ?? [];
  const pendentes = telas.filter((t) => t.pendente === true);
  if (pendentes.length > 0) {
    return { estado: "em_producao", etapa: `montando a ${pendentes[0]?.id ?? ""} · ${telas.length - pendentes.length} de ${telas.length} telas`, aprovadoEm: null };
  }
  const raizes = raizesVivas(comentarios);
  const versaoEm = atual?.criadoEm ?? 0;
  const rodada = Math.max(0, ...raizes.filter((c) => c.rodada !== null && c.autorTipo === "pessoa").map((c) => c.rodada ?? 0));
  if (rodada > 0) {
    const daRodada = raizes.filter((c) => c.rodada === rodada && c.autorTipo === "pessoa");
    const enviadaDepois = daRodada.some((c) => c.criadoEm >= versaoEm);
    const resolvidos = daRodada.filter((c) => c.resolvidoEm !== null).length;
    if (enviadaDepois && resolvidos < daRodada.length) return { estado: "em_producao", etapa: `ajustando a rodada ${rodada} · ${resolvidos} de ${daRodada.length}`, aprovadoEm: null };
  }
  const abertos = raizes.filter((c) => c.resolvidoEm === null).length;
  return { estado: "esperando_voce", etapa: abertos > 0 ? plural(abertos, "comentário aberto", "comentários abertos") : "pronto para você ver", aprovadoEm: null };
}

/**
 * A próxima rodada da pessoa (J5-1): a maior das rodadas DELA mais um. A rodada que o bot (ou o importado) põe no
 * comentário dele não conta: senão um `rodada: 100000` vindo do bot empurrava a da pessoa para fora do CHECK da 0152 e
 * todo "Enviar N" seguinte era recusado (revisão do #677).
 */
export function proximaRodada(comentarios: readonly Pick<ComentarioDoEstado, "autorTipo" | "rodada">[]): number {
  let max = 0;
  for (const c of comentarios) if (c.autorTipo === "pessoa" && c.rodada !== null && c.rodada > max) max = c.rodada;
  return max + 1;
}

/** As colunas de espera: a tarefa nelas conta pela coluna para onde volta (`voltarPara`). */
const ESPERA: ReadonlySet<string> = new Set(["voce", "bloqueado"]);

/**
 * Quando a tarefa ligada ao canvas saiu de Prototipando (null = não saiu, ou o quadro não tem Prototipando). "Saiu" = a
 * coluna dela (ou a de volta, se está em Precisa de você ou Bloqueado) vem depois de Prototipando no quadro, ou é de
 * Feito; Cancelado não conta. A data é a da última entrada nesse trecho vinda de antes dele, pelo histórico; sem
 * histórico (a tarefa nasceu lá), quando ela nasceu.
 */
export function aprovadaEm(
  colunas: readonly { id: string; nome: string; grupo: string }[],
  tarefa: { status: string; voltarPara: string | null; criadoEm: number },
  historico: readonly { campo: string; para: string | null; criadoEm: number }[],
): number | null {
  const iProto = colunas.findIndex((c) => c.id === "c-prototipando" || normalizarNome(c.nome) === "prototipando");
  if (iProto < 0) return null;
  const depois = (id: string | null): boolean => {
    const i = colunas.findIndex((c) => c.id === id);
    const c = colunas[i];
    return !!c && !ESPERA.has(c.id) && c.grupo !== "fechado" && (i > iProto || c.grupo === "feito");
  };
  const onde = ESPERA.has(tarefa.status) ? tarefa.voltarPara : tarefa.status;
  if (!depois(onde)) return null;
  let em: number | null = null;
  let la = false;
  for (const h of historico) {
    if ((h.campo !== "status" && h.campo !== "criada") || h.para === null || ESPERA.has(h.para)) continue;
    const d = depois(h.para);
    if (d && !la) em = h.criadoEm;
    la = d;
  }
  return em ?? tarefa.criadoEm;
}

/** O que mudou da versão `antes` para a `depois`: as telas novas ou com outro html, e as que saíram. */
export function telasQueMudaram(antes: readonly TelaDaVersao[] | null, depois: readonly TelaDaVersao[]): { mudaram: string[]; sairam: string[] } {
  if (!antes) return { mudaram: [], sairam: [] };
  const velhas = new Map(antes.map((t) => [t.id, t.html] as const));
  const ids = new Set(depois.map((t) => t.id));
  return {
    mudaram: depois.filter((t) => velhas.get(t.id) !== t.html).map((t) => t.id),
    sairam: antes.filter((t) => !ids.has(t.id)).map((t) => t.id),
  };
}

/**
 * A versão que resolveu cada comentário: a primeira que nasceu depois do resolver (o bot resolve e publica), ou a
 * atual, se ele resolveu depois da última. `versoes` em qualquer ordem; devolve versão → ids dos comentários.
 */
export function resolvidosPorVersao(versoes: readonly { versao: number; criadoEm: number }[], comentarios: readonly ComentarioDoEstado[]): Map<number, string[]> {
  const ordem = [...versoes].sort((a, b) => a.versao - b.versao);
  const r = new Map<number, string[]>(ordem.map((v) => [v.versao, []]));
  const ultima = ordem.at(-1);
  if (!ultima) return r;
  for (const c of comentarios) {
    if (c.paiId !== null || c.resolvidoEm === null) continue;
    const em = c.resolvidoEm;
    const v = ordem.find((x) => x.criadoEm >= em) ?? ultima;
    r.get(v.versao)?.push(c.id);
  }
  return r;
}

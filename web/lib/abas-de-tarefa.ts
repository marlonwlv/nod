import type { EstadoTrabalho } from "../../src/contracts/trabalho.ts";

/**
 * As abas das tarefas (ADR-187 §6, lote B, passo 3, definido em 2026-11-18; Paper 4j opção 1, 4o e 4p). A tarefa abre em
 * tela cheia com uma fileira de abas no topo, que só existe dentro de uma tarefa. Regras, todas aqui, sem DOM:
 * - só vira aba a tarefa que a pessoa ABRIU (entrou nela), nunca toda tarefa do bot; a ordem é a de abertura;
 * - a fileira mostra as abas do bot da tarefa à vista; no máximo 3 à vista (a ativa sempre entre elas), o resto em
 *   "N outras ⌄";
 * - a aba fecha sozinha quando a pessoa SAI de uma tarefa que terminou (`terminado` ou `falhou`); a parada continua (ela
 *   não acabou: escrever retoma). A que termina enquanto a pessoa está noutra aba fica, com o ✓, até ela passar por lá;
 * - quais abas estão abertas sobrevive ao recarregar do mesmo navegador (localStorage, conveniência de quem vê) e, sem
 *   storage, a fileira funciona do mesmo jeito, só sem lembrar.
 */

export type AbaDeTarefa = { id: string; agenteId: string };

/** Paper 4j (opção 1): "no máximo 3; o resto fica em 'outras ⌄'". */
export const MAX_ABAS_A_VISTA = 3;
/** definido em 2026-11-18: teto do que fica guardado (as mais antigas saem primeiro); a fileira nunca passa disso. */
export const MAX_ABAS_GUARDADAS = 20;
export const CHAVE_DAS_ABAS = "nod:abas-de-tarefa";

/** Terminou de vez: a aba fecha quando a pessoa sai dela. Parada não (ADR-187, 4o, jornada 5: "fica parada, não acaba"). */
export function tarefaAcabou(estado: EstadoTrabalho | null | undefined): boolean {
  return estado === "terminado" || estado === "falhou";
}

/** Entrou numa tarefa: vira aba (no fim) se ainda não era. */
export function abrirAba(abas: readonly AbaDeTarefa[], aba: AbaDeTarefa): AbaDeTarefa[] {
  if (!aba.id || abas.some((a) => a.id === aba.id)) return [...abas];
  return [...abas, aba].slice(-MAX_ABAS_GUARDADAS);
}

export function fecharAba(abas: readonly AbaDeTarefa[], id: string): AbaDeTarefa[] {
  return abas.filter((a) => a.id !== id);
}

/**
 * A troca de tela: `saindo` é a tarefa que estava à vista (null = não era tarefa), `acabou` diz se ela já terminou;
 * `entrando` é a tarefa que vai à vista (null = outra tela, como a Conversa). Sair de uma tarefa que acabou fecha a aba.
 */
export function trocarDeTela(
  abas: readonly AbaDeTarefa[],
  t: { saindo: string | null; acabou: boolean; entrando: AbaDeTarefa | null },
): AbaDeTarefa[] {
  let lista = [...abas];
  if (t.saindo && t.saindo !== t.entrando?.id && t.acabou) lista = fecharAba(lista, t.saindo);
  return t.entrando ? abrirAba(lista, t.entrando) : lista;
}

/**
 * As abas da fileira: as do bot, a ativa sempre à vista. Se a ativa passou da terceira, ela toma o lugar da terceira
 * (as duas primeiras ficam onde a pessoa as deixou); o resto vai para "outras".
 */
export function dividirAbas(abasDoBot: readonly AbaDeTarefa[], ativa: string | null, max = MAX_ABAS_A_VISTA): { aVista: AbaDeTarefa[]; outras: AbaDeTarefa[] } {
  const i = ativa ? abasDoBot.findIndex((a) => a.id === ativa) : -1;
  if (i < max) return { aVista: abasDoBot.slice(0, max), outras: abasDoBot.slice(max) };
  const aVista = [...abasDoBot.slice(0, max - 1), abasDoBot[i]!];
  return { aVista, outras: abasDoBot.filter((a) => !aVista.includes(a)) };
}

/** Fechou a aba à vista: vai para a da direita; sem ela, a da esquerda; sem nenhuma, null (volta à Conversa). */
export function vizinhaAoFechar(abasDoBot: readonly AbaDeTarefa[], id: string): string | null {
  const i = abasDoBot.findIndex((a) => a.id === id);
  if (i < 0) return null;
  return abasDoBot[i + 1]?.id ?? abasDoBot[i - 1]?.id ?? null;
}

/** O que o localStorage guarda; qualquer coisa estranha vira lista vazia (nunca quebra a tela). */
export function lerAbas(texto: string | null | undefined): AbaDeTarefa[] {
  if (!texto) return [];
  let v: unknown;
  try { v = JSON.parse(texto); } catch { return []; }
  if (!Array.isArray(v)) return [];
  let lista: AbaDeTarefa[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) continue;
    const { id, agenteId } = x as Record<string, unknown>;
    if (typeof id === "string" && id !== "" && typeof agenteId === "string" && agenteId !== "") lista = abrirAba(lista, { id, agenteId });
  }
  return lista;
}

export function gravarAbas(abas: readonly AbaDeTarefa[]): string {
  return JSON.stringify(abas.slice(-MAX_ABAS_GUARDADAS).map((a) => ({ id: a.id, agenteId: a.agenteId })));
}

/**
 * Depois que a lista de tarefas chegou: tira as abas cuja tarefa a tela não conhece mais (apagada, terminada há tempo e
 * fora da lista, de outra conta neste navegador). A à vista nunca sai; a que acabou e a pessoa não viu fica (com o ✓).
 */
export function podarAbas(abas: readonly AbaDeTarefa[], conhecida: (id: string) => boolean, ativa: string | null): AbaDeTarefa[] {
  const lista = abas.filter((a) => a.id === ativa || conhecida(a.id));
  return lista.length === abas.length ? [...abas] : lista;
}

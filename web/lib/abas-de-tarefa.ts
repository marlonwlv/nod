import type { EstadoTrabalho } from "../../src/contracts/trabalho.ts";

/**
 * As abas das tarefas (ADR-187 §6, lote B, passo 3, definido em 2026-11-18; Paper 4j opção 1, 4o e 4p). Regras, todas
 * aqui, sem DOM:
 * - só vira aba a tarefa que a pessoa ABRIU (entrou nela) ou que ela pediu para ver em abas; a ordem é a de abertura;
 * - a fileira mostra as abas do bot; no máximo 3 à vista (a ativa sempre entre elas, e a que precisa da pessoa nunca
 *   fica escondida), o resto em "N outras ⌄";
 * - nenhuma aba fecha sozinha (validação de 2026-11-18, Paper 10b): a que terminou fica com o ✓ até a pessoa tirá-la
 *   (o menu da aba ou "Tirar as feitas das abas");
 * - modo pílula × modo abas (Paper 10b e 10c A, 2026-11-18): o modo é lembrado por bot. Abrir uma tarefa ou o botão de
 *   abas liga; só "Fechar abas" desliga (e tirar a última aba). No modo abas a fileira fica também na Conversa;
 * - quais abas estão abertas e o modo sobrevivem ao recarregar do mesmo navegador (localStorage, conveniência de quem
 *   vê) e, sem storage, a fileira funciona do mesmo jeito, só sem lembrar.
 */

export type AbaDeTarefa = { id: string; agenteId: string };

/** Paper 4j (opção 1): "no máximo 3; o resto fica em 'outras ⌄'". */
export const MAX_ABAS_A_VISTA = 3;
/** definido em 2026-11-18: teto do que fica guardado (as mais antigas saem primeiro); a fileira nunca passa disso. */
export const MAX_ABAS_GUARDADAS = 20;
export const CHAVE_DAS_ABAS = "nod:abas-de-tarefa";

/** Terminou de vez ("Tirar as feitas das abas" leva estas). Parada não (ADR-187, 4o, jornada 5: "fica parada, não acaba"). */
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
 * As abas da fileira: as do bot, a ativa sempre à vista. Se a ativa passou da terceira, ela toma o lugar da terceira
 * (as duas primeiras ficam onde a pessoa as deixou); o resto vai para "outras". `precisa` (Paper 10b, 3b): a aba de quem
 * precisa da pessoa nunca fica escondida — ela toma o lugar da última à vista que não é a ativa nem precisa.
 */
export function dividirAbas(abasDoBot: readonly AbaDeTarefa[], ativa: string | null, max = MAX_ABAS_A_VISTA, precisa?: (id: string) => boolean): { aVista: AbaDeTarefa[]; outras: AbaDeTarefa[] } {
  const i = ativa ? abasDoBot.findIndex((a) => a.id === ativa) : -1;
  const aVista = i < max ? abasDoBot.slice(0, max) : [...abasDoBot.slice(0, max - 1), abasDoBot[i]!];
  if (precisa) {
    for (const a of abasDoBot) {
      if (aVista.includes(a) || !precisa(a.id)) continue;
      let j = aVista.length - 1;
      while (j >= 0 && (aVista[j]!.id === ativa || precisa(aVista[j]!.id))) j--;
      if (j < 0) break;
      aVista.splice(j, 1);
      aVista.push(a);
    }
    aVista.sort((x, y) => abasDoBot.indexOf(x) - abasDoBot.indexOf(y));
  }
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

/** Paper 10b (2026-11-18): o botão de abas leva as tarefas abertas do bot que ainda não eram aba (as mais antigas primeiro). */
export function abasAoMostrar(abas: readonly AbaDeTarefa[], abertasDoBot: readonly AbaDeTarefa[]): AbaDeTarefa[] {
  return abertasDoBot.reduce<AbaDeTarefa[]>((lista, a) => abrirAba(lista, a), [...abas]);
}

/** Os bots em modo abas (Paper 10b, 2026-11-18): guardados no localStorage como a lista de abas. */
export const CHAVE_DO_MODO_ABAS = "nod:modo-abas";

export function lerModoAbas(texto: string | null | undefined): Set<string> {
  if (!texto) return new Set();
  let v: unknown;
  try { v = JSON.parse(texto); } catch { return new Set(); }
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
}

export function gravarModoAbas(bots: ReadonlySet<string>): string {
  return JSON.stringify([...bots].sort());
}

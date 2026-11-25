import type { EstadoTarefa, TarefaObjetivo, Thread } from "../contracts/tarefa.ts";
import { decidirBackfill, estadoDoBackfill, estadoDoCardNoBackfill, type DecisaoDoBackfill } from "../domain/backfill-tarefas.ts";
import { tituloDoTrabalho } from "../domain/trabalho.ts";
import type { CandidatoAoBackfill } from "../repositories/tarefas.repo.ts";
import type { Deps } from "./tipos.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 4): o backfill das Tarefas antigas, um lote por chamada, dentro da transação da
 * pessoa. Idempotente (a chave de origem — "trabalho:<id>" ou "card:<id>" — é única e o trabalho já ligado sai da
 * consulta) e retomável (cursor por criação; um lote que caiu é refeito do zero pela transação). Não publica eventos:
 * nada muda na execução, e a tela vê as Tarefas na próxima leitura. A trilha de cada Tarefa conta de onde ela veio
 * (`criada` com `backfill: true` e o estado legado; `entregue` com a hora em que o trabalho terminou).
 */

type DepsBackfill = Pick<Deps, "repos" | "escopo" | "agora">;

export type ResultadoDoLote = {
  lidos: number;
  criadas: number;
  ligados: number;
  cards: number;
  herdados: number;
  turnosLigados: number;
  fora: Record<string, number>;
  /** Onde o próximo lote começa; null = acabou. */
  cursor: { criadoEm: number; id: string } | null;
};

export const LOTE_DO_BACKFILL = 200;

export async function backfillTarefasLote(deps: DepsBackfill, p: { depois: { criadoEm: number; id: string } | null; limite?: number; aplicar: boolean }): Promise<ResultadoDoLote> {
  const limite = p.limite ?? LOTE_DO_BACKFILL;
  const candidatos = await deps.repos.tarefas.candidatosAoBackfill(p.depois, limite);
  const r: ResultadoDoLote = { lidos: candidatos.length, criadas: 0, ligados: 0, cards: 0, herdados: 0, turnosLigados: 0, fora: {}, cursor: null };
  // A mãe ligada NESTE lote (a consulta leu antes): a filha herda dela também.
  const ligadosAgora = new Map<string, string>();
  // Na simulação, as chaves que já "criariam" uma Tarefa (os vários trabalhos de um Card contam uma).
  const simuladas = new Set<string>();
  for (const w of candidatos) {
    const d = decidirBackfill({ ...w, tarefaDaMae: w.tarefaDaMae ?? (w.trabalhoMaeId ? ligadosAgora.get(w.trabalhoMaeId) ?? null : null) });
    if (d.tipo === "fora") {
      r.fora[d.motivo] = (r.fora[d.motivo] ?? 0) + 1;
      continue;
    }
    if (!p.aplicar) {
      const nova = d.tipo !== "herda" && !simuladas.has(d.origemChave) && !(await deps.repos.tarefas.buscarPorOrigem(d.origemChave));
      if (d.tipo !== "herda") simuladas.add(d.origemChave);
      contar(r, d, nova);
      continue;
    }
    const alvo = await tarefaDoAlvo(deps, w, d);
    if (!alvo) {
      r.fora.sem_tarefa = (r.fora.sem_tarefa ?? 0) + 1;
      continue;
    }
    if (await deps.repos.tarefas.ligarTrabalho(w.id, alvo.tarefa.id)) {
      r.ligados += 1;
      ligadosAgora.set(w.id, alvo.tarefa.id);
      if (alvo.thread) r.turnosLigados += await deps.repos.tarefas.ligarTurnosDoTrabalho(w.id, alvo.thread.id);
    }
    contar(r, d, alvo.criada);
  }
  const ultimo = candidatos.at(-1);
  r.cursor = candidatos.length === limite && ultimo ? { criadoEm: ultimo.criadoEm, id: ultimo.id } : null;
  return r;
}

function contar(r: ResultadoDoLote, d: DecisaoDoBackfill, criada: boolean): void {
  if (d.tipo === "herda") r.herdados += 1;
  if (d.tipo === "card" && criada) r.cards += 1;
  if (criada) r.criadas += 1;
}

/** A Tarefa (e a Thread primária) para onde o trabalho vai: a da mãe, a já criada com a mesma chave, ou uma nova. */
async function tarefaDoAlvo(deps: DepsBackfill, w: CandidatoAoBackfill, d: Exclude<DecisaoDoBackfill, { tipo: "fora" }>): Promise<{ tarefa: TarefaObjetivo; thread: Thread | null; criada: boolean } | null> {
  if (d.tipo === "herda") {
    const tarefa = await deps.repos.tarefas.buscar(d.tarefaId);
    return tarefa ? { tarefa, thread: await deps.repos.tarefas.threadPrimaria(tarefa.id), criada: false } : null;
  }
  const ja = await deps.repos.tarefas.buscarPorOrigem(d.origemChave);
  if (ja) return { tarefa: ja, thread: await deps.repos.tarefas.threadPrimaria(ja.id), criada: false };
  const doCard = d.tipo === "card" ? await deps.repos.tarefas.trabalhosDoCard(d.cardId) : [];
  const estado: EstadoTarefa = d.tipo === "card" ? estadoDoCardNoBackfill(doCard) : estadoDoBackfill(w);
  // A entrega vem do trabalho que terminou (no Card, o último a terminar); o autor é o bot dele.
  const entrega = estado === "entregue" ? (d.tipo === "card" ? [...doCard].sort((a, b) => (a.terminadoEm ?? a.criadoEm) - (b.terminadoEm ?? b.criadoEm)).at(-1) ?? w : w) : null;
  const tarefa = await deps.repos.tarefas.criar({
    agenteId: w.agenteId,
    titulo: tituloDoTrabalho(w.titulo),
    estado,
    origemChave: d.origemChave,
    criadoEm: d.tipo === "card" ? Math.min(...doCard.map((x) => x.criadoEm), w.criadoEm) : w.criadoEm,
    ...(entrega ? { entregueEm: entrega.terminadoEm ?? entrega.criadoEm, entreguePorTipo: "agente" as const, entreguePorId: entrega.agenteId } : {}),
  });
  if (!tarefa) {
    // Outra passada (ou outra pessoa do tenant, no Card) criou a mesma chave: segue para a dela, se for desta pessoa.
    const vencedora = await deps.repos.tarefas.buscarPorOrigem(d.origemChave);
    return vencedora ? { tarefa: vencedora, thread: await deps.repos.tarefas.threadPrimaria(vencedora.id), criada: false } : null;
  }
  const thread = await deps.repos.tarefas.criarThread({ tarefaId: tarefa.id, conversaId: w.conversaId, criadoEm: tarefa.criadoEm });
  const sistema = { autorTipo: "sistema" as const, autorId: deps.escopo.pessoaId };
  await deps.repos.tarefas.registrarEvento({ tarefaId: tarefa.id, tipo: "criada", ...sistema, dados: { backfill: true, legado: w.estado, origem: d.origemChave.split(":")[0]! }, criadoEm: tarefa.criadoEm });
  if (thread) await deps.repos.tarefas.registrarEvento({ tarefaId: tarefa.id, tipo: "thread_criada", ...sistema, dados: { thread_id: thread.id, tipo: thread.tipo }, criadoEm: tarefa.criadoEm });
  // A entrega nunca antes da criação na trilha (um relógio torto não inverte a história).
  if (entrega) await deps.repos.tarefas.registrarEvento({ tarefaId: tarefa.id, tipo: "entregue", autorTipo: "agente", autorId: entrega.agenteId, dados: { backfill: true }, criadoEm: Math.max(entrega.terminadoEm ?? entrega.criadoEm, tarefa.criadoEm) });
  // A ponte com o Card (só a dona do Card consegue: a RLS deixa o UPDATE de outra pessoa sem efeito).
  if (d.tipo === "card") await deps.repos.tarefas.ligarCard(d.cardId, tarefa.id);
  return { tarefa, thread, criada: true };
}

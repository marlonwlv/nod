import type { EstadoTarefa } from "../contracts/tarefa.ts";
import type { EstadoTrabalho, OrigemTrabalho } from "../contracts/trabalho.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 4): o backfill das Tarefas antigas — o que cada trabalho de antes vira. Puro: o
 * caso de uso lê os trabalhos, pergunta aqui e grava. Regras da especificação:
 *
 * - frente (`forma='frente'`) de origem pessoa ou rede, sem Card: uma Tarefa + Thread por trabalho;
 * - trabalho ligado a um Card (`trabalhos.tarefa_id`): uma Tarefa por Card, e os trabalhos do Card apontam para ela;
 * - frente filha (`trabalho_mae_id`) herda a Tarefa da mãe quando a mãe já tem uma (relação inequívoca); senão, segue a
 *   regra da própria origem — nunca une por título;
 * - rotina e colega não viram Tarefa (rotina não gera uma Tarefa por execução; o pedido de colega é do outro bot);
 * - `terminado` vira `entregue` (nunca `resolvida`: não houve aceite humano); `parado`/`falhou` e o que ainda roda viram
 *   `em_andamento` (a atividade derivada mostra a interrupção); o que nunca começou, `nao_iniciada`.
 */
export type TrabalhoParaBackfill = {
  id: string;
  origem: OrigemTrabalho;
  forma: "task" | "frente";
  estado: EstadoTrabalho;
  iniciadoEm: number | null;
  /** O Card do quadro (`trabalhos.tarefa_id`). */
  cardId: string | null;
  trabalhoMaeId: string | null;
  /** A Tarefa da mãe, quando a mãe já foi ligada. */
  tarefaDaMae: string | null;
  tarefaObjetivoId: string | null;
};

export type DecisaoDoBackfill =
  | { tipo: "propria"; origemChave: string }
  | { tipo: "card"; origemChave: string; cardId: string }
  | { tipo: "herda"; tarefaId: string }
  | { tipo: "fora"; motivo: "ja_ligado" | "rotina" | "colega" | "task" | "sem_regra" };

export function decidirBackfill(t: TrabalhoParaBackfill): DecisaoDoBackfill {
  if (t.tarefaObjetivoId) return { tipo: "fora", motivo: "ja_ligado" };
  if (t.cardId) return { tipo: "card", origemChave: `card:${t.cardId}`, cardId: t.cardId };
  if (t.trabalhoMaeId && t.tarefaDaMae) return { tipo: "herda", tarefaId: t.tarefaDaMae };
  if (t.origem === "rotina") return { tipo: "fora", motivo: "rotina" };
  if (t.origem === "colega") return { tipo: "fora", motivo: "colega" };
  if (t.forma !== "frente") return { tipo: "fora", motivo: "task" };
  if (t.origem === "pessoa" || t.origem === "rede") return { tipo: "propria", origemChave: `trabalho:${t.id}` };
  return { tipo: "fora", motivo: "sem_regra" };
}

/** O estado da Tarefa que um trabalho antigo implica. */
export function estadoDoBackfill(t: Pick<TrabalhoParaBackfill, "estado" | "iniciadoEm">): EstadoTarefa {
  if (t.estado === "terminado") return "entregue";
  if (t.estado === "parado" || t.estado === "falhou") return "em_andamento";
  return t.iniciadoEm !== null || t.estado !== "na_fila" ? "em_andamento" : "nao_iniciada";
}

/**
 * O estado da Tarefa de um Card, pelos trabalhos dele: todos terminados → `entregue`; algum começou → `em_andamento`;
 * nenhum começou → `nao_iniciada`. A coluna do Card (Feito) não conta: Card e objetivo são dimensões diferentes.
 */
export function estadoDoCardNoBackfill(trabalhos: readonly Pick<TrabalhoParaBackfill, "estado" | "iniciadoEm">[]): EstadoTarefa {
  if (trabalhos.length > 0 && trabalhos.every((t) => t.estado === "terminado")) return "entregue";
  return trabalhos.some((t) => estadoDoBackfill(t) !== "nao_iniciada") ? "em_andamento" : "nao_iniciada";
}

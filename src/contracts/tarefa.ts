import type { EpochMs } from "./ids.ts";

/**
 * ADR-192 (definido em 2026-11-22): a Tarefa é o objetivo persistente; a Thread, a conversa/contexto durável dela; o Turno,
 * uma execução. Na tela continuam "+ Nova tarefa" e "Tarefas" — "Thread" e "Turno" nunca aparecem para a pessoa.
 *
 * Nome no código: `TarefaObjetivo` quando houver risco de confusão com o Card do quadro (`quadro_tarefas`, o `tarefaId`
 * de trabalhos.tarefa_id) ou com o `tarefaId` de um pedido entre bots.
 */
export const ESTADOS_TAREFA = ["nao_iniciada", "em_andamento", "entregue", "resolvida", "arquivada"] as const;
export type EstadoTarefa = (typeof ESTADOS_TAREFA)[number];

export const TIPOS_EVENTO_TAREFA = ["criada", "iniciada", "entregue", "resolvida", "reaberta", "arquivada", "desarquivada", "thread_criada"] as const;
export type TipoEventoTarefa = (typeof TIPOS_EVENTO_TAREFA)[number];

export type AutorTipoTarefa = "pessoa" | "agente" | "sistema";

export type AtividadeTarefa = "trabalhando" | "precisa_de_voce" | "em_espera" | "interrompida";

export type TarefaObjetivo = {
  id: string;
  ownerId: string;
  agenteId: string;
  titulo: string;
  estado: EstadoTarefa;
  estadoAntesDeArquivar: Exclude<EstadoTarefa, "arquivada"> | null;
  entregueEm: EpochMs | null;
  entreguePorTipo: AutorTipoTarefa | null;
  entreguePorId: string | null;
  resolvidaEm: EpochMs | null;
  resolvidaPor: string | null;
  arquivadaEm: EpochMs | null;
  versao: number;
  chaveIdempotencia: string | null;
  origemChave: string | null;
  criadoEm: EpochMs;
  atualizadoEm: EpochMs;
};

export type TipoThread = "primaria" | "secundaria";

export type Thread = {
  id: string;
  tarefaId: string;
  conversaId: string;
  tipo: TipoThread;
  criadoEm: EpochMs;
  fechadaEm: EpochMs | null;
};

export type EventoTarefa = {
  id: string;
  tarefaId: string;
  tipo: TipoEventoTarefa;
  autorTipo: AutorTipoTarefa;
  autorId: string;
  turnoId: string | null;
  dados: Record<string, string | number | boolean | null>;
  criadoEm: EpochMs;
};

/**
 * A Tarefa ligada a um trabalho, como o `TrabalhoDto` a leva (etapa 3): a tela legada mostra o estado do objetivo e a
 * atividade sem pedir outra rota. Ausente = trabalho sem Tarefa (rotina, colega, os de antes do backfill).
 */
export type TarefaNoTrabalho = {
  id: string;
  estado: EstadoTarefa;
  atividade: AtividadeTarefa | null;
  versao: number;
  entregueEm: EpochMs | null;
  resolvidaEm: EpochMs | null;
};

/** O que a lista e o card da conversa principal mostram: o estado do objetivo e, à parte, a atividade atual. */
export type TarefaDto = {
  id: string;
  agenteId: string;
  titulo: string;
  estado: EstadoTarefa;
  atividade: AtividadeTarefa | null;
  versao: number;
  entregueEm: EpochMs | null;
  resolvidaEm: EpochMs | null;
  arquivadaEm: EpochMs | null;
  criadoEm: EpochMs;
  atualizadoEm: EpochMs;
  /** A Thread primária (MVP: a única conversa da Tarefa). */
  threadId: string | null;
  /** O trabalho runtime ligado (adaptador legado: sessão do CLI, pasta, máquina, custo). */
  trabalhoId: string | null;
  /** O Card do quadro ligado, quando houver (opcional: a Tarefa não depende dele). */
  cardId: string | null;
};

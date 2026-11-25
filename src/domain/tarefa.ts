import type { AutorTipoTarefa, EstadoTarefa, TarefaObjetivo, TipoEventoTarefa } from "../contracts/tarefa.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 1): as transições do estado de negócio da Tarefa. Puro: recebe a linha atual, o
 * comando, o autor e `agora`; devolve a linha nova e os eventos da trilha, ou a recusa. Quem grava é o caso de uso.
 *
 * | De                 | Comando     | Para                                   | Autor                     |
 * |--------------------|-------------|----------------------------------------|---------------------------|
 * | nao_iniciada       | iniciar     | em_andamento                           | sistema (o turno começou) |
 * | em_andamento (*)   | entregar    | entregue                               | agente (com o turno)      |
 * | entregue           | entregar    | entregue (a nova entrega substitui)    | agente                    |
 * | entregue, nao_ini. | continuar   | em_andamento                           | pessoa                    |
 * | resolvida          | continuar   | em_andamento (reabre primeiro)         | pessoa                    |
 * | não arquivada      | resolver    | resolvida                              | pessoa                    |
 * | resolvida, entregue| reabrir     | em_andamento                           | pessoa                    |
 * | arquivada          | reabrir     | o estado de antes de arquivar          | pessoa                    |
 * | não arquivada      | arquivar    | arquivada                              | pessoa                    |
 * | arquivada          | desarquivar | o estado de antes de arquivar          | pessoa                    |
 *
 * (*) entregar também vale de `nao_iniciada` (a entrega implica o início).
 *
 * Invariante 4: nenhum fato de turno (concluído, falhou, interrompido) resolve — só `resolver`, de uma pessoa. Um turno
 * interrompido não muda o estado de negócio (a atividade é que passa a `interrompida`). Os comandos repetidos são
 * idempotentes: o segundo `resolver` de uma resolvida volta `mudou: false` e nenhum evento.
 */
export type ComandoTarefa = "iniciar" | "entregar" | "continuar" | "resolver" | "reabrir" | "arquivar" | "desarquivar";

export type AutorDaTransicao = { tipo: AutorTipoTarefa; id: string };

/** O autor que cada comando exige (a resolução e as ações da tela são da pessoa; a entrega, do bot; o início, do sistema). */
export const AUTOR_DO_COMANDO: Record<ComandoTarefa, readonly AutorTipoTarefa[]> = {
  iniciar: ["sistema"],
  entregar: ["agente"],
  continuar: ["pessoa"],
  resolver: ["pessoa"],
  reabrir: ["pessoa"],
  arquivar: ["pessoa"],
  desarquivar: ["pessoa"],
};

/** Os campos da linha que uma transição muda. */
export type LinhaTarefa = Pick<TarefaObjetivo, "estado" | "estadoAntesDeArquivar" | "entregueEm" | "entreguePorTipo" | "entreguePorId" | "resolvidaEm" | "resolvidaPor" | "arquivadaEm" | "versao">;

export type EventoDaTransicao = { tipo: TipoEventoTarefa; dados?: Record<string, string | number | boolean | null> };

export type ResultadoTransicao =
  | { ok: true; mudou: false }
  | { ok: true; mudou: true; linha: LinhaTarefa; eventos: EventoDaTransicao[] }
  | { ok: false; erro: "autor_invalido" | "estado_invalido" };

const SEM_MUDANCA: ResultadoTransicao = { ok: true, mudou: false };

function mudar(atual: LinhaTarefa, parcial: Partial<LinhaTarefa>, eventos: EventoDaTransicao[]): ResultadoTransicao {
  return { ok: true, mudou: true, linha: { ...atual, ...parcial, versao: atual.versao + 1 }, eventos };
}

/** Volta de `resolvida` para `em_andamento`: a resolução sai da projeção da linha e fica no evento `reaberta`. */
const reabertura = { estado: "em_andamento" as const, resolvidaEm: null, resolvidaPor: null };

export function transicaoDaTarefa(atual: LinhaTarefa, comando: ComandoTarefa, autor: AutorDaTransicao, agora: number): ResultadoTransicao {
  if (!AUTOR_DO_COMANDO[comando].includes(autor.tipo)) return { ok: false, erro: "autor_invalido" };
  const e = atual.estado;
  switch (comando) {
    case "iniciar":
      return e === "nao_iniciada" ? mudar(atual, { estado: "em_andamento" }, [{ tipo: "iniciada" }]) : SEM_MUDANCA;
    case "entregar":
      if (e === "nao_iniciada" || e === "em_andamento" || e === "entregue") {
        const eventos: EventoDaTransicao[] = e === "nao_iniciada" ? [{ tipo: "iniciada" }, { tipo: "entregue" }] : [{ tipo: "entregue", ...(e === "entregue" ? { dados: { substitui: true } } : {}) }];
        return mudar(atual, { estado: "entregue", entregueEm: agora, entreguePorTipo: autor.tipo, entreguePorId: autor.id }, eventos);
      }
      // Resolvida ou arquivada: a entrega tardia (o bot que ainda falava) não muda o objetivo que a pessoa fechou.
      return SEM_MUDANCA;
    case "continuar":
      if (e === "arquivada") return { ok: false, erro: "estado_invalido" };
      if (e === "resolvida") return mudar(atual, reabertura, [{ tipo: "reaberta", dados: { por_continuar: true } }]);
      if (e === "entregue" || e === "nao_iniciada") return mudar(atual, { estado: "em_andamento" }, [{ tipo: e === "nao_iniciada" ? "iniciada" : "reaberta" }]);
      return SEM_MUDANCA;
    case "resolver":
      if (e === "arquivada") return { ok: false, erro: "estado_invalido" };
      if (e === "resolvida") return SEM_MUDANCA;
      return mudar(atual, { estado: "resolvida", resolvidaEm: agora, resolvidaPor: autor.id }, [{ tipo: "resolvida", dados: { de: e } }]);
    case "reabrir":
      if (e === "arquivada") return desarquivar(atual);
      if (e === "resolvida") return mudar(atual, reabertura, [{ tipo: "reaberta" }]);
      if (e === "entregue") return mudar(atual, { estado: "em_andamento" }, [{ tipo: "reaberta" }]);
      return SEM_MUDANCA;
    case "arquivar":
      if (e === "arquivada") return SEM_MUDANCA;
      return mudar(atual, { estado: "arquivada", estadoAntesDeArquivar: e, arquivadaEm: agora }, [{ tipo: "arquivada", dados: { de: e } }]);
    case "desarquivar":
      return e === "arquivada" ? desarquivar(atual) : SEM_MUDANCA;
  }
}

function desarquivar(atual: LinhaTarefa): ResultadoTransicao {
  const para: Exclude<EstadoTarefa, "arquivada"> = atual.estadoAntesDeArquivar ?? "em_andamento";
  return mudar(atual, { estado: para, estadoAntesDeArquivar: null, arquivadaEm: null }, [{ tipo: "desarquivada", dados: { para } }]);
}

/** O estado inicial de uma Tarefa nova: `em_andamento` quando o primeiro turno nasce junto, senão `nao_iniciada`. */
export function estadoInicialDaTarefa(comPrimeiroTurno: boolean): EstadoTarefa {
  return comPrimeiroTurno ? "em_andamento" : "nao_iniciada";
}

/** A Tarefa aparece na lista padrão (as arquivadas só com o filtro). */
export function tarefaVisivelNaLista(estado: EstadoTarefa, comArquivadas: boolean): boolean {
  return comArquivadas || estado !== "arquivada";
}

/** O texto de produto do estado do objetivo (a lista: "Entregue · precisa de você"). "Entregue" nunca vira "Resolvida". */
export const ROTULO_ESTADO_TAREFA: Record<EstadoTarefa, string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  entregue: "Entregue",
  resolvida: "Resolvida",
  arquivada: "Arquivada",
};

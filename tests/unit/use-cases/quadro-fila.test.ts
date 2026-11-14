import { describe, expect, it } from "vitest";
import type { OpQuadro } from "../../../src/contracts/quadro.ts";
import { soMoveTarefas } from "../../../src/use-cases/gerir-quadro.ts";
import { posicoesNaFila } from "../../../src/use-cases/quadro.ts";

describe("ADA-246: fila do quadro e segunda chamada no mesmo turno", () => {
  it("ordena as cinco tarefas que sobraram na fila e deixa as oito já rodando sem posição", () => {
    const rodando = Array.from({ length: 8 }, (_, i) => `rodando-${i + 1}`);
    const fila = [
      { id: "fila-3", desde: 3_000 },
      { id: "fila-1", desde: 1_000 },
      { id: "fila-5", desde: null },
      { id: "fila-4", desde: 4_000 },
      { id: "fila-2", desde: 2_000 },
    ];

    const posicoes = posicoesNaFila(fila);

    expect(rodando.every((id) => !posicoes.has(id))).toBe(true);
    expect([...posicoes]).toEqual([
      ["fila-1", { n: 1, m: 5 }],
      ["fila-2", { n: 2, m: 5 }],
      ["fila-3", { n: 3, m: 5 }],
      ["fila-4", { n: 4, m: 5 }],
      ["fila-5", { n: 5, m: 5 }],
    ]);
    expect(posicoesNaFila([{ id: "sozinha", desde: 1_000 }])).toEqual(new Map());
  });

  it("a segunda chamada aceita só movimento estreito e recusa escrita, atribuição, cancelamento e exclusão", () => {
    const aceita = (ops: OpQuadro[]) => expect(soMoveTarefas(ops)).toBe(true);
    const recusa = (op: OpQuadro) => expect(soMoveTarefas([op])).toBe(false);

    aceita([{ tipo: "mudar_tarefa", tarefa: "ADA-246", status: "Implementando", prioridade: "alta", sem_iniciar: true, parar_anterior: true }]);
    aceita([{ tipo: "terminei", tarefa: "ADA-246" }]);

    expect(soMoveTarefas([])).toBe(false);
    recusa({ tipo: "mudar_tarefa", tarefa: "ADA-246", descricao: "texto do card" });
    recusa({ tipo: "mudar_tarefa", tarefa: "ADA-246", agente: "Outro bot" });
    recusa({ tipo: "mudar_tarefa", tarefa: "ADA-246", excluir: true });
    recusa({ tipo: "mudar_tarefa", tarefa: "ADA-246", status: "Cancelado" });
    recusa({ tipo: "mudar_tarefa", tarefa: "ADA-246", pergunta: "Pode aprovar?" });
  });
});

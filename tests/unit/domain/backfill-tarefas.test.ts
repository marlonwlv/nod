import { describe, expect, it } from "vitest";
import { decidirBackfill, estadoDoBackfill, estadoDoCardNoBackfill, type TrabalhoParaBackfill } from "../../../src/domain/backfill-tarefas.ts";

const base: TrabalhoParaBackfill = { id: "w1", origem: "pessoa", forma: "frente", estado: "terminado", iniciadoEm: 1, cardId: null, trabalhoMaeId: null, tarefaDaMae: null, tarefaObjetivoId: null };

describe("decidirBackfill (ADR-192, etapa 4)", () => {
  it.each<[string, Partial<TrabalhoParaBackfill>, string]>([
    ["frente da pessoa", {}, "propria"],
    ["frente da rede", { origem: "rede" }, "propria"],
    ["já ligada", { tarefaObjetivoId: "t" }, "fora:ja_ligado"],
    ["do Card", { origem: "quadro", forma: "task", cardId: "c1" }, "card"],
    ["frente do Card", { origem: "quadro", cardId: "c1" }, "card"],
    ["filha com mãe ligada", { trabalhoMaeId: "m", tarefaDaMae: "tm" }, "herda"],
    ["filha com mãe sem Tarefa", { trabalhoMaeId: "m" }, "propria"],
    ["rotina", { origem: "rotina", forma: "task" }, "fora:rotina"],
    ["frente de rotina", { origem: "rotina" }, "fora:rotina"],
    ["colega", { origem: "colega", forma: "task" }, "fora:colega"],
    ["task antiga da pessoa", { forma: "task" }, "fora:task"],
    ["quadro sem Card", { origem: "quadro" }, "fora:sem_regra"],
  ])("%s", (_n, t, esperado) => {
    const d = decidirBackfill({ ...base, ...t });
    expect(d.tipo === "fora" ? `fora:${d.motivo}` : d.tipo).toBe(esperado);
  });

  it("a chave de origem é a do trabalho ou a do Card (nunca o título)", () => {
    expect(decidirBackfill(base)).toEqual({ tipo: "propria", origemChave: "trabalho:w1" });
    expect(decidirBackfill({ ...base, cardId: "c9" })).toEqual({ tipo: "card", origemChave: "card:c9", cardId: "c9" });
  });
});

describe("estado da Tarefa no backfill", () => {
  it.each<[TrabalhoParaBackfill["estado"], number | null, string]>([
    ["terminado", 1, "entregue"],
    ["parado", 1, "em_andamento"],
    ["falhou", 1, "em_andamento"],
    ["rodando", 1, "em_andamento"],
    ["precisa_de_voce", 1, "em_andamento"],
    ["na_fila", null, "nao_iniciada"],
    ["na_fila", 1, "em_andamento"],
  ])("%s (iniciado %s) → %s", (estado, iniciadoEm, esperado) => {
    expect(estadoDoBackfill({ estado, iniciadoEm })).toBe(esperado);
  });

  it("nenhum estado antigo vira resolvida", () => {
    for (const estado of ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso", "terminado", "parado", "falhou"] as const) expect(estadoDoBackfill({ estado, iniciadoEm: 1 })).not.toBe("resolvida");
  });

  it("Card: todos terminados → entregue; algum começou → em andamento; nenhum → não iniciada (a coluna Feito não conta)", () => {
    expect(estadoDoCardNoBackfill([{ estado: "terminado", iniciadoEm: 1 }, { estado: "terminado", iniciadoEm: 1 }])).toBe("entregue");
    expect(estadoDoCardNoBackfill([{ estado: "terminado", iniciadoEm: 1 }, { estado: "rodando", iniciadoEm: 1 }])).toBe("em_andamento");
    expect(estadoDoCardNoBackfill([{ estado: "na_fila", iniciadoEm: null }])).toBe("nao_iniciada");
    expect(estadoDoCardNoBackfill([])).toBe("nao_iniciada");
  });
});

import { describe, expect, it } from "vitest";
import { botDasTarefas, tarefasEmAndamento } from "../../../web/lib/tarefas-da-barra.ts";

describe("linha Tarefas da barra (ADR-167, Paper 02–05)", () => {
  const colunas = [
    { id: "backlog", grupo: "nao_iniciado" }, { id: "afazer", grupo: "nao_iniciado" }, { id: "fazendo", grupo: "iniciado" },
    { id: "revisao", grupo: "iniciado" }, { id: "bloqueado", grupo: "iniciado" }, { id: "feito", grupo: "feito" }, { id: "cancelado", grupo: "fechado" },
  ];
  it("conta só as tarefas das colunas em andamento", () => {
    const tarefas = ["backlog", "afazer", "fazendo", "fazendo", "revisao", "bloqueado", "feito", "cancelado"].map((status) => ({ status }));
    expect(tarefasEmAndamento({ colunas, tarefas })).toBe(4);
  });
  it("sem quadro é zero", () => {
    expect(tarefasEmAndamento(null)).toBe(0);
  });
  it("leva ao bot aberto quando ele tem quadro; senão ao primeiro", () => {
    expect(botDasTarefas("ada", ["chico", "ada"])).toBe("ada");
    expect(botDasTarefas("gil", ["chico", "ada"])).toBe("chico");
    expect(botDasTarefas(null, [])).toBeNull();
  });
});

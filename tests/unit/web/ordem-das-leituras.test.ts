import { describe, expect, it } from "vitest";
import { ordemDasLeituras } from "../../../web/lib/ordem-das-leituras.ts";
import type { Invalidacao } from "../../../web/estado/reducer.ts";

describe("ordemDasLeituras (instantâneo, 2026-11-13)", () => {
  const leituras: Invalidacao[] = ["ias", "uso-plano", "conversa:c1", "concessoes:a1", "trabalhos"];

  it("põe a conversa da tela na frente e mantém a ordem do resto", () => {
    expect(ordemDasLeituras(leituras, { tipo: "conversa", conversaId: "c1" })).toEqual(["conversa:c1", "ias", "uso-plano", "concessoes:a1", "trabalhos"]);
    expect(ordemDasLeituras(leituras, { tipo: "sala", conversaId: "c1" })).toEqual(["conversa:c1", "ias", "uso-plano", "concessoes:a1", "trabalhos"]);
  });

  it("sem a conversa da tela na lista (já lida), nada muda", () => {
    expect(ordemDasLeituras(leituras, { tipo: "conversa", conversaId: "outra" })).toEqual(leituras);
    expect(ordemDasLeituras(leituras, { tipo: "inicio" })).toEqual(leituras);
  });

  it("devolve uma cópia: a lista de entrada fica como estava", () => {
    const copia = [...leituras];
    ordemDasLeituras(leituras, { tipo: "conversa", conversaId: "c1" });
    expect(leituras).toEqual(copia);
  });
});

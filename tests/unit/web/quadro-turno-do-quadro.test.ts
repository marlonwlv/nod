import { describe, expect, it } from "vitest";
import { agentesDoQuadro, turnoDoQuadro } from "../../../web/lib/quadro.ts";

/** Q4 (definido em 2026-11-12): só o turno do quadro relê o quadro; o de qualquer outro bot, não. */
const q = {
  agenteId: "anfitriao",
  tarefas: [{ agenteId: "dev", turnoId: "t-dev" }, { agenteId: null, turnoId: null }],
  colunas: [{ responsavel: "revisor" }, { responsavel: null }],
};

describe("turnoDoQuadro (Q4)", () => {
  it("os bots do quadro: anfitrião, responsável de tarefa e de coluna", () => {
    expect([...agentesDoQuadro(q)].sort()).toEqual(["anfitriao", "dev", "revisor"]);
  });

  it("o começo de um turno de um bot do quadro relê (agente_id do outbox ou agenteId da sala)", () => {
    expect(turnoDoQuadro({ conversaId: "c-x", turnoId: "novo", agente_id: "revisor" }, q, "c-anf", new Set())).toBe(true);
    expect(turnoDoQuadro({ conversaId: "c-x", turnoId: "novo", agenteId: "dev" }, q, "c-anf", new Set())).toBe(true);
  });

  it("o turno de uma tarefa relê mesmo sem o bot no frame (o fim do turno não traz o agente)", () => {
    expect(turnoDoQuadro({ conversaId: "c-x", turnoId: "t-dev" }, q, "c-anf", new Set())).toBe(true);
  });

  it("o fim de um turno que começou num bot do quadro relê (visto no começo)", () => {
    expect(turnoDoQuadro({ conversaId: "c-x", turnoId: "visto" }, q, "c-anf", new Set(["visto"]))).toBe(true);
  });

  it("o turno da conversa do anfitrião relê (a espera de colega não traz o bot)", () => {
    expect(turnoDoQuadro({ conversaId: "c-anf", turnoId: "qualquer" }, q, "c-anf", new Set())).toBe(true);
  });

  it("o turno de um bot de fora do quadro NÃO relê — começo ou fim", () => {
    expect(turnoDoQuadro({ conversaId: "c-outro", turnoId: "t9", agente_id: "outro" }, q, "c-anf", new Set())).toBe(false);
    expect(turnoDoQuadro({ conversaId: "c-outro", turnoId: "t9" }, q, "c-anf", new Set())).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { criarCanalComputador } from "../../../src/adapters/computador/canal.ts";
import type { EstadoComputadorRelatado } from "../../../src/contracts/computador-motor.ts";

/** D (2026-11-12): a foto do supervisor vai ao gancho do stream, e o gancho que falha não derruba o relato. */
describe("canal do computador: estado da máquina no stream", () => {
  const escopo = { tenantId: "t", pessoaId: "p" };
  const relato: EstadoComputadorRelatado = { computadorId: "c1", ligado: true, supervisorPub: "k", telas: [] };

  it("cada foto chama o gancho com a máquina e a pessoa", () => {
    const vistos: [string, string][] = [];
    const canal = criarCanalComputador({ agora: () => 1, aoEstado: (e, m) => { vistos.push([e.pessoaId, m]); } });
    canal.relatarEstado(escopo, "m1", relato);
    expect(vistos).toEqual([["p", "m1"]]);
  });

  it("gancho que lança: a foto fica guardada mesmo assim", () => {
    const canal = criarCanalComputador({ agora: () => 1, aoEstado: () => { throw new Error("x"); } });
    canal.relatarEstado(escopo, "m1", relato);
    expect(canal.foto(escopo, "m1")).toEqual(relato);
  });
});

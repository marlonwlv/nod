import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { verColegas } from "../../../src/use-cases/ver-colegas.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

describe("verColegas", () => {
  it("preserva grafemas no limite da descrição resumida e da instrução inteira", async () => {
    const { deps } = depsEmMemoria();
    const eu = (await criarAgente(deps, { dono: "pessoa", nome: "Vera", titulo: "QA", descricao: "Testa o produto" })).data;
    const colega = (await criarAgente(deps, {
      dono: "pessoa",
      nome: "Ada",
      titulo: "PM",
      descricao: `${"a".repeat(295)}👨‍👩‍👧x`,
    })).data;
    await deps.repos.rotinas.criar({
      agenteId: colega.agente.id,
      conversaId: colega.conversa.id,
      cron: "0 8 * * *",
      fusoIana: "UTC",
      instrucao: `${"b".repeat(1498)}😀x`,
      fonte: "backlog",
      entregavel: "resumo",
      limitesAprovacao: "nada sai sem aprovação",
      politicaSemDado: "silêncio",
      proximaExecucao: 1_700_000_000_000,
    });

    const contexto = { agenteId: eu.agente.id, conversaId: eu.conversa.id, turnoId: "turno-qa" };
    const resumo = await verColegas(deps, contexto);
    const inteiro = await verColegas(deps, { ...contexto, agente: "Ada" });
    if ("erro" in resumo.data || "erro" in inteiro.data) throw new Error("colega ausente");

    expect(resumo.data.colegas[0]?.descricao).toBe(`${"a".repeat(295)}…`);
    expect(inteiro.data.colegas[0]?.rotinas[0]?.instrucao).toBe(`${"b".repeat(1498)}…`);
    expect(JSON.stringify([resumo.data, inteiro.data])).not.toContain("\\ud83d");
  });
});

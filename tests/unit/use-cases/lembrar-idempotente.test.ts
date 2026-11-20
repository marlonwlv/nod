import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { lembrar } from "../../../src/use-cases/lembrar.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

describe("lembrar idempotente", () => {
  it("a repetição exata devolve o id original sem outra memória, mensagem ou evento", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const input = { turnoId: "turno-1", agenteId: criado.agente.id, conversaId: criado.conversa.id, tipo: "fato" as const, texto: "o playbook fica na pasta do QA" };

    const primeira = await executar(deps, lembrar, input);
    const repetida = await executar(deps, lembrar, input);

    expect(repetida.data).toEqual(primeira.data);
    expect(repetida.events).toEqual([]);
    expect(await deps.repos.memorias.listarDoAgente(criado.agente.id)).toHaveLength(1);
    expect((await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.kind === "sistema" && m.texto.includes("o playbook fica na pasta do QA"))).toHaveLength(1);
  });
});

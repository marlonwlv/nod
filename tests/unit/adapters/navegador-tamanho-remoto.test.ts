import { describe, expect, it } from "vitest";
import type { MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { executarOperacao, lerValor } from "../../../src/adapters/navegador/operacoes-remotas.ts";

/** Emenda de 2026-11-20 da ADR-190 (item 4): o tamanho do Chrome do bot também muda na máquina da pessoa, pela fila. */
describe("a operação `tamanho` na máquina", () => {
  const chamadas: unknown[][] = [];
  const motor = new Proxy({} as MotorNavegador, { get: (_t, op: string) => async (...args: unknown[]) => { chamadas.push([op, ...args.slice(1)]); } });

  it("passa inteiros de 320–4096 ao motor local; fora disso, alvo_invalido sem chamar o motor", async () => {
    await executarOperacao(motor, { agenteId: "a" }, "tamanho", [896, 1120]);
    expect(chamadas).toEqual([["tamanho", 896, 1120]]);
    for (const ruim of [[100, 700], [896, 5000], [896.5, 700], ["896", 700], [896]]) {
      await expect(executarOperacao(motor, { agenteId: "a" }, "tamanho", ruim)).rejects.toMatchObject({ motivo: "alvo_invalido" });
    }
    expect(chamadas).toHaveLength(1);
    expect(lerValor("tamanho", { qualquer: 1 })).toBeUndefined();
  });
});

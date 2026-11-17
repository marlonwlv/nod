import { describe, expect, it } from "vitest";
import { lerTetoBastidoresMs } from "../../../src/adapters/fundo/varredor-lease.ts";

describe("NOD-452: configuração do teto dos bastidores", () => {
  it("nasce desligada e aceita inteiro positivo", () => {
    expect(lerTetoBastidoresMs(undefined)).toBeUndefined();
    expect(lerTetoBastidoresMs("0")).toBeUndefined();
    expect(lerTetoBastidoresMs("  ")).toBeUndefined();
    expect(lerTetoBastidoresMs("120000")).toBe(120_000);
  });

  it.each(["-1", "1.5", "abc", "Infinity"])("falha fechado para %s", (valor) => {
    expect(() => lerTetoBastidoresMs(valor)).toThrow("NOD_TETO_BASTIDORES_MS inválido");
  });
});

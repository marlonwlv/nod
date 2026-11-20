import { describe, expect, it } from "vitest";
import { lerTetoBastidoresMs } from "../../../src/adapters/fundo/varredor-lease.ts";
import { metadadosDuracaoBastidores } from "../../../src/adapters/fundo/ponte-interna.ts";
import type { Turno } from "../../../src/contracts/turno.ts";

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

  it("mede a produção com contrato fechado, sem conteúdo nem identificadores", () => {
    const turno = {
      id: "não-pode-vazar",
      entradaTexto: "não-pode-vazar",
      bastidores: true,
      trabalhoId: null,
      despachadoEm: 1_000,
      origem: "rotina",
      estado: "concluido",
    } as Pick<Turno, "id" | "entradaTexto" | "bastidores" | "trabalhoId" | "despachadoEm" | "origem" | "estado">;

    expect(metadadosDuracaoBastidores(turno, 4_000)).toEqual({
      origem: "rotina",
      desfecho: "concluido",
      duracao_ms: 3_000,
    });
    expect(metadadosDuracaoBastidores({ ...turno, bastidores: false }, 4_000)).toBeNull();
    expect(metadadosDuracaoBastidores({ ...turno, trabalhoId: "frente" }, 4_000)).toBeNull();
  });
});

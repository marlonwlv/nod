import { describe, expect, it } from "vitest";
import { comAtrasoDeRetomada } from "../../../src/domain/retomada-escalonada.ts";

const RENOVA_EM = Date.UTC(2026, 10, 26, 9, 32, 43);
const MINUTO = 60_000;

describe("comAtrasoDeRetomada (ADR-198)", () => {
  it("sem atraso configurado (null ou ausente), a hora de acordar não muda", () => {
    expect(comAtrasoDeRetomada(RENOVA_EM, null)).toBe(RENOVA_EM);
    expect(comAtrasoDeRetomada(RENOVA_EM, undefined)).toBe(RENOVA_EM);
  });

  it("atraso configurado soma minutos à hora de acordar", () => {
    expect(comAtrasoDeRetomada(RENOVA_EM, 5)).toBe(RENOVA_EM + 5 * MINUTO);
    expect(comAtrasoDeRetomada(RENOVA_EM, 25)).toBe(RENOVA_EM + 25 * MINUTO);
  });

  it("atraso explícito 0 (ex.: Gilda +0) não é o mesmo que null, mas dá a mesma hora", () => {
    expect(comAtrasoDeRetomada(RENOVA_EM, 0)).toBe(RENOVA_EM);
  });
});

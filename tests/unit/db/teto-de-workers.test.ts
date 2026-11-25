import { describe, expect, it } from "vitest";
import { tetoDeWorkers } from "../../setup/teto-de-workers.ts";

describe("tetoDeWorkers", () => {
  it("sem pedido, vale o teto da máquina: 8, nunca acima de núcleos − 1", () => {
    expect(tetoDeWorkers(12, undefined)).toBe(8);
    expect(tetoDeWorkers(8, undefined)).toBe(7);
    expect(tetoDeWorkers(2, undefined)).toBe(1);
    expect(tetoDeWorkers(1, undefined)).toBe(1);
  });

  it("o pedido do ambiente abaixa o teto", () => {
    expect(tetoDeWorkers(8, "3")).toBe(3);
    expect(tetoDeWorkers(12, " 2 ")).toBe(2);
    expect(tetoDeWorkers(8, "1")).toBe(1);
  });

  it("o pedido nunca sobe o teto da máquina", () => {
    expect(tetoDeWorkers(8, "32")).toBe(7);
    expect(tetoDeWorkers(2, "4")).toBe(1);
  });

  it("pedido inválido é ignorado, não derruba a suíte", () => {
    for (const ruim of ["", "0", "-2", "tres", "2.5", "3x"]) expect(tetoDeWorkers(8, ruim)).toBe(7);
  });
});

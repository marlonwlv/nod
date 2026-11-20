import { describe, expect, it } from "vitest";
import { criarGuardaDeMotores, MOTOR_GUARDADO_MS } from "../../../web/lib/motores-do-mascote.ts";

/** C3 (definido em 2026-11-12): o elemento recriado com a mesma chave retoma o motor (não volta ao repouso). */
describe("guarda de motores do mascote (C3)", () => {
  const motor = { estado: "orbit" };
  it("quem entra logo depois com a mesma chave retoma o motor, o tempo e a pose; só uma vez", () => {
    let t = 0;
    const g = criarGuardaDeMotores<typeof motor>(() => t);
    g.guardar("bot-1:sm", { motor, tempo: 4200, aplicado: "orbit|shape-hex|", mudou: 3000 });
    t = 5;
    expect(g.retomar("bot-1:sm")).toEqual({ motor, tempo: 4200, aplicado: "orbit|shape-hex|", mudou: 3000 });
    expect(g.retomar("bot-1:sm")).toBeNull();
  });
  it("outra chave (outro bot ou outro tamanho) não retoma; sem chave nada é guardado", () => {
    const g = criarGuardaDeMotores<typeof motor>(() => 0);
    g.guardar("bot-1:sm", { motor, tempo: 1, aplicado: "", mudou: 0 });
    expect(g.retomar("bot-2:sm")).toBeNull();
    expect(g.retomar("bot-1:lg")).toBeNull();
    g.guardar(null, { motor, tempo: 1, aplicado: "", mudou: 0 });
    expect(g.tamanho()).toBe(1);
  });
  it("o guardado velho (o elemento que saiu de vez) vence e não é retomado nem fica na memória", () => {
    let t = 0;
    const g = criarGuardaDeMotores<typeof motor>(() => t);
    g.guardar("bot-1:sm", { motor, tempo: 1, aplicado: "", mudou: 0 });
    t = MOTOR_GUARDADO_MS;
    expect(g.retomar("bot-1:sm")).toBeNull();
    g.guardar("bot-1:sm", { motor, tempo: 1, aplicado: "", mudou: 0 });
    t = MOTOR_GUARDADO_MS * 3;
    g.guardar("bot-2:sm", { motor, tempo: 1, aplicado: "", mudou: 0 });
    expect(g.tamanho()).toBe(1);
  });
});

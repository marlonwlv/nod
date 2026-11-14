import { describe, expect, it } from "vitest";
import { criarLeiturasEmVoo } from "../../../web/lib/leituras-em-voo.ts";

function controlada(): { p: Promise<void>; resolver: () => void; rejeitar: (e: unknown) => void } {
  let resolver!: () => void;
  let rejeitar!: (e: unknown) => void;
  const p = new Promise<void>((res, rej) => { resolver = res; rejeitar = rej; });
  return { p, resolver, rejeitar };
}
const tique = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("leituras em voo (ADR-181)", () => {
  it("a mesma chave em voo devolve a mesma promessa e lê uma vez só", async () => {
    const l = criarLeiturasEmVoo<string>(6);
    let lidas = 0;
    const c = controlada();
    const a = l.correr("conversa:1", async () => { lidas++; await c.p; });
    const b = l.correr("conversa:1", async () => { lidas++; });
    expect(a).toBe(b);
    expect(l.emVoo("conversa:1")).toBe(true);
    c.resolver();
    await a;
    expect(lidas).toBe(1);
    expect(l.emVoo("conversa:1")).toBe(false);
    expect(l.tamanho()).toBe(0);
  });

  it("respeita o teto: a 7ª espera uma vaga e sai na ordem", async () => {
    const l = criarLeiturasEmVoo<string>(2);
    const ordem: string[] = [];
    const c1 = controlada(); const c2 = controlada(); const c3 = controlada();
    const p1 = l.correr("a", async () => { ordem.push("a"); await c1.p; });
    const p2 = l.correr("b", async () => { ordem.push("b"); await c2.p; });
    const p3 = l.correr("c", async () => { ordem.push("c"); await c3.p; });
    await tique();
    expect(ordem).toEqual(["a", "b"]);
    expect(l.lendo()).toBe(2);
    expect(l.tamanho()).toBe(3);
    expect(l.emVoo("c")).toBe(true);
    c1.resolver();
    await p1;
    await tique();
    expect(ordem).toEqual(["a", "b", "c"]);
    c2.resolver(); c3.resolver();
    await Promise.all([p2, p3]);
    expect(l.tamanho()).toBe(0);
    expect(l.lendo()).toBe(0);
  });

  it("a leitura que rejeita libera a vaga e a chave, e rejeita para quem esperava", async () => {
    const l = criarLeiturasEmVoo<string>(1);
    const c = controlada();
    const p = l.correr("x", async () => { await c.p; });
    const mesma = l.correr("x", async () => undefined);
    c.rejeitar(new Error("caiu"));
    await expect(p).rejects.toThrow("caiu");
    await expect(mesma).rejects.toThrow("caiu");
    expect(l.emVoo("x")).toBe(false);
    await l.correr("y", async () => undefined);
    expect(l.lendo()).toBe(0);
  });

  it("teto inválido é recusado", () => {
    expect(() => criarLeiturasEmVoo(0)).toThrow(RangeError);
  });
});

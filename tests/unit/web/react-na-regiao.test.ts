import { describe, expect, it } from "vitest";
import { chaveGuardada, reactNaRegiao } from "../../../web/lib/react-na-regiao.ts";

/** ADR-189: a barra e a conversa vão pelo React por padrão; `?<nome>-react=0` é o caminho de volta, guardado no navegador. */
function guardado(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("chave das regiões desenhadas pelo React (ADR-189)", () => {
  it("ligada por padrão", () => {
    expect(reactNaRegiao("barra", "https://nod.test/", guardado())).toBe(true);
    expect(reactNaRegiao("conversa", "https://nod.test/", null)).toBe(true);
  });

  it("?barra-react=0 desliga e fica guardado; ?barra-react=1 liga de novo", () => {
    const g = guardado();
    expect(reactNaRegiao("barra", "https://nod.test/?barra-react=0", g)).toBe(false);
    expect(g.m.get(chaveGuardada("barra"))).toBe("0");
    expect(reactNaRegiao("barra", "https://nod.test/", g)).toBe(false);
    // Uma região não desliga a outra.
    expect(reactNaRegiao("conversa", "https://nod.test/", g)).toBe(true);
    expect(reactNaRegiao("barra", "https://nod.test/?barra-react=1", g)).toBe(true);
    expect(g.m.has(chaveGuardada("barra"))).toBe(false);
  });

  it("localStorage bloqueado: só a URL decide", () => {
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } };
    expect(reactNaRegiao("conversa", "https://nod.test/", quebrado)).toBe(true);
    expect(reactNaRegiao("conversa", "https://nod.test/?conversa-react=0", quebrado)).toBe(false);
  });
});

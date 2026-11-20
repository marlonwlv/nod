import { describe, expect, it } from "vitest";
import { CHAVE_REACT_NO_QUADRO, reactNoQuadro } from "../../../web/lib/react-no-quadro.ts";

/** ADR-180: a chave da grade do quadro em React — desligada por padrão, liga e desliga pela URL e fica guardada. */
function guardado(): Storage & { mapa: Map<string, string> } {
  const mapa = new Map<string, string>();
  return { mapa, getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v), removeItem: (k: string) => void mapa.delete(k) } as never;
}

describe("reactNoQuadro", () => {
  it("desligada por padrão", () => {
    expect(reactNoQuadro("https://nod.test/", guardado())).toBe(false);
  });
  it("?quadro-react=1 liga e guarda; depois vale sem a URL; ?quadro-react=0 desliga", () => {
    const g = guardado();
    expect(reactNoQuadro("https://nod.test/?quadro-react=1", g)).toBe(true);
    expect(g.mapa.get(CHAVE_REACT_NO_QUADRO)).toBe("1");
    expect(reactNoQuadro("https://nod.test/", g)).toBe(true);
    expect(reactNoQuadro("https://nod.test/?quadro-react=0", g)).toBe(false);
    expect(reactNoQuadro("https://nod.test/", g)).toBe(false);
  });
  it("sem localStorage (bloqueado), só a URL decide", () => {
    const quebrado = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => undefined };
    expect(reactNoQuadro("https://nod.test/?quadro-react=1", quebrado)).toBe(true);
    expect(reactNoQuadro("https://nod.test/", quebrado)).toBe(false);
    expect(reactNoQuadro("nada", null)).toBe(false);
  });
});

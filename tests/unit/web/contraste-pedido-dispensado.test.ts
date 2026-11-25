import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression: QA r176 — no tema claro, o "· você seguiu sem conectar" da linha cinza (ADR-191) era #1c1c1c a 50 % sobre o
// #FAFAFA: 3,26:1 medido no Chrome, abaixo dos 4,5:1 do WCAG AA para texto de 13 px.
const tokens = readFileSync(new URL("../../../web/tokens.css", import.meta.url), "utf8");

function hex(nome: string): string {
  const m = tokens.match(new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{6,8})`));
  if (!m?.[1]) throw new Error(`token ${nome} não achado`);
  return m[1];
}

function rgba(h: string): [number, number, number, number] {
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), h.length > 7 ? n(7) / 255 : 1];
}

function luminancia([r, g, b]: number[]): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
}

describe("linha do pedido dispensado: contraste do sufixo no tema claro (QA r176)", () => {
  it("o '· você seguiu…' passa de 4,5:1 sobre o fundo da linha", () => {
    const [fr, fg, fb, a] = rgba(hex("--pedido-dispensado-sufixo"));
    const fundo = rgba(hex("--pedido-dispensado-fundo"));
    const cor = [fr, fg, fb].map((v, i) => v * a + (fundo[i] ?? 255) * (1 - a));
    const l1 = luminancia(cor);
    const l2 = luminancia(fundo);
    expect((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

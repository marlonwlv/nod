import { describe, expect, it } from "vitest";
import { bordasDaLista, MARGEM_NA_VISTA, rolagemDaBarra } from "../../../web/lib/rolagem-barra.ts";

describe("rolagem da barra lateral refeita", () => {
  it("sem conversa nova a lista fica onde estava (turno rodando, mensagem chegando, soltar um bot)", () => {
    expect(rolagemDaBarra({ anterior: 640, altura: 500, linha: null })).toBe(640);
  });

  it("clicar num bot já à vista no fim da lista não mexe na rolagem", () => {
    expect(rolagemDaBarra({ anterior: 640, altura: 500, linha: { topo: 1060, base: 1120 } })).toBe(640);
  });

  it("conversa aberta abaixo da vista: desce o mínimo para a linha aparecer inteira, com folga", () => {
    expect(rolagemDaBarra({ anterior: 0, altura: 500, linha: { topo: 900, base: 960 } })).toBe(960 - 500 + MARGEM_NA_VISTA);
  });

  it("conversa aberta acima da vista: sobe até a linha, com folga, sem passar do topo", () => {
    expect(rolagemDaBarra({ anterior: 800, altura: 500, linha: { topo: 300, base: 360 } })).toBe(300 - MARGEM_NA_VISTA);
    expect(rolagemDaBarra({ anterior: 800, altura: 500, linha: { topo: 2, base: 60 } })).toBe(0);
  });

  it("lista sem altura (escondida, ainda sem layout) não inventa posição", () => {
    expect(rolagemDaBarra({ anterior: 120, altura: 0, linha: { topo: 900, base: 960 } })).toBe(120);
  });
});

describe("COP-12: o fade só na borda que esconde conteúdo (bordasDaLista)", () => {
  it("tudo cabe: nenhuma borda dissolve (os fixados no topo aparecem inteiros)", () => {
    expect(bordasDaLista({ rolagem: 0, altura: 500, total: 500 })).toEqual({ topo: false, base: false });
    expect(bordasDaLista({ rolagem: 0, altura: 500, total: 300 })).toEqual({ topo: false, base: false });
  });

  it("no topo de uma lista longa só a base dissolve; no meio, as duas; no fim, só o topo", () => {
    expect(bordasDaLista({ rolagem: 0, altura: 500, total: 1200 })).toEqual({ topo: false, base: true });
    expect(bordasDaLista({ rolagem: 300, altura: 500, total: 1200 })).toEqual({ topo: true, base: true });
    expect(bordasDaLista({ rolagem: 700, altura: 500, total: 1200 })).toEqual({ topo: true, base: false });
  });

  it("o scrollTop fracionário do zoom não deixa um fade de sobra na ponta", () => {
    expect(bordasDaLista({ rolagem: 0.5, altura: 500, total: 1200 })).toEqual({ topo: false, base: true });
    expect(bordasDaLista({ rolagem: 699.5, altura: 500, total: 1200 })).toEqual({ topo: true, base: false });
  });

  it("lista sem altura (escondida, ainda sem layout) não marca nada", () => {
    expect(bordasDaLista({ rolagem: 0, altura: 0, total: 1200 })).toEqual({ topo: false, base: false });
  });
});

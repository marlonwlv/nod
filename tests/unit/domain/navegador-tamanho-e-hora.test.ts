import { describe, expect, it } from "vitest";
import { comandosDaEntrada, lerEntradaNavegador } from "../../../src/domain/navegador-entrada.ts";
import { cartaoDaPergunta, horaNoFuso, macCostumaEstarDesligado, textoDaHora } from "../../../src/domain/navegador-lugar.ts";
import { VIEWPORT_ALTURA_MAX, viewportDeQuemAssiste, viewportMudouMuito } from "../../../src/domain/navegador-vista.ts";

describe("o Chrome do bot acompanha quem assiste (emenda de 2026-11-20 da ADR-190)", () => {
  it("largura = clamp(round(w × 1,6), 800, 1440) e altura na proporção da área, até 2400", () => {
    expect(viewportDeQuemAssiste({ w: 560, h: 700 })).toEqual({ w: 896, h: 1120 });
    // Celular: a área de 390 px vira o piso de 800 (o layout de computador), na proporção da folha.
    expect(viewportDeQuemAssiste({ w: 390, h: 300 })).toEqual({ w: 640, h: 492 });
    expect(viewportDeQuemAssiste({ w: 300, h: 600 })).toEqual({ w: 640, h: 1280 });
    // Tela cheia larga: o teto de 1440.
    expect(viewportDeQuemAssiste({ w: 1400, h: 800 })).toEqual({ w: 1440, h: 823 });
    // Muito alta: a altura para em 2400.
    expect(viewportDeQuemAssiste({ w: 300, h: 2000 }).h).toBe(VIEWPORT_ALTURA_MAX);
  });

  it("só muda com mais de 4% de diferença em algum lado", () => {
    expect(viewportMudouMuito({ w: 896, h: 1120 }, { w: 900, h: 1150 })).toBe(false);
    // A faixa cinza de ~6% que sobrava embaixo da imagem (revisão lado a lado de 2026-11-20) agora muda o Chrome.
    expect(viewportMudouMuito({ w: 800, h: 1000 }, { w: 800, h: 1060 })).toBe(true);
    expect(viewportMudouMuito({ w: 1280, h: 720 }, { w: 896, h: 1120 })).toBe(true);
    expect(viewportMudouMuito({ w: 1000, h: 1000 }, { w: 1000, h: 1090 })).toBe(true);
  });

  it("a entrada `tamanho` é conferida (120–8192, só w e h) e não vira comando do Chrome", () => {
    const vp = { w: 1280, h: 720 };
    expect(lerEntradaNavegador({ t: "tamanho", w: 560.6, h: 700 }, vp)).toEqual({ t: "tamanho", w: 561, h: 700 });
    for (const ruim of [{ t: "tamanho", w: 119, h: 700 }, { t: "tamanho", w: 560, h: 9000 }, { t: "tamanho", w: 560 }, { t: "tamanho", w: 560, h: 700, x: 1 }, { t: "tamanho", w: Number.NaN, h: 700 }]) {
      expect(lerEntradaNavegador(ruim, vp)).toBeNull();
    }
    expect(comandosDaEntrada({ t: "tamanho", w: 560, h: 700 })).toEqual([]);
  });
});

describe("a hora em que o Mac costuma estar desligado (M2/J1)", () => {
  it("sem histórico, fora de 8h–20h", () => {
    expect([0, 3, 7, 20, 23].map(macCostumaEstarDesligado)).toEqual([true, true, true, true, true]);
    expect([8, 12, 19].map(macCostumaEstarDesligado)).toEqual([false, false, false]);
  });

  it("a hora no fuso da rotina e o texto do cartão", () => {
    // 2026-11-20 06:00 UTC = 03:00 em São Paulo.
    expect(horaNoFuso(Date.UTC(2026, 10, 20, 6, 0), "America/Sao_Paulo")).toEqual({ h: 3, m: 0 });
    expect(horaNoFuso(Date.UTC(2026, 10, 20, 6, 0), "fuso/invalido")).toEqual({ h: 3, m: 0 });
    expect(textoDaHora({ h: 3, m: 0 })).toBe("Às 3h");
    expect(textoDaHora({ h: 1, m: 0 })).toBe("À 1h");
    expect(textoDaHora({ h: 22, m: 30 })).toBe("Às 22h30");
    expect(cartaoDaPergunta("Às 3h", "seu Mac", "A Ada")).toEqual({
      titulo: "Às 3h seu Mac costuma estar desligado",
      texto: "Para essa rotina rodar, a Ada precisa continuar com ele desligado.",
      sim: "Continuar com o Mac desligado",
      nao: "Só com o Mac ligado",
    });
    expect(cartaoDaPergunta("Às 3h", "seu PC", "Ada").sim).toBe("Continuar com o PC desligado");
  });
});

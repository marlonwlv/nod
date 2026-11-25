import { describe, expect, it } from "vitest";
import { cortarComReticencias } from "../../../src/domain/cortar-grafema.ts";
import { tituloDaRotina as daMiniAgenda } from "../../../src/domain/mini-agenda.ts";
import { tituloDaRotina as doQuadro } from "../../../src/domain/quadro-assumir.ts";
import { tituloDaRotina as daWeb } from "../../../web/lib/agenda.ts";

const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FAMILIA = "👨‍👩‍👧";

describe("QA-103: título de rotina cortado por grafema", () => {
  it("cortarComReticencias nunca deixa surrogate nem ZWJ solto e respeita o teto UTF-16", () => {
    for (let pad = 0; pad < 12; pad++) {
      const texto = `${"a".repeat(30 + pad)} ${FAMILIA} 🇧🇷 fim da instrução`;
      const t = cortarComReticencias(texto, 40);
      expect(t.length, texto).toBeLessThanOrEqual(40);
      expect(t).not.toMatch(SURROGATE_SOLTO);
      expect(t).not.toMatch(/‍…$/);
      expect(t.endsWith("…")).toBe(true);
    }
    expect(cortarComReticencias("curto", 40)).toBe("curto");
  });

  it("ver_agenda, o card do quadro e a agenda da web não partem o emoji no limite", () => {
    const base = "Resumo diário do time de produto e QA 👨‍👩‍👧 sem atraso";
    for (let pad = 0; pad < 50; pad++) {
      const instrucao = "x".repeat(pad) + base;
      for (const [nome, t, max] of [["mini-agenda", daMiniAgenda(instrucao), 40], ["quadro", doQuadro("y".repeat(40) + instrucao), 80], ["web", daWeb("z".repeat(8) + instrucao), 48]] as const) {
        expect(t, `${nome} pad ${pad}`).not.toMatch(SURROGATE_SOLTO);
        expect(t.length, `${nome} pad ${pad}`).toBeLessThanOrEqual(max);
      }
    }
    expect(daMiniAgenda("Resumo diário do time de produto e QA 👨‍👩‍👧 sem atraso")).toBe("Resumo diário do time de produto e QA…");
  });
});

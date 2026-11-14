import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlDoVazio } from "../../../web/lib/canvas-html.ts";

// Regression: ISSUE-001 — o × do balão do canvas ficava em cima do fim da pergunta (e do chip)
// Found by /qa on 2026-11-11
// Report: qa/shots/qa-final (QA final do #677)
const css = readFileSync(new URL("../../../web/canvas.css", import.meta.url), "utf8");
const px = (re: RegExp): number => Number(css.match(re)?.[1] ?? Number.NaN);

describe("QA final do #677: balão e página vazia do Canvas", () => {
  it("a linha da pergunta reserva o lugar do ×: o texto e o chip não passam por baixo dele", () => {
    // O × é absoluto no canto (right + largura); a pergunta, alinhada à direita, termina no padding do balão + o recuo dela.
    const xDireita = px(/\.cv-bal-x \{[^}]*right: (\d+)px/);
    const xLargura = px(/\.cv-aviso-x \{[^}]*width: (\d+)px/);
    const balPadding = px(/\.cv-bal \{[^}]*padding: \d+px (\d+)px/);
    const recuo = px(/\.cv-bal-voce \{[^}]*padding-right: (\d+)px/);
    expect(balPadding + recuo).toBeGreaterThanOrEqual(xDireita + xLargura + 4);
  });

  it("J1-3: a página Canvas vazia diz \"Nenhum canvas ainda.\", como no protótipo", () => {
    expect(htmlDoVazio()).toContain("<p>Nenhum canvas ainda.</p>");
    expect(htmlDoVazio()).toContain("Peça aqui embaixo ou na conversa.");
  });
});

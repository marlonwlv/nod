import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A legenda da pílula do cabeçalho (`.pilula-sub`, o modo do bot) aparece no hover (quadro.css). O cabeçalho é uma coluna
 * centrada (interface.css): com a legenda no fluxo, a pílula subia 10 px a cada passada do mouse e a legenda saía
 * cortada. Ela flutua embaixo da pílula, fora do fluxo, e não rouba o clique de quem está embaixo.
 */
const casca = readFileSync(new URL("../../../web/casca.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("a legenda da pílula do cabeçalho não mexe na pílula", () => {
  it("fica fora do fluxo, embaixo da pílula e sem pegar o ponteiro", () => {
    const regra = /\.stage > \.cabecalho-pilula > \.pilula-sub\s*\{([^}]*)\}/.exec(casca)?.[1] ?? "";
    expect(regra).toMatch(/position:\s*absolute/);
    expect(regra).toMatch(/top:\s*calc\(50% \+ 24px\)/);
    expect(regra).toMatch(/margin-top:\s*0/);
    expect(regra).toMatch(/pointer-events:\s*none/);
  });

  it("a regra que a esconde no cabeçalho continua lá (o hover do quadro é que a mostra)", () => {
    expect(casca).toMatch(/\.cabecalho-pilula :is\([^)]*\.pilula-sub[^)]*\)\s*\{\s*display:\s*none;/);
  });
});

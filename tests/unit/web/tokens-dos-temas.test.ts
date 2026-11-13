import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * COP-12 (item 3, tema escuro fiel): o sistema é uma tinta só com alfa sobre três fundos. Claro: #1c1c1c sobre
 * #fcfcfc / #f5f5f5 / #ffffff; escuro: #f5f5f5 sobre #121212 / #0e0e0e / #1f1f1f. Este teste lê web/tokens.css e
 * confere os valores das variáveis principais nos dois temas, e que os dois blocos do escuro (sistema e escolha
 * manual) dizem o mesmo. No escuro nenhuma sombra, menos a do campo de mensagem.
 */
const TOKENS = readFileSync(new URL("../../../web/tokens.css", import.meta.url), "utf8");
const mapa = (texto: string): Record<string, string> => Object.fromEntries([...texto.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
const bloco = (inicio: string): Record<string, string> => {
  const i = TOKENS.indexOf(inicio);
  expect(i).toBeGreaterThan(-1);
  return mapa(TOKENS.slice(i, TOKENS.indexOf("}", i)));
};
const CLARO = bloco(":root {");
const ESCURO_SISTEMA = bloco(':root:not([data-theme="light"])');
const ESCURO_ESCOLHA = bloco(':root[data-theme="dark"]');

const CAMPO = "0 2px 8px -1px #0000000d, 0 1px 2px 0 #00000008, 0 0 0 1px #e4e4e40a";

/** nome → [claro, escuro] */
const ESPERADO: Record<string, readonly [string, string]> = {
  // Superfícies
  "--surface": ["#fcfcfc", "#121212"],
  "--surface-side": ["#f5f5f5", "#0e0e0e"],
  "--surface-elevated": ["#ffffff", "#1f1f1f"],
  "--surface-chrome": ["#ffffff", "#161616"],
  "--surface-dialogo-cfg": ["#fcfcfc", "#121212"],
  "--surface-criar-bot": ["#ffffff", "#1f1f1f"],
  "--menu-realce": ["#f1f1f1", "#2c2c2c"],
  "--menu-submenu-aberto": ["#f6f6f6", "#262626"],
  "--ativo": ["#1c1c1c14", "#f5f5f514"],
  "--hover": ["#1c1c1c0f", "#f5f5f50f"],
  "--balao-pessoa-tinta": ["#ffffff", "#f5f5f5"],
  "--balao-bot": ["#1c1c1c0f", "#f5f5f50a"],
  "--balao-bot-tinta": ["#1c1c1c", "#f5f5f5"],
  "--codigo-inline-fundo": ["#1c1c1c0a", "#f5f5f505"],
  "--codigo-inline-tinta": ["#1c1c1cad", "#f5f5f5a8"],
  "--scrim": ["#00000080", "#000000b2"],
  "--veu-modal": ["#00000080", "#000000b2"],
  // Texto e ícones
  "--ink": ["#1c1c1c", "#f5f5f5"],
  "--ink-2": ["#1c1c1cad", "#f5f5f5a8"],
  "--ink-3": ["#1c1c1c8f", "#f5f5f58a"],
  "--ink-4": ["#1c1c1c66", "#f5f5f561"],
  "--icone-1": ["#1c1c1ceb", "#f5f5f5e6"],
  "--icone-2": ["#1c1c1ca8", "#f5f5f5a3"],
  "--icone-3": ["#1c1c1c85", "#f5f5f580"],
  "--link": ["#0b6dd3", "#4d9bff"],
  "--acento": ["#1680f3", "#116dd2"],
  "--acento-hover": ["#126fd4", "#1784fb"],
  // Bordas 1 a 4, campo e separador de menu
  "--borda-forte": ["#1c1c1c3d", "#f5f5f538"],
  "--borda": ["#1c1c1c1f", "#f5f5f51a"],
  "--borda-sutil": ["#1c1c1c14", "#f5f5f50f"],
  "--divisoria": ["#1c1c1c0f", "#f5f5f50a"],
  "--campo-borda": ["#1c1c1c29", "#f5f5f524"],
  "--campo-borda-foco": ["#1c1c1c3d", "#f5f5f538"],
  "--separador-menu": ["#1c1c1c1f", "#f5f5f51a"],
  // Sombras: no escuro todas zeram, menos a do campo
  "--sombra-menu": ["0 10px 20px -3px #1c1c1c1a, 0 4px 6px -4px #1c1c1c1a, 0 0 0 1px #1c1c1c01", "none"],
  "--sombra-pilula": ["0 4px 12px -1px #1c1c1c14, 0 2px 4px -2px #1c1c1c0f, 0 0 0 1px #1c1c1c01", "none"],
  "--sombra-modal": ["0 20px 32px -5px #1c1c1c1a, 0 8px 12px -6px #1c1c1c1a, 0 0 0 1px #1c1c1c01", "none"],
  "--sombra-campo": [CAMPO, CAMPO],
  "--brilho-balao": ["inset 0 .5px 0 #ffffff29, inset 0 -.5px 0 #ffffff29, inset 0 0 0 .5px #1c1c1c0f", "inset 0 .5px 0 #ffffff08, inset 0 -.5px 0 #ffffff08, inset 0 0 0 .5px #f5f5f50a"],
  // O avatar de bot preto inverte no escuro
  "--mascote-preto": ["#0a0a0c", "#f5f5f5"],
  "--mascote-preto-olho": ["#ffffff", "#121212"],
};

describe("COP-12: os tokens de cor nos dois temas", () => {
  for (const [nome, [claro, escuro]] of Object.entries(ESPERADO)) {
    it(`${nome}: ${claro} no claro e ${escuro} nos dois blocos do escuro`, () => {
      expect(CLARO[nome]).toBe(claro);
      expect(ESCURO_SISTEMA[nome]).toBe(escuro);
      expect(ESCURO_ESCOLHA[nome]).toBe(escuro);
    });
  }

  it("o balão da pessoa é a tinta no claro e #f5f5f52e achatado sobre o chat no escuro", () => {
    expect(CLARO["--balao-pessoa"]).toBe("#1c1c1c");
    // #f5f5f5 a 0x2e/255 sobre #121212: 18 + (245 − 18) × 46/255 ≈ 59 = 0x3b.
    const canal = Math.round(0x12 + (0xf5 - 0x12) * (0x2e / 255));
    const achatado = `#${canal.toString(16).repeat(3)}`;
    expect(ESCURO_SISTEMA["--balao-pessoa"]).toBe(achatado);
    expect(ESCURO_ESCOLHA["--balao-pessoa"]).toBe(achatado);
  });

  it("no escuro nenhuma sombra, menos a do campo de mensagem", () => {
    for (const escuro of [ESCURO_SISTEMA, ESCURO_ESCOLHA]) {
      const sombras = Object.entries(escuro).filter(([nome]) => /^--(sombra|shadow)-/.test(nome));
      expect(sombras.length).toBeGreaterThan(5);
      for (const [nome, valor] of sombras) {
        if (nome === "--sombra-campo" || nome === "--shadow-composer") continue;
        expect(`${nome} ${valor}`).toBe(`${nome} none`);
      }
      expect(escuro["--shadow-composer"]).toBe("var(--sombra-campo)");
    }
  });

  it("os dois blocos do escuro têm os mesmos valores", () => {
    expect(ESCURO_SISTEMA).toEqual(ESCURO_ESCOLHA);
  });
});

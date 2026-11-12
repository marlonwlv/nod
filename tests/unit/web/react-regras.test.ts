import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-179: regras da migração para React travadas pelo código, para valerem em toda região que entrar.
 * - Componente React não usa data-act (o clique é prop; a delegação do main.ts é do mundo por string).
 * - CSS de componente React só com var(--…): sem cor literal (a mesma régua de cores-por-token.test.ts) e sem Tailwind.
 * - Nada fora de web/react importa o componente de exemplo: ele não vai para a tela em produção.
 */
const RAIZ = fileURLToPath(new URL("../../../web/", import.meta.url));
const REACT = join(RAIZ, "react");
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

function arquivos(dir: string, filtro: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const caminho = join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" || d.name === "vendor" ? [] : arquivos(caminho, filtro);
    return filtro.test(d.name) ? [caminho] : [];
  });
}

describe("regras do React (ADR-179)", () => {
  it("nenhum .tsx usa data-act", () => {
    const com = arquivos(RAIZ, /\.tsx$/).filter((f) => /data-act\s*=|["'`]data-act|dataset\.act/.test(readFileSync(f, "utf8")));
    expect(com).toEqual([]);
  });

  it("CSS dos componentes React sem cor literal fora de linha cor-fixa e sem @tailwind/@apply", () => {
    const css = arquivos(REACT, /\.css$/);
    expect(css.length).toBeGreaterThan(0);
    const soltas = css.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(({ linha }) => (LITERAL.test(linha) && !linha.includes("cor-fixa:")) || /@tailwind|@apply/.test(linha))
        .map(({ linha, n }) => `${f}:${n} ${linha.trim().slice(0, 120)}`),
    );
    expect(soltas).toEqual([]);
  });

  it("o componente de exemplo não é importado pelo app", () => {
    const fora = arquivos(RAIZ, /\.(ts|tsx)$/).filter((f) => !f.startsWith(join(REACT, "exemplo")) && /exemplo-da-loja/.test(readFileSync(f, "utf8")));
    expect(fora).toEqual([]);
  });
});

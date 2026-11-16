import { readFileSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "../../..");
const REGRAS_CONTEXTO = readFileSync(join(RAIZ, ".dockerignore"), "utf8")
  .split("\n")
  .map((linha) => linha.trim())
  .filter((linha) => linha !== "" && !linha.startsWith("#"));

function excluidoDoContexto(caminho: string, regras: string[]): boolean {
  const partes = caminho.split("/");
  const caminhos = partes.map((_, i) => partes.slice(0, i + 1).join("/"));
  let excluido = false;
  for (const regra of regras) {
    const negada = regra.startsWith("!");
    const padrao = (negada ? regra.slice(1) : regra).replace(/^\/+|\/+$/g, "");
    if (caminhos.some((trecho) => matchesGlob(trecho, padrao))) excluido = !negada;
  }
  return excluido;
}

describe("imagem de produção", () => {
  it("mantém no contexto os módulos importados pelo typecheck do build", () => {
    const dockerfile = readFileSync(join(RAIZ, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/COPY \. \.\s+RUN npm run build/);
    const config = ts.readConfigFile(join(RAIZ, "tsconfig.server.json"), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const projeto = ts.parseJsonConfigFileContent(config.config, ts.sys, RAIZ);
    expect(projeto.errors).toEqual([]);
    const programa = ts.createProgram(projeto.fileNames, projeto.options);
    const fontes = programa.getSourceFiles()
      .map((fonte) => relative(RAIZ, fonte.fileName).replaceAll("\\", "/"))
      .filter((arquivo) => !arquivo.startsWith("../") && !arquivo.startsWith("node_modules/"));

    // O grafo do compilador inclui os imports transitivos, mesmo fora do include do tsconfig.
    expect(fontes).toContain("site/worker.ts");
    expect(fontes.filter((arquivo) => excluidoDoContexto(arquivo, REGRAS_CONTEXTO))).toEqual([]);
  // medido em 2026-11-16: carregar o grafo do tsconfig.server levou 8,1 s na VM compartilhada.
  }, 30_000);

  it.each(["site", "site/", "/site", "site/*", "site/worker.ts", "**/worker.ts"])(
    "detecta a exclusão %s de uma dependência transitiva",
    (regra) => {
      expect(excluidoDoContexto("site/worker.ts", [regra])).toBe(true);
    },
  );

  it("respeita as reinclusões e mantém as dependências instaladas fora do contexto", () => {
    expect(excluidoDoContexto("site/worker.ts", ["site/*", "!site/worker.ts"])).toBe(false);
    expect(excluidoDoContexto("node_modules/typescript/lib/typescript.d.ts", ["node_modules"])).toBe(true);
  });

  it.each([
    "site/.wrangler/state/v3/d1/local.sqlite",
    "site/.wrangler/tmp/worker.js",
    "site/.dev.vars",
    "site/.dev.vars.local",
    "site/.env",
    "site/.env.production",
  ])("mantém o estado e os segredos locais do site fora do contexto: %s", (arquivo) => {
    expect(excluidoDoContexto(arquivo, REGRAS_CONTEXTO)).toBe(true);
    expect(excluidoDoContexto("site/worker.ts", REGRAS_CONTEXTO)).toBe(false);
  });
});

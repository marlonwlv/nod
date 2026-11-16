import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "../../..");

describe("imagem de produção", () => {
  it("mantém no contexto os módulos importados pelo typecheck do build", () => {
    const dockerfile = readFileSync(join(RAIZ, "Dockerfile"), "utf8");
    const dockerignore = readFileSync(join(RAIZ, ".dockerignore"), "utf8")
      .split("\n")
      .map((linha) => linha.trim())
      .filter((linha) => linha !== "" && !linha.startsWith("#"));

    expect(dockerfile).toMatch(/COPY \. \.\s+RUN npm run build/);
    // tests/unit/site/www-canonico.test.ts entra no tsconfig.server e importa este módulo.
    // Excluir o diretório fazia o typecheck passar localmente e falhar só dentro do docker build.
    expect(dockerignore).not.toContain("site");
    expect(dockerignore).not.toContain("site/");
  });
});

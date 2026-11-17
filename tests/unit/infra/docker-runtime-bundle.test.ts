import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundle da imagem HTTP", () => {
  it("leva os módulos de infra importados pelo servidor", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("infra/computador/shell-visual-distribuicao.mjs");
    expect(dockerfile).toMatch(/RUN node -e .*src\/adapters\/http\/server\.ts/);
  });
});

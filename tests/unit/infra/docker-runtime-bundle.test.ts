import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundle da imagem HTTP", () => {
  it("leva os módulos de infra importados pelo servidor", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("infra/computador/shell-visual-distribuicao.mjs");
    expect(dockerfile).toMatch(/RUN node -e .*src\/adapters\/http\/server\.ts/);
  });
});

describe("runtime da imagem do computador", () => {
  it("prepara a pasta dos sockets antes de iniciar os dois processos", () => {
    const runtime = readFileSync("infra/computador/docker-runtime.mjs", "utf8");
    expect(runtime).toContain("await mkdir(run, { recursive: true })");
    expect(runtime.indexOf("await mkdir(run")).toBeLessThan(runtime.indexOf("spawn(process.execPath"));
  });
});

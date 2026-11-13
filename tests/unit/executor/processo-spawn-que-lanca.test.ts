import { describe, expect, it } from "vitest";
import { iniciarProcesso } from "../../../src/adapters/executor/processo.ts";

const env = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));

/**
 * 2026-11-13: o `spawn` do Node lança na hora (não emite 'error') para alguns erros. O processo que não nasceu vira o
 * fim com `erroSpawn` (lancamento_falhou no driver), nunca uma exceção que sobe até o laço como erro genérico.
 * O caso do Windows (linha de comando acima do teto, ENAMETOOLONG) mora em tests/windows/processo-windows.test.ts:
 * aqui o `it.runIf(win32)` nunca rodava de verdade, porque este projeto ("unit") só roda no Ubuntu da CI.
 */
describe("spawn que lança na hora", () => {
  it("arg inválido (byte nulo, que o Node recusa em toda plataforma) vira fim com erroSpawn e sem pid", async () => {
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "a\u0000b"], env: env(), cwd: process.cwd(), aoLinha: () => undefined, encerrarFugitivos: false });
    const fim = await p.fim;
    expect(p.pid).toBeNull();
    expect(fim.erroSpawn).toBeInstanceOf(Error);
    expect(fim.exitCode).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { iniciarProcesso } from "../../../src/adapters/executor/processo.ts";

const env = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));

/**
 * 2026-11-13: o `spawn` do Node lança na hora (não emite 'error') para alguns erros — no Windows, a linha de comando
 * acima do teto dá ENAMETOOLONG. O processo que não nasceu vira o fim com `erroSpawn` (lancamento_falhou no driver),
 * nunca uma exceção que sobe até o laço como erro genérico.
 */
describe("spawn que lança na hora", () => {
  it("arg inválido (byte nulo, que o Node recusa em toda plataforma) vira fim com erroSpawn e sem pid", async () => {
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "a\u0000b"], env: env(), cwd: process.cwd(), aoLinha: () => undefined, encerrarFugitivos: false });
    const fim = await p.fim;
    expect(p.pid).toBeNull();
    expect(fim.erroSpawn).toBeInstanceOf(Error);
    expect(fim.exitCode).toBeNull();
  });

  it.runIf(process.platform === "win32")("no Windows, a linha de comando acima de 32.767 caracteres vira erroSpawn ENAMETOOLONG", async () => {
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "0", "x".repeat(33_000)], env: env(), cwd: process.cwd(), aoLinha: () => undefined, encerrarFugitivos: false });
    const fim = await p.fim;
    expect((fim.erroSpawn as NodeJS.ErrnoException | undefined)?.code).toBe("ENAMETOOLONG");
  });
});

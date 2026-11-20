import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { navegadorEstaVivo, reconciliarSaudeDoNavegador } from "../../../infra/computador/saude-runtime.mjs";

const contexto = (conectado: boolean, paginasFechadas: boolean[]) => ({
  browser: () => ({ isConnected: () => conectado }),
  pages: () => paginasFechadas.map((fechada) => ({ isClosed: () => fechada })),
});

describe("saúde do navegador no runtime Docker", () => {
  it("liga a reconciliação ao ping que o driver consulta antes de cada ação", async () => {
    const runtime = await readFile("infra/computador/runtime.mjs", "utf8");
    expect(runtime).toContain("import { reconciliarSaudeDoNavegador } from './saude-runtime.mjs';");
    expect(runtime).toMatch(/if\s*\(pedido\?\.tipo\s*===\s*'ping'\)\s*\{[\s\S]*?reconciliarSaudeDoNavegador\(pronto,\s*falha,\s*context\)[\s\S]*?socket\.end/);
  });

  it("mantém pronto enquanto Chromium e ao menos uma página estão vivos", () => {
    const vivo = contexto(true, [false]);
    expect(navegadorEstaVivo(vivo)).toBe(true);
    expect(reconciliarSaudeDoNavegador(true, null, vivo)).toEqual({ pronto: true, falha: null });
  });

  it.each([
    ["processo desconectado", contexto(false, [false])],
    ["todas as páginas fechadas", contexto(true, [true, true])],
    ["contexto ausente", null],
  ])("transforma o runtime zumbi em falha reiniciável: %s", (_caso, morto) => {
    expect(navegadorEstaVivo(morto)).toBe(false);
    expect(reconciliarSaudeDoNavegador(true, null, morto)).toEqual({
      pronto: false,
      falha: { codigo: "navegador_nao_abriu", detalhe: "o navegador fechou" },
    });
  });

  it("não sobrescreve a falha de boot que já explica por que o runtime parou", () => {
    const falha = { codigo: "cofre_invalido", detalhe: "cofre recusado" };
    expect(reconciliarSaudeDoNavegador(false, falha, null)).toEqual({ pronto: false, falha });
  });
});

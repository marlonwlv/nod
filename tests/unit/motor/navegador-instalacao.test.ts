import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_BROWSER_DO_MOTOR, scriptDeInstalacao } from "../../../src/adapters/http/motor-instalacao.ts";

/** ADR-190: a instalação do motor do Linux leva o agent-browser do navegador do bot, na versão fixa do package.json. */
describe("o navegador do bot na instalação do motor", () => {
  it("instala agent-browser@<versão do package.json> em /opt/nod-motor/navegador, sem derrubar a instalação se falhar", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["agent-browser"]).toBe(AGENT_BROWSER_DO_MOTOR);
    const s = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.9.0" });
    expect(s).toContain(`install --prefix "$PASTA/navegador" --no-fund --no-audit --ignore-scripts --loglevel=error agent-browser@${AGENT_BROWSER_DO_MOTOR}`);
    expect(s).toContain("Aviso: o navegador do bot não instalou agora.");
    expect(s.indexOf("agent-browser@")).toBeGreaterThan(s.indexOf('passo "motor $NOD_VERSAO"'));
  });
});

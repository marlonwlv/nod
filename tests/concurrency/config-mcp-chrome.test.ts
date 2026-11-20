import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { renderMcp } from "../../web/telas/config-mcp.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir a conexão MCP");
const descrever = chrome ? describe : describe.skip;

descrever("Conectar por MCP no celular (Chrome real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-mcp-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    const css = ["web/tokens.css", "web/estilos.css", "web/configuracoes.css", "web/mobile.css"]
      .filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const emitido = {
      token: "nod_mcp_segredo_qa",
      endpoint: "https://nod.exemplo/api/mcp",
      dados: { id: "t1", nome: "Cliente 👨‍👩‍👧‍👦", prefixo: "12345678", cliente: null, criadoEm: 0, ultimoUsoEm: null, revogadoEm: null },
    };
    const corpo = renderMcp({ tokens: null, emitido }, { abertos: [] } as never);
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="config">${corpo}</main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mostra o segredo uma vez com as duas formas de copiar, sem transbordar", async () => {
    expect(await avaliar<string>(cdp, "document.querySelector('[role=status]').textContent")).toContain("nod_mcp_segredo_qa");
    expect(await avaliar<string[]>(cdp, "[...document.querySelectorAll('[role=status] button')].map((b) => b.textContent.trim())")).toEqual(["Copiar token", "Copiar configuração", "Já copiei"]);
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("Conta: o CI precisa do Chrome (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { htmlEtapa } from "./web/telas/conta-no-chat.ts";
window.__montar = (tipo) => {
  const etapas = {
    pedido: { tipo: "parear-gerar", codigo: "123456", expiraEm: 301000, pedido: { aparelho: "Celular de teste", simbolos: ["sol", "lua", "peixe"] }, vencido: false },
    entrar: { tipo: "parear-entrar", simbolos: null, erro: "Esse código não vale. Gere outro no computador onde você já entrou." },
    vencido: { tipo: "parear-gerar", codigo: "123456", expiraEm: 0, pedido: null, vencido: true },
  };
  document.querySelector("main").innerHTML = '<section class="cc-bloco">' + htmlEtapa(etapas[tipo], { ocupado: false, google: false, agora: 1000 }) + "</section>";
};
window.__montar("pedido");
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  const css = ["tokens.css", "estilos.css", "interface.css", "conta.css"].map((f) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`).join("");
  const arq = join(dir, "conta.html");
  writeFileSync(arq, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>body{margin:0}main{padding:12px;box-sizing:border-box}</style></head><body><main></main><script>${js.outputFiles[0]!.text}</script></body></html>`);
  return pathToFileURL(arq).href;
}

descrever("pareamento da conta no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-conta-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9400 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 250));
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  it("mantém todas as ações tocáveis e sem rolagem lateral nos estados críticos", async () => {
    for (const etapa of ["pedido", "entrar", "vencido"]) {
      await avaliar(cdp, `window.__montar(${JSON.stringify(etapa)})`);
      const medido = await avaliar<{ controles: { texto: string; largura: number; altura: number }[]; transbordou: boolean }>(cdp, `(() => ({
        controles: [...document.querySelectorAll('.cc-cartao .bt, .cc-cartao input')].map((b) => { const r = b.getBoundingClientRect(); return { texto: b.textContent.trim() || b.getAttribute('name'), largura: r.width, altura: r.height }; }),
        transbordou: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }))()`);
      expect(medido.transbordou, etapa).toBe(false);
      for (const controle of medido.controles) {
        expect(controle.largura, `${etapa}: ${controle.texto}`).toBeGreaterThanOrEqual(44);
        expect(controle.altura, `${etapa}: ${controle.texto}`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

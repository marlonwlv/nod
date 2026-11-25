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
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("o CI precisa do Chrome para provar o seletor de pasta");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { abrirWorkspace } from "./web/telas/workspace.ts";
const pastas = Array.from({ length: 100 }, (_, i) => ({ nome: "projeto-" + i, caminho: "/workspace/projeto-" + i }));
const chamadas = [];
const api = {
  workspace: async () => ({ disponivel: true, vinculo: null }),
  pastasWorkspace: async (_id, caminho) => ({ caminho: caminho || "/workspace", pai: "/", selecionavel: true, pastas }),
  escolherWorkspace: async (_id, pasta) => { chamadas.push(["permitir", pasta]); },
  revogarWorkspace: async () => { chamadas.push(["revogar"]); },
};
window.__abrir = () => abrirWorkspace(api, "c1");
window.__chamadas = chamadas;
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "workspace.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("pasta de trabalho no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "workspace-dialogo-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9550 + (process.pid % 300), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  it("mantém todos os controles tocáveis e o conteúdo dentro da tela no celular", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      if (await avaliar(cdp, `typeof window.__abrir === "function"`)) break;
      await esperar(25);
    }
    await avaliar(cdp, `window.__abrir()`);
    for (let i = 0; i < 100; i++) {
      if (await avaliar(cdp, `document.querySelectorAll("dialog [data-pasta]").length === 100`)) break;
      await esperar(25);
    }
    const medidas = await avaliar<Array<{ texto: string; largura: number; altura: number }>>(cdp, `[...document.querySelectorAll("dialog button")].filter((b) => !b.hidden).map((b) => { const r = b.getBoundingClientRect(); return { texto: b.textContent.trim(), largura: r.width, altura: r.height }; })`);
    expect(medidas.length).toBeGreaterThan(100);
    expect(medidas.filter((m) => m.largura < 44 || m.altura < 44), JSON.stringify(medidas.slice(0, 8))).toEqual([]);
    expect(await avaliar(cdp, `document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
    await avaliar(cdp, `document.querySelector("dialog [data-pasta]").click()`);
    await esperar(50);
    await avaliar(cdp, `document.querySelector("dialog [data-permitir]").click()`);
    await esperar(50);
    expect(await avaliar(cdp, `window.__chamadas`)).toEqual([["permitir", "/workspace/projeto-0"]]);
  });
});

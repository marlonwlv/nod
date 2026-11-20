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
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("Canvas: o CI precisa do Chrome (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarCanvasNaTela } from "./web/lib/canvas-na-tela.ts";
const item = { id: "cvA", issue: "ADA-13", titulo: "Fluxo", versao: 1, origemUrl: null, atualizadoEm: 1, abertos: 0,
  estado: "esperando_voce", etapa: null, aprovadoEm: null, telas: 1, jornadas: 1 };
const vista = { canvas: item, confiavel: true, versoes: 1, comentarios: [], proximaRodada: 1,
  estrutura: { issue: "ADA-13", titulo: "Fluxo", versaoTexto: null, links: [], css: [], js: [], notas: [], jornadas: [{
    id: "J1", titulo: "Entrada", resumo: "Abrir", telas: [{ id: "J1-1", jornada: "J1", titulo: "Início", legenda: "Primeira tela",
      tamanho: "cel", hoje: true, novo: [], html: "<main>Início</main>", miniatura: null }]
  }] } };
const api = { canvasDoAgente: async () => ({ canvas: [item] }), verCanvas: async () => structuredClone(vista), blobsCanvas: async () => ({ blobs: {} }) };
window.__montar = () => {
  const host = document.getElementById("canvas");
  host.innerHTML = "";
  const tela = criarCanvasNaTela(document, { api: () => api, conversa: () => "conv" });
  tela.querAbrir("cvA");
  tela.montar(host, "ag1", "Gil");
  window.__tela = tela;
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  const css = ["estilos.css", "interface.css", "navegacao.css", "paginas.css", "canvas.css"].map((f) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`).join("");
  const arq = join(dir, "canvas.html");
  writeFileSync(arq, `<!doctype html><html><head>${css}</head><body><div id="canvas" style="position:fixed;inset:0"></div><script>${js.outputFiles[0]!.text}</script></body></html>`);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("Canvas no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-canvas-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9200 + (process.pid % 500), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };

  it("preserva o post-it salvo se a página for recriada durante a edição", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, `localStorage.setItem("nod.canvas.rodada.cvA", JSON.stringify([{ id: "r1", tipo: "nota", endereco: "J1", texto: "nota guardada" }])); window.__montar()`);
    await ate(`document.querySelector('.cv-nota-rasc')`);
    await avaliar(cdp, `document.querySelector('.cv-nota-rasc').click()`);
    await ate(`document.querySelector('#cv-nota-in')?.value === "nota guardada"`);
    expect(await avaliar(cdp, `JSON.parse(localStorage.getItem("nod.canvas.rodada.cvA") ?? "[]").map((x) => x.texto)`)).toEqual(["nota guardada"]);
    await avaliar(cdp, `window.__montar()`);
    await ate(`document.querySelector('.cv-nota-rasc')`);
    expect(await avaliar(cdp, `document.querySelector('.cv-nota-rasc')?.textContent`)).toContain("nota guardada");
  });
});

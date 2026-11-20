import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/** QA 2026-11-16: a lista completa do Canvas precisa caber no celular mesmo quando o filtro Aprovados aparece. */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("Canvas: esta prova precisa do Chrome");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { htmlDaLista } from "./web/lib/canvas-html.ts";
const item = (id, estado) => ({ id, issue: "NOD-" + id, titulo: "Canvas com um nome longo para testar o limite", versao: 12, origemUrl: null, atualizadoEm: Date.now(), abertos: 3, estado, etapa: estado === "em_producao" ? "montando J10-20" : null, aprovadoEm: estado === "aprovado" ? Date.now() : null, telas: 99, jornadas: 12 });
document.body.innerHTML = '<main class="cv" style="height:100vh">' + htmlDaLista({ lista: [item("1", "esperando_voce"), item("2", "em_producao"), item("3", "aprovado")], filtro: "todos", busca: "", nome: "Bot com nome longo", miniatura: () => null }) + '</main>';
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  const css = ["tokens.css", "estilos.css", "interface.css", "canvas.css"].map((f) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`).join("");
  const arq = join(dir, "canvas-lista-celular.html");
  writeFileSync(arq, `<!doctype html><html><head><meta name="viewport" content="width=device-width">${css}</head><body><script>${js.outputFiles[0]!.text}</script></body></html>`);
  return pathToFileURL(arq).href;
}

descrever("Canvas no Chrome real: lista no celular", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "canvas-lista-celular-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  it("mantém filtros, busca e linhas dentro de 390 px", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Page.navigate", { url });
    await avaliar(cdp, "document.fonts.ready");
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBe(390);
    expect(await avaliar<number>(cdp, "Math.max(...[...document.querySelectorAll('.cv-filtro')].map((x) => x.getBoundingClientRect().right))")).toBeLessThanOrEqual(374);
    expect(await avaliar<number[]>(cdp, "[...document.querySelectorAll('.cv-filtro')].map((x) => x.getBoundingClientRect().height)")).toEqual([44, 44, 44, 44]);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

const RAIZ = new URL("../../", import.meta.url);
const chrome = (() => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("a jornada de sala precisa do Chrome");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { estadoInicial } from "./web/estado/reducer.ts";
import { renderNovaSala } from "./web/telas/sala.ts";
const bot = (i) => ({ id: "a" + i, nome: "Bot " + String(i).padStart(3, "0") + " nome longo para volume", cor: "c-blue", forma: "shape-square" });
window.__montar = (n) => {
  const estado = { ...estadoInicial, frota: { agentes: Array.from({ length: n }, (_, i) => bot(i + 1)) } };
  document.querySelector("main").innerHTML = renderNovaSala(estado);
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let css = "";
  for (const f of ["tokens.css", "estilos.css", "interface.css", "mobile.css"]) css += readFileSync(new URL(`web/${f}`, RAIZ), "utf8");
  const arq = join(dir, "sala.html");
  writeFileSync(arq, `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main></main><script>${js.outputFiles[0]!.text}</script>`);
  return pathToFileURL(arq).href;
}

descrever("criar sala no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-sala-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  it("mantém as opções tocáveis e sem transbordo com 100 bots no celular", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
    await cdp.enviar("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 100));
    await avaliar(cdp, "window.__montar(100)");
    const medidas = await avaliar<{ largura: number; alvo: { largura: number; altura: number }; botao: { largura: number; altura: number } }>(cdp, `(() => {
      const alvo = document.querySelector('.opcao').getBoundingClientRect();
      const botao = document.querySelector('[data-act="criar-sala"]').getBoundingClientRect();
      return { largura: document.documentElement.scrollWidth, alvo: { largura: alvo.width, altura: alvo.height }, botao: { largura: botao.width, altura: botao.height } };
    })()`);
    expect(medidas.largura).toBe(390);
    expect(medidas.alvo.altura).toBeGreaterThanOrEqual(44);
    expect(medidas.alvo.largura).toBeGreaterThanOrEqual(44);
    expect(medidas.botao.altura).toBeGreaterThanOrEqual(44);
    expect(await avaliar(cdp, "document.querySelectorAll('.opcao').length")).toBe(100);
  });

  it("mostra o vazio e preserva foco e seleção no desktop", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.enviar("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 100));
    await avaliar(cdp, "window.__montar(0)");
    expect(await avaliar(cdp, "document.querySelector('main').textContent.includes('Crie ao menos dois bots primeiro.')")).toBe(true);
    await avaliar(cdp, "window.__montar(6); document.querySelector('.opcao input').focus(); document.querySelector('.opcao input').click()");
    expect(await avaliar(cdp, "document.activeElement === document.querySelector('.opcao input') && document.querySelector('.opcao input').checked")).toBe(true);
  });
});

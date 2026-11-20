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
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("Feedback: o CI precisa do Chrome (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { renderRelatos } from "./web/telas/relatos.ts";
import { CONFIG_UI_INICIAL } from "./web/estado/reducer.ts";
const base = { tenantId: "t", conversaId: "c", turnoId: "t1", alcance: "janela", mensagensAnexadas: 2,
  diagnostico: null, criadoEm: Date.UTC(2026, 10, 17, 1), titulo: null, resumo: null,
  metadados: { estadoTurno: "concluido", origemTurno: "conversa", sinais: null, motivoFalha: null,
    motivoInterrupcao: null, modelo: "auto", harness: "catcher", executor: "catcher", machineId: null,
    custoUsd: null, reenvios: null, confiancaMensagem: "confiavel", mensagemParcial: false,
    versaoApp: "1.0.0", correlationId: null } };
const relatos = Array.from({ length: 200 }, (_, i) => ({ ...base, id: "r" + i, mensagemId: "m" + i,
  tipo: ["bug", "melhoria", "duvida"][i % 3], origem: "botao", categoria: "interface",
  titulo: i === 0 ? "a".repeat(78) + "😀bc" : "Envio " + i + " 👩🏽‍💻" }));
window.__montar = (modo = "cheio") => {
  const estado = modo === "carregando" ? { relatos: null, configUi: CONFIG_UI_INICIAL }
    : modo === "erro" ? { relatos: null, relatosErro: true, configUi: CONFIG_UI_INICIAL }
    : modo === "vazio" ? { relatos: [], configUi: CONFIG_UI_INICIAL }
    : { relatos, configUi: CONFIG_UI_INICIAL };
  document.getElementById("app").innerHTML = renderRelatos(estado);
};
window.__montar();
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  const css = ["estilos.css", "interface.css", "configuracoes.css", "mobile.css"]
    .map((f) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`).join("");
  const arq = join(dir, "feedback.html");
  writeFileSync(arq, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body class="cfg-celular"><main id="app"></main><script>${js.outputFiles[0]!.text}</script></body></html>`);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("Feedback no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-feedback-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9400 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };

  it("preserva Unicode e os estados com volume em 320 px", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Page.navigate", { url });
    await ate(`document.querySelectorAll('.cfg-relato').length === 200`);
    expect(await avaliar(cdp, `document.querySelector('.cfg-relato b')?.textContent`)).toBe(`${"a".repeat(78)}😀…`);
    expect(await avaliar(cdp, `document.body.innerText.includes('�')`)).toBe(false);
    expect(await avaliar(cdp, `document.documentElement.scrollWidth <= 320`)).toBe(true);
    const alvos = await avaliar<{ filtro: number; enviar: number }>(cdp, `({
      filtro: document.querySelector('.filtro-relato').getBoundingClientRect().height,
      enviar: document.querySelector('.cfg-enviar').getBoundingClientRect().height
    })`);
    expect(alvos.filtro).toBeGreaterThanOrEqual(44);
    expect(alvos.enviar).toBeGreaterThanOrEqual(44);
    for (const [modo, texto] of [["carregando", "Verificando…"], ["erro", "Tentar de novo"], ["vazio", "Nenhum envio ainda"]]) {
      await avaliar(cdp, `window.__montar(${JSON.stringify(modo)})`);
      expect(await avaliar(cdp, `document.body.innerText.includes(${JSON.stringify(texto)})`)).toBe(true);
    }
  });
});

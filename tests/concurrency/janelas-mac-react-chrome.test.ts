import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * ADR-179 (item 4): o topo do Quick Chat e o avatar da mesa em React no Chrome real, com o CSS do app na janela de
 * 608×440 (`html[data-janela]`): o mesmo conteúdo pelas duas vias (a string e o componente), as mesmas caixas.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADR-179: o CI precisa do Chrome para provar as janelas do Mac em React (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { htmlAvatarDaMesa, htmlTopoQuickChat } from "./web/lib/quick-chat.ts";
import { criarAvatarDaMesa, criarTopoDoQuickChat } from "./web/react/janelas/quick-chat.tsx";
const BOTS = [{ id: "a", nome: "Ada", conversaId: "c1" }, { id: "b", nome: "Gil", conversaId: "c2" }];
const MASCOTE = '<span class="icon mascote sm c-blue shape-circle" style="display:inline-block;width:20px;height:20px"></span>';
const caixas = (raiz) => [...raiz.querySelectorAll("*")].map((el) => { const r = el.getBoundingClientRect(); return [el.tagName, el.className, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(":"); });
const noop = () => undefined;
window.__comparar = (janela) => {
  document.documentElement.dataset.janela = janela;
  const id = janela === "quick-chat" ? "quick-chat-topo" : "avatar-mesa";
  document.getElementById(id)?.remove();
  const raiz = document.createElement("div"); raiz.id = id; document.body.prepend(raiz);
  const t = { bots: BOTS, atual: "a", mesa: { pode: true, montado: true }, avatar: MASCOTE };
  raiz.innerHTML = janela === "quick-chat" ? htmlTopoQuickChat(t.bots, t.atual, t.mesa, t.avatar) : htmlAvatarDaMesa(BOTS[0], MASCOTE);
  const porString = caixas(raiz);
  if (janela === "quick-chat") criarTopoDoQuickChat(raiz, { escolherBot: noop, montar: noop, desmontar: noop, expandir: noop, fechar: noop })(t);
  else criarAvatarDaMesa(raiz, { abrir: noop, tirar: noop })({ bot: BOTS[0], mascote: MASCOTE });
  return { porString, porReact: caixas(raiz) };
};
`;
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

descrever("ADR-179: as janelas do Mac em React no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-jan-rx-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent", jsx: "automatic", outdir: dir, loader: { ".css": "empty" }, minify: true, define: { "process.env.NODE_ENV": '"production"' } });
    let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
    html = html.replace(/<link rel="stylesheet" href="\/([\w/-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles.find((f) => f.path.endsWith(".js"))!.text}</script>`);
    writeFileSync(join(dir, "p.html"), html);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9500 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 608, height: 440, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url: pathToFileURL(join(dir, "p.html")).href });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__comparar")); i++) await esperar(50);
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  it.each(["quick-chat", "avatar"])("%s: as caixas dos elementos são as mesmas do desenho por string", async (janela) => {
    const r = await avaliar<{ porString: string[]; porReact: string[] }>(cdp, `window.__comparar(${JSON.stringify(janela)})`);
    expect(r.porString.length).toBeGreaterThan(2);
    expect(r.porReact).toEqual(r.porString);
  }, 60_000);
});

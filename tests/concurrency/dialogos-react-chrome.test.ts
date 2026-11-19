import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * ADR-179 (item 4) e ADR-180: o diálogo de handoff do Quadro pelo Dialog do Base UI, no Chrome de verdade, com o CSS do
 * app — o que o happy-dom não prova: o foco preso no diálogo (o Tab não sai), o cartão centrado sobre o fundo, o Esc que
 * responde "não mover" e o foco que volta a quem estava antes.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADR-179: o CI precisa do Chrome para provar os diálogos em React (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { abrirHandoffNoReact } from "./web/react/dialogos/handoff.tsx";
import { confirmarNoReact } from "./web/react/dialogos/confirmar.tsx";
window.__confirmar = () => {
  window.__resposta = undefined;
  confirmarNoReact(document, { idDoTitulo: "rodar-mais-uma-titulo", titulo: "Rodar mais uma execução?", texto: "Já há uma na fila.", cancelar: "Cancelar", confirmar: "Rodar mais uma", origem: document.getElementById("antes") })
    .then((r) => { window.__resposta = r; });
};
const AGORA = Date.now();
window.__abrir = (anterior = true) => {
  window.__resposta = undefined;
  abrirHandoffNoReact(document, { passa: true, aciona: true, deNome: "Ada", paraNome: "Gil", texto: "Revise o PR", codigo: "NOD-7", coluna: "Em revisão",
    anterior: anterior ? { agenteNome: "Ada", estado: "rodando", desde: AGORA - 300000 } : null }, AGORA).then((r) => { window.__resposta = r; });
};
`;
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

descrever("ADR-179: o diálogo de handoff pelo Base UI no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-dlg-rx-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent", jsx: "automatic", outdir: dir, loader: { ".css": "empty" } });
    let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
    html = html.replace(/<link rel="stylesheet" href="\/([\w/-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<button id="antes">antes</button><script>${js.outputFiles.find((f) => f.path.endsWith(".js"))!.text}</script>`);
    writeFileSync(join(dir, "p.html"), html);
    url = pathToFileURL(join(dir, "p.html")).href;
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    // A aba headless conta como focada (como na régua): sem isto o relógio das animações não anda só com o teclado, e a
    // saída do diálogo (o fade) nunca termina — a página parece inerte, o que não acontece com a janela à vista.
    await cdp.enviar("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__abrir")); i++) await esperar(50);
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  const ate = async (expr: string): Promise<void> => {
    for (let i = 0; i < 100; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const tecla = async (key: string, code: string, vk: number, shift = false): Promise<void> => {
    await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
    if (key === "Enter") await cdp.enviar("Input.dispatchKeyEvent", { type: "char", key, code, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: vk });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
  };

  it("abre com o foco em Mover, centrado sobre o fundo; o Tab não sai do diálogo; Esc responde não mover e o foco volta", async () => {
    await avaliar(cdp, `document.getElementById("antes").focus(); window.__abrir()`);
    await ate(`document.activeElement?.dataset?.ho === "mover"`);
    const caixa = await avaliar<{ cx: number; cy: number; fundo: boolean }>(cdp, `(() => { const r = document.querySelector(".qd-handoff").getBoundingClientRect();
      return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), fundo: getComputedStyle(document.querySelector(".rx-ho-fundo")).position === "fixed" }; })()`);
    expect(Math.abs(caixa.cx - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(caixa.cy - 400)).toBeLessThanOrEqual(2);
    expect(caixa.fundo).toBe(true);
    // O Base UI prende o foco com sentinelas em volta do diálogo: entre uma tecla e outra o foco passa por elas e volta.
    const focos: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      await tecla("Tab", "Tab", 9);
      await esperar(30);
      focos.push(await avaliar<boolean>(cdp, `!!document.activeElement?.closest(".qd-handoff")`));
    }
    expect(focos.every(Boolean), "o Tab fica no diálogo").toBe(true);
    await tecla("Escape", "Escape", 27);
    await ate(`window.__resposta !== undefined`);
    expect(await avaliar<unknown>(cdp, "window.__resposta")).toBeNull();
    await ate(`!document.querySelector(".qd-handoff")`);
    await ate(`document.activeElement?.id === "antes"`);
  }, 60_000);

  it("a confirmação (bot-dialogo): o foco em Cancelar, centrada; Esc responde não e o foco volta; Rodar mais uma responde sim", async () => {
    await avaliar(cdp, `document.getElementById("antes").focus(); window.__confirmar()`);
    await ate(`document.activeElement?.hasAttribute("data-nao")`);
    const c = await avaliar<{ cx: number; cy: number }>(cdp, `(() => { const r = document.querySelector(".bot-dialogo.rx-dlg").getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
    expect(Math.abs(c.cx - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.cy - 400)).toBeLessThanOrEqual(2);
    await tecla("Escape", "Escape", 27);
    await ate(`window.__resposta !== undefined`);
    expect(await avaliar<unknown>(cdp, "window.__resposta")).toBe(false);
    await ate(`document.activeElement?.id === "antes"`);
    await avaliar(cdp, "window.__confirmar()");
    await ate(`document.activeElement?.hasAttribute("data-nao")`);
    await tecla("Tab", "Tab", 9);
    await ate(`document.activeElement?.hasAttribute("data-sim")`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__resposta !== undefined`);
    expect(await avaliar<unknown>(cdp, "window.__resposta")).toBe(true);
    await ate(`!document.querySelector(".rx-dlg-host")`);
  }, 60_000);

  it("marcar Parar e Mover (Enter) responde mover parando o anterior", async () => {
    // O foco que o diálogo anterior devolve (a quem o abriu) chega depois de ele sair: o próximo abre com a página quieta.
    await esperar(300);
    await avaliar(cdp, "window.__abrir()");
    await ate(`document.activeElement?.dataset?.ho === "mover"`);
    await avaliar(cdp, `document.querySelector('input[name="parar"]').click(); document.querySelector('[data-ho="mover"]').focus()`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__resposta !== undefined`);
    expect(await avaliar<unknown>(cdp, "window.__resposta")).toEqual({ parar: true });
    await ate(`!document.querySelector(".rx-ho-host")`);
  }, 60_000);
});

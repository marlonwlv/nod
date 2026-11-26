import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * XUM-8 (pedido do Marlon, 2026-11-26) no app inteiro e no Chrome de verdade: o "Capturar" saiu da barra do campo e mora
 * no +, que abre um menu com Anexar e Capturar. A ponte do app do Mac é simulada (`window.nodDesktop.capturarTela`
 * devolve um PNG de 1×1); o seletor de arquivo é contado no `click()` do input. Confere:
 *  - a barra sem o botão Capturar e o + com o nome do menu;
 *  - o menu inteiro na tela, Anexar antes de Capturar, com ícone e papel de menu;
 *  - teclado: setas e Enter escolhem o Capturar (a captura vira anexo do campo); Esc fecha e o foco volta ao +;
 *  - clique fora fecha; Anexar abre o seletor de arquivo, como o + fazia;
 *  - na web (sem a ponte) o + abre o seletor direto, sem menu, como antes.
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como os outros e2e de Chrome.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("capturar no +: o CI precisa da web montada (npx vite build) e do Chromium");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O PNG de 1×1 que a ponte falsa devolve. */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** Roda antes do app em cada página: a ponte do Mac (menos quando o teste pede a web) e o contador do seletor de arquivo. */
const PONTE_FALSA = `(() => {
  window.__capturas = 0; window.__seletor = 0;
  const clicar = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type === "file") { window.__seletor++; return; } return clicar.call(this); };
  if (sessionStorage.getItem("xum8-web") === "1") return;
  window.nodDesktop = { capturarTela: async () => { window.__capturas++; return { nome: "Captura de região.png", mime: "image/png", base64: "${PNG_1X1}", largura: 1, altura: 1 }; } };
})();`;

descrever("Capturar no menu do + (Chrome real, XUM-8)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_STATIC_DIR: WEB, NOD_PRAZO_DECISAO_MS: "86400000" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })] });
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); }
    await srv.json("POST", "onboarding/concluir", {});
    dir = mkdtempSync(join(tmpdir(), "capturar-mais-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    await cdp.enviar("Page.addScriptToEvaluateOnNewDocument", { source: PONTE_FALSA });
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  }, 30_000);

  async function criarBot(nome: string): Promise<{ id: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Cuida do campo" });
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    return { id: r.agente.id, conversaId: r.conversa.id };
  }

  async function ate(expressao: string, oQue: string, ms = 15_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
      await espera(100);
    }
    throw new Error(`esperei ${ms} ms por ${oQue}`);
  }
  const tecla = async (key: string, code: string, vk: number) => {
    // O Enter só ativa o botão com o `text` (como o teclado de verdade manda).
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(key === "Enter" ? { text: "\r" } : {}) });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    await espera(80);
  };
  /** Um clique de mouse de verdade (CDP) no meio do elemento. */
  async function clicarComMouse(sel: string): Promise<void> {
    const c = await avaliar<{ x: number; y: number } | null>(cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    if (!c) throw new Error(`não achei ${sel}`);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1 });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1 });
    await espera(120);
  }

  async function abrirConversa(bot: { id: string }, web = false): Promise<void> {
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    await ate(`document.querySelector('[data-act="abrir-conversa"]')`, "a lista de bots");
    if (web !== (await avaliar<boolean>(cdp, `sessionStorage.getItem("xum8-web") === "1"`))) {
      await avaliar(cdp, `(sessionStorage.setItem("xum8-web", ${JSON.stringify(web ? "1" : "0")}), true)`);
      await cdp.enviar("Page.reload");
      await ate(`document.querySelector('[data-act="abrir-conversa"]')`, "a lista de bots de novo");
    }
    await avaliar(cdp, `document.querySelector('[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]').click()`);
    await ate(`document.getElementById("composer-texto") && !document.querySelector("#composer .mais-campo")?.hidden`, "a conversa com o + no campo");
  }

  const MENU = `document.querySelector('[role="menu"] [data-mais-pc]')`;
  const itens = () => avaliar<{ q: string; texto: string; icone: boolean; papel: string | null }[]>(cdp, `[...document.querySelectorAll('[role="menu"] [data-mais-pc]')].map((b) => ({ q: b.dataset.maisPc, texto: b.textContent.trim(), icone: !!b.querySelector("svg.mm-ic"), papel: b.getAttribute("role") }))`);
  const focado = () => avaliar<string | null>(cdp, `document.activeElement?.dataset?.maisPc ?? (document.activeElement?.classList.contains("mais-campo") ? "+" : null)`);

  it("1280 com o Mac: a barra sem Capturar; o + abre Anexar e Capturar, na tela, por mouse e por teclado", async () => {
    const bot = await criarBot("Campo Capturar");
    await abrirConversa(bot);
    // A barra não tem mais o botão; o + diz o que o menu tem.
    expect(await avaliar<number>(cdp, `document.querySelectorAll('#composer [data-act="capturar-tela"], #composer .qc-capturar').length`)).toBe(0);
    expect(await avaliar<string | null>(cdp, `document.querySelector("#composer .mais-campo").getAttribute("aria-label")`)).toBe("Anexar e capturar");
    expect(await avaliar<string | null>(cdp, `document.querySelector("#composer .mais-campo").getAttribute("aria-haspopup")`)).toBe("menu");

    // Mouse: o + abre o menu acima dele, inteiro na tela.
    await clicarComMouse("#composer .mais-campo");
    await ate(MENU, "o menu do +");
    expect(await itens()).toEqual([
      { q: "anexar", texto: "Anexar", icone: true, papel: "menuitem" },
      { q: "capturar", texto: "Capturar", icone: true, papel: "menuitem" },
    ]);
    const caixa = await avaliar<{ top: number; left: number; bottom: number; right: number; mais: number }>(cdp, `(() => { const m = document.querySelector('[role="menu"]').getBoundingClientRect(); const p = document.querySelector("#composer .mais-campo").getBoundingClientRect(); return { top: m.top, left: m.left, bottom: m.bottom, right: m.right, mais: p.top }; })()`);
    expect(caixa.top).toBeGreaterThanOrEqual(0);
    expect(caixa.left).toBeGreaterThanOrEqual(0);
    expect(caixa.right).toBeLessThanOrEqual(1280);
    expect(caixa.bottom).toBeLessThanOrEqual(caixa.mais);
    expect(await avaliar<string | null>(cdp, `document.querySelector("#composer .mais-campo").getAttribute("aria-expanded")`)).toBe("true");

    // Esc fecha e devolve o foco ao +.
    await tecla("Escape", "Escape", 27);
    await ate(`!${MENU}`, "o menu fechar com Esc");
    expect(await focado()).toBe("+");
    expect(await avaliar<string | null>(cdp, `document.querySelector("#composer .mais-campo").getAttribute("aria-expanded")`)).toBe("false");

    // Teclado: Enter no + abre; setas andam; Enter no Capturar captura e a captura vira anexo do campo.
    await tecla("Enter", "Enter", 13);
    await ate(MENU, "o menu abrir pelo Enter");
    await tecla("ArrowDown", "ArrowDown", 40);
    if ((await focado()) !== "anexar") await tecla("ArrowDown", "ArrowDown", 40); // o Base UI pode focar o 1º já ao abrir
    expect(await focado()).toBe("anexar");
    await tecla("ArrowDown", "ArrowDown", 40);
    expect(await focado()).toBe("capturar");
    await tecla("Enter", "Enter", 13);
    await ate(`window.__capturas === 1`, "a captura da ponte do Mac");
    await ate(`document.querySelector('#composer-anexos .anexo-thumb img[alt="Captura de região.png"]')`, "a captura no anexo do campo");
    expect(await avaliar<number>(cdp, `window.__seletor`)).toBe(0);
    expect(await avaliar<string>(cdp, `document.activeElement.id`)).toBe("composer-texto");

    // Clique fora fecha sem escolher.
    await clicarComMouse("#composer .mais-campo");
    await ate(MENU, "o menu de novo");
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 160, button: "left", clickCount: 1 });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 160, button: "left", clickCount: 1 });
    await ate(`!${MENU}`, "o menu fechar com o clique fora");
    expect(await avaliar<number>(cdp, `window.__capturas + window.__seletor`)).toBe(1);

    // Anexar abre o seletor de arquivo, como o + fazia.
    await clicarComMouse("#composer .mais-campo");
    await ate(MENU, "o menu outra vez");
    await clicarComMouse('[role="menu"] [data-mais-pc="anexar"]');
    await ate(`window.__seletor === 1`, "o seletor de arquivo");
    await ate(`!${MENU}`, "o menu fechar depois do Anexar");
    expect(await avaliar<number>(cdp, `window.__capturas`)).toBe(1);
  }, 120_000);

  it("1280 na web (sem a ponte do Mac): nada de Capturar; o + abre o seletor de arquivo direto, como antes", async () => {
    const bot = await criarBot("Campo Web");
    await abrirConversa(bot, true);
    expect(await avaliar<boolean>(cdp, `"nodDesktop" in window`)).toBe(false);
    expect(await avaliar<string | null>(cdp, `document.querySelector("#composer .mais-campo").getAttribute("aria-label")`)).toBe("Anexar");
    await clicarComMouse("#composer .mais-campo");
    await ate(`window.__seletor === 1`, "o seletor de arquivo direto");
    await espera(300);
    expect(await avaliar<boolean>(cdp, `!!${MENU}`)).toBe(false);
    expect(await avaliar<number>(cdp, `document.querySelectorAll('[data-act="capturar-tela"]').length`)).toBe(0);
  }, 90_000);
});

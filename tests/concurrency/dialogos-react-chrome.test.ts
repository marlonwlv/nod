import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { criarPaletaNoReact } from "./web/react/dialogos/paleta.tsx";
import { abrirPreviaNoReact } from "./web/react/dialogos/previa-arquivo.tsx";
import { abrirLuzNoReact } from "./web/react/dialogos/luz.tsx";
import { abrirArtefatoNoReact } from "./web/react/dialogos/artefato.tsx";
import { abrirMenuDoBotNoReact } from "./web/react/dialogos/menu-do-bot.tsx";
import { abrirMenuDeHtmlNoReact } from "./web/react/dialogos/menu-de-html.tsx";
import { abrirMenuModoNoReact } from "./web/react/dialogos/menu-modo.tsx";
import { abrirMenuIaNoReact } from "./web/react/dialogos/menu-ia.tsx";
import { travarToqueDuploEm } from "./web/telas/folha-mais.ts";
import { abrirMenuDaBibliotecaNoReact } from "./web/react/dialogos/menu-da-biblioteca.tsx";
import { menuDaPagina } from "./web/telas/paginas.ts";
window.__menuPagina = () => {
  window.__acaoPg = null;
  let b = document.getElementById("pg-ic");
  if (!b) { b = Object.assign(document.createElement("button"), { id: "pg-ic", textContent: "▣" }); b.style.cssText = "position:fixed;left:400px;top:60px;width:32px;height:32px"; document.body.append(b); }
  b.focus();
  const html = String(menuDaPagina({ p: { id: "app1", nome: "Painel", app: { id: "x" } }, pos: 0, total: 3 }));
  abrirMenuDeHtmlNoReact(document, { html, ancora: b, lado: "bottom", alinhar: "start", distancia: 6, classeBase: "pg-menu", semCasca: true, aoEscolher: (bt) => { window.__acaoPg = bt.dataset.act; } });
};
window.__biblioteca = () => {
  window.__ui = null; window.__foi = null; window.__baixou = false; window.__soltou = false;
  let b = document.getElementById("bib-mais");
  if (!b) { b = Object.assign(document.createElement("button"), { id: "bib-mais", textContent: "…" }); b.style.cssText = "position:fixed;left:900px;top:200px;width:32px;height:32px"; document.body.append(b); }
  b.focus();
  abrirMenuDaBibliotecaNoReact(document, { ancora: b, ancoraViva: () => b, nome: "foto.png", baixar: true, aoBaixar: () => { window.__baixou = true; },
    ir: (ui) => { window.__ui = ui; ui.carregando(); return { soltar: () => { window.__soltou = true; } }; },
    irAte: (fala, vizinha) => { window.__foi = fala.id + ":" + vizinha; } });
};
window.__travar = () => { const menus = document.querySelectorAll(".rx-menu"); travarToqueDuploEm(menus[menus.length - 1]); };
window.__menuIa = (html) => {
  window.__ia = null; window.__mudou = [];
  let b = document.getElementById("composer-ia");
  if (!b) { b = Object.assign(document.createElement("button"), { id: "composer-ia", textContent: "Claude" }); b.style.cssText = "position:fixed;left:900px;top:720px;width:80px;height:32px"; document.body.append(b); }
  b.focus();
  window.__menuIaAberto = abrirMenuIaNoReact(document, b, html, (e) => { window.__ia = JSON.stringify(e); }, () => { window.__mudou.push(b.getAttribute("aria-expanded")); });
};
window.__menuModo = () => {
  window.__modo = null;
  let b = document.getElementById("chip-modo");
  if (!b) { b = Object.assign(document.createElement("button"), { id: "chip-modo", textContent: "modo" }); b.style.cssText = "position:fixed;left:300px;top:720px;width:40px;height:32px"; document.body.append(b); }
  b.focus();
  abrirMenuModoNoReact(document, b, "Ada", "manual", (modo, confirmado) => { window.__modo = modo + ":" + confirmado; window.__focoNoModo = document.activeElement?.id; }, false, () => window.__relogio ?? performance.now());
};
window.__menuHtml = (html, extra = {}) => {
  window.__escolha = null; window.__fechou = false;
  let linha = document.getElementById("linha-bot") ?? document.getElementById("antes");
  if (extra.classe === "menu-pilula") {
    linha = document.getElementById("pilula") ?? Object.assign(document.createElement("button"), { id: "pilula", textContent: "Conversa" });
    linha.style.cssText = "position:fixed;left:540px;top:20px;width:200px;height:32px";
    document.body.append(linha);
  }
  linha.focus();
  abrirMenuDeHtmlNoReact(document, { html, ancora: linha, ...extra, aoEscolher: (b) => { window.__escolha = b.dataset.abaAcao ?? b.dataset.acaoTime ?? b.dataset.pos ?? b.dataset.pilula ?? b.dataset.reacao ?? b.dataset.fala ?? "?"; }, aoFechar: () => { window.__fechou = true; } });
};
window.__menuBot = (ponto) => {
  window.__acao = null;
  let linha = document.getElementById("linha-bot");
  if (!linha) {
    linha = document.createElement("button");
    linha.id = "linha-bot"; linha.textContent = "Cecília"; linha.style.cssText = "position:fixed;left:20px;top:100px;width:200px;height:40px";
    const nome = document.createElement("input"); nome.id = "nome-na-gaveta"; nome.style.cssText = "position:fixed;left:20px;top:300px";
    document.body.append(linha, nome);
  }
  linha.focus();
  abrirMenuDoBotNoReact(document, { a: { id: "b1", nome: "Cecília", papel: "bot", fixado: false, naoLido: false, secao: "Dev", oculto: false }, dona: true, ancora: linha, ponto,
    executar: (acao) => { window.__acao = acao; window.__focoNaAcao = document.activeElement?.id; if (acao === "renomear") document.getElementById("nome-na-gaveta").focus(); } });
};
// O artefato: um iframe sandbox de origem opaca (como o de verdade) que conta pela ponte o que se digitou nele.
const DOC_DO_ARTEFATO = '<input id="c" style="font-size:20px"><script>document.getElementById("c").addEventListener("input", (e) => parent.postMessage({ digitado: e.target.value }, "*"));<\\/script>';
window.__digitado = "";
window.addEventListener("message", (e) => { if (e.data && typeof e.data.digitado === "string") window.__digitado = e.data.digitado; });
window.__artefato = () => {
  window.__soltou = false;
  document.getElementById("antes").focus();
  abrirArtefatoNoReact(document, { titulo: "Plano", versao: 2, origem: document.getElementById("antes"), baixar: () => undefined,
    montar: (corpo) => { const f = document.createElement("iframe"); f.className = "artefato-quadro tela-cheia"; f.setAttribute("sandbox", "allow-scripts"); f.srcdoc = DOC_DO_ARTEFATO; f.style.cssText = "width:100%;height:100%;border:0"; corpo.append(f); return () => { window.__soltou = true; }; } });
};
window.__luz = () => {
  const itens = [{ id: "a", nome: "a.png", mime: "image/png", url: "/u/a", w: 1600, h: 900 }, { id: "b", nome: "b.png", mime: "image/png", url: "/u/b", w: 900, h: 1600 }];
  document.getElementById("midias")?.remove();
  const m = document.createElement("div");
  m.id = "midias"; m.dataset.mensagem = "m1"; m.style.cssText = "position:fixed;left:600px;top:450px";
  m.innerHTML = '<div class="msg-midias"><button id="midia-a" data-act="midia-abrir" data-i="0" data-anexo-id="a">a</button></div>';
  m.querySelector(".msg-midias").dataset.luz = JSON.stringify(itens);
  document.body.append(m);
  document.getElementById("midia-a").focus();
  abrirLuzNoReact(document, document.getElementById("midia-a"));
};
// A página é file://: a rota de anexos responde daqui.
window.fetch = async () => new Response("nome,valor\\nana,1\\nbia,2\\n", { status: 200, headers: { "content-length": "24" } });
window.__previa = () => {
  const b = document.createElement("button");
  b.id = "card"; b.dataset.act = "previa-arquivo"; b.dataset.id = "x1"; b.dataset.url = "/api/anexos/x1"; b.dataset.nome = "dados.csv"; b.dataset.mime = "text/csv"; b.textContent = "dados.csv"; b.style.cssText = "position:fixed;left:600px;top:400px";
  document.getElementById("card")?.remove();
  document.body.append(b);
  b.focus();
  abrirPreviaNoReact(document, b);
};
const ITENS = [
  { chave: "bot:a1", grupo: "Bots", titulo: "Cecília", sub: "Dev" },
  { chave: "bot:a2", grupo: "Bots", titulo: "Milton" },
  { chave: "ajuste:tema", grupo: "Ajustes", titulo: "Tema", sub: "Geral › Aparência", icone: "tema" },
  { chave: "acao:novo", grupo: "Ações", titulo: "Novo bot", icone: "mais" },
];
window.__escolhido = null;
window.__paleta = criarPaletaNoReact({ doc: document, itens: () => ITENS, avatar: () => "", executar: (i) => { window.__escolhido = i.chave; } });
window.__confirmar = () => {
  window.__resposta = undefined;
  confirmarNoReact(document, { idDoTitulo: "rodar-mais-uma-titulo", titulo: "Rodar mais uma execução?", texto: "Já há uma na fila.", cancelar: "Cancelar", confirmar: "Rodar mais uma", origem: document.getElementById("antes") })
    .then((r) => { window.__resposta = r; });
};
// QA-162: o Testar agora como no app — o agir() liga o \`ocupado\` (o botão fica disabled) antes de perguntar e só o
// desliga depois da resposta; o foco tem de voltar ao botão quando ele reabilitar, não ficar no <body>.
window.__testarAgora = () => {
  window.__resposta = undefined;
  let b = document.getElementById("testar");
  if (!b) { b = Object.assign(document.createElement("button"), { id: "testar", textContent: "Testar agora", type: "button" }); b.style.cssText = "position:fixed;left:8px;top:340px"; document.body.append(b); }
  b.disabled = false;
  b.focus();
  b.disabled = true;
  setTimeout(() => {
    confirmarNoReact(document, { idDoTitulo: "rodar-mais-uma-titulo", titulo: "Rodar mais uma execução?", texto: "Já há uma na fila.", cancelar: "Cancelar", confirmar: "Rodar mais uma", origem: b })
      .then((r) => { window.__resposta = r; setTimeout(() => { b.disabled = false; }, 30); });
  }, 50);
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
    // O #antes fica fora do fluxo: abaixo do .app (800 px), ele fazia a página rolar, e a barra do Chrome do Linux (15 px,
    // ao contrário da sobreposta do Mac) tirava largura da janela: tudo o que é "centrado" errava por 7 px no CI.
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<button id="antes" style="position:fixed;left:8px;top:300px">antes</button><script>${js.outputFiles.find((f) => f.path.endsWith(".js"))!.text}</script>`);
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
  // A página nunca rola, nem com o que cada teste põe nela (tudo fixo): no Mac a barra é sobreposta e nada muda, mas no
  // Chrome do Linux (o CI) ela come 15 px da largura e tudo o que é "centrado" erra por 7 px.
  const naoRola = async (): Promise<void> => { expect(await avaliar<number>(cdp, "document.documentElement.scrollHeight - innerHeight")).toBeLessThanOrEqual(0); };
  beforeEach(naoRola);
  afterEach(naoRola);
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

  it("QA-162: o Testar agora fica desligado enquanto pergunta; ao cancelar (Esc ou Cancelar) o foco volta ao botão, não ao body", async () => {
    for (const fechar of ["esc", "cancelar"] as const) {
      await avaliar(cdp, "window.__testarAgora()");
      await ate(`document.activeElement?.hasAttribute("data-nao")`);
      if (fechar === "esc") await tecla("Escape", "Escape", 27); else await tecla("Enter", "Enter", 13);
      await ate(`window.__resposta === false`);
      await ate(`!document.querySelector(".rx-dlg-host") && !document.getElementById("testar").disabled`);
      await esperar(150);
      expect(await avaliar<string>(cdp, "document.activeElement?.id || document.activeElement?.tagName")).toBe("testar");
    }
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

  it("a paleta ⌘K: o foco no campo; digitar com acento (composição) filtra; ↓ e Enter abrem o item; Esc fecha e devolve o foco", async () => {
    await esperar(300);
    await avaliar(cdp, `document.getElementById("antes").focus(); window.__paleta.abrir()`);
    await ate(`document.activeElement?.id === "paleta-termo"`);
    // "cecí": o acento por composição (tecla morta), como no teclado brasileiro.
    await cdp.enviar("Input.insertText", { text: "cec" });
    await cdp.enviar("Input.imeSetComposition", { text: "´", selectionStart: 1, selectionEnd: 1 });
    await cdp.enviar("Input.insertText", { text: "í" });
    await ate(`document.getElementById("paleta-termo").value === "cecí"`);
    await ate(`document.querySelectorAll(".paleta-item").length === 1`);
    expect(await avaliar<string>(cdp, `document.querySelector(".paleta-item b").textContent`)).toBe("Cecília");
    // Apaga e anda: com o termo vazio, ↓ marca o 2º e Enter o abre.
    await avaliar(cdp, `(() => { const c = document.getElementById("paleta-termo"); c.select(); })()`);
    await tecla("Backspace", "Backspace", 8);
    await ate(`document.querySelectorAll(".paleta-item").length > 1`);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.getElementById("paleta-termo").getAttribute("aria-activedescendant") === "paleta-i-1"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__escolhido !== null`);
    expect(await avaliar<boolean>(cdp, "window.__paleta.aberta()")).toBe(false);
    await avaliar(cdp, `window.__escolhido = null; document.getElementById("antes").focus(); window.__paleta.abrir()`);
    await ate(`document.activeElement?.id === "paleta-termo"`);
    await tecla("Escape", "Escape", 27);
    await ate(`!window.__paleta.aberta()`);
    await ate(`document.activeElement?.id === "antes"`);
  }, 60_000);

  it("a prévia de arquivo: o foco no ×, o CSV desenhado com a contagem, centrada; Esc fecha e o foco volta ao card", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__previa()");
    await ate(`document.activeElement?.dataset?.previa === "fechar"`);
    await ate(`/ana.*bia/.test(document.querySelector(".previa-csv-corpo .pv-csv-rolagem")?.textContent ?? "")`);
    expect(await avaliar<string>(cdp, `document.querySelector(".previa-contagem").textContent`)).toBe("3 linhas");
    const c = await avaliar<{ cx: number; cy: number }>(cdp, `(() => { const r = document.querySelector(".previa-arquivo.rx-prv").getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
    expect(Math.abs(c.cx - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.cy - 400)).toBeLessThanOrEqual(2);
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector(".rx-prv-host")`);
    await ate(`document.activeElement?.id === "card"`);
  }, 60_000);

  it("a tela cheia da mídia: cobre a tela por cima do app, o foco em Fechar, → anda, Esc fecha e o foco volta à mídia", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__luz()");
    await ate(`document.activeElement?.dataset?.luz === "fechar"`);
    const r = await avaliar<{ w: number; h: number; topo: boolean }>(cdp, `(() => { const p = document.querySelector(".luz.rx-luz"); const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), topo: p.contains(document.elementFromPoint(640, 400)) }; })()`);
    expect(r).toEqual({ w: 1280, h: 800, topo: true });
    await tecla("ArrowRight", "ArrowRight", 39);
    await ate(`document.querySelector(".luz-legenda")?.textContent === "b.png · 2 / 2"`);
    // A imagem em pé cabe na altura do palco (o --ar e o container do palco valem no portal).
    const img = await avaliar<{ w: number; h: number }>(cdp, `(() => { const r = document.querySelector(".luz-midia").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    expect(img.h).toBeGreaterThan(400);
    expect(img.h).toBeLessThanOrEqual(800);
    expect(Math.abs(img.w / img.h - 0.5625)).toBeLessThan(0.02);
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector(".rx-luz-host")`);
    await ate(`document.activeElement?.id === "midia-a"`);
  }, 60_000);

  it("a tela cheia do artefato: centrada; clicar e digitar dentro do iframe (o foco preso do diálogo não o tira de lá); o Esc é do artefato; o ✕ solta e o foco volta", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__artefato()");
    await ate(`document.querySelector(".artefato-dialogo.rx-art iframe")`);
    const r = await avaliar<{ cx: number; cy: number; ix: number; iy: number }>(cdp, `(() => { const r = document.querySelector(".artefato-dialogo.rx-art").getBoundingClientRect(); const i = document.querySelector(".rx-art iframe").getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), ix: Math.round(i.left + 40), iy: Math.round(i.top + 16) }; })()`);
    expect(Math.abs(r.cx - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.cy - 400)).toBeLessThanOrEqual(2);
    await esperar(400);
    for (const type of ["mousePressed", "mouseReleased"] as const) await cdp.enviar("Input.dispatchMouseEvent", { type, x: r.ix, y: r.iy, button: "left", clickCount: 1 });
    await esperar(300);
    await cdp.enviar("Input.insertText", { text: "olá" });
    await ate(`window.__digitado === "olá"`);
    expect(await avaliar<boolean>(cdp, `document.activeElement?.tagName === "IFRAME"`)).toBe(true);
    // O Esc dentro do iframe é do artefato (como no <dialog> nativo): não fecha. O ✕ fecha.
    await tecla("Escape", "Escape", 27);
    await esperar(300);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector(".rx-art-host")`)).toBe(true);
    await avaliar(cdp, `document.querySelector(".rx-art [data-fechar]").click()`);
    await ate(`!document.querySelector(".rx-art-host")`);
    expect(await avaliar<boolean>(cdp, "window.__soltou")).toBe(true);
    await ate(`document.activeElement?.id === "antes"`);
  }, 60_000);

  it("o menu do bot: ao lado da linha, o foco no 1º item; ↓ e Enter fecham e só então a ação roda, com o foco na linha", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__menuBot()");
    await ate(`document.activeElement?.dataset?.gestao === "fixar"`);
    const r = await avaliar<{ left: number; top: number }>(cdp, `(() => { const r = document.querySelector(".bot-menu.rx-menu").getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
    expect(r).toEqual({ left: 220, top: 100 });
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.gestao === "mover"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__acao === "mover"`);
    expect(await avaliar<string>(cdp, "window.__focoNaAcao")).toBe("linha-bot");
    await ate(`!document.querySelector(".rx-menu-host")`);
    await ate(`document.activeElement?.id === "linha-bot"`);
  }, 60_000);

  it("o menu do bot no cursor (clique direito); Renomear leva o foco à gaveta e o menu não o toma de volta; o clique fora fecha sem ação", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__menuBot({ x: 500, y: 200 })");
    await ate(`document.activeElement?.dataset?.gestao === "fixar"`);
    const r = await avaliar<{ left: number; top: number }>(cdp, `(() => { const r = document.querySelector(".bot-menu.rx-menu").getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
    expect(r).toEqual({ left: 504, top: 204 });
    const b = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('[data-gestao="renomear"]').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) await cdp.enviar("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 });
    await ate(`window.__acao === "renomear"`);
    await ate(`!document.querySelector(".rx-menu-host")`);
    await esperar(400);
    expect(await avaliar<string>(cdp, "document.activeElement?.id")).toBe("nome-na-gaveta");
    // Perto da borda de baixo, o menu sobe para caber (desliza, não vira de lado).
    await avaliar(cdp, "window.__menuBot({ x: 500, y: 780 })");
    await ate(`document.activeElement?.dataset?.gestao === "fixar"`);
    const baixo = await avaliar<number>(cdp, `Math.round(document.querySelector(".bot-menu.rx-menu").getBoundingClientRect().bottom)`);
    expect(baixo).toBeLessThanOrEqual(788);
    for (const type of ["mousePressed", "mouseReleased"] as const) await cdp.enviar("Input.dispatchMouseEvent", { type, x: 1200, y: 60, button: "left", clickCount: 1 });
    await ate(`!document.querySelector(".rx-menu-host")`);
    expect(await avaliar<unknown>(cdp, "window.__acao")).toBeNull();
  }, 60_000);

  it("os menus da barra a partir do HTML: o CSS da aba (280 px), o item desligado focável mas inerte, Enter escolhe depois de fechar", async () => {
    await esperar(300);
    const aba = '<div role="menu" class="menu-aba-corpo" aria-label="Ações da tarefa X"><p class="menu-nome">Esta tarefa</p><button type="button" role="menuitem" data-aba-acao="renomear">Renomear<span class="at-menu-dica">· duplo clique</span></button><button type="button" role="menuitem" data-aba-acao="fechar">Fechar aba</button></div>';
    await avaliar(cdp, `window.__menuHtml(${JSON.stringify(aba)})`);
    await ate(`document.activeElement?.dataset?.abaAcao === "renomear"`);
    expect(await avaliar<number>(cdp, `Math.round(document.querySelector(".bot-menu.rx-menu").getBoundingClientRect().width)`)).toBe(280);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.abaAcao === "fechar"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__escolha === "fechar"`);
    expect(await avaliar<boolean>(cdp, "window.__fechou")).toBe(true);
    await esperar(300);
    const time = '<div role="menu" aria-label="Ações do time Dev"><p class="menu-nome">Dev</p><button type="button" role="menuitem" data-acao-time="subir" disabled>Mover para cima</button><button type="button" role="menuitem" data-acao-time="renomear">Renomear</button><button type="button" role="menuitem" data-acao-time="excluir" class="danger">Excluir</button></div>';
    await avaliar(cdp, `window.__menuHtml(${JSON.stringify(time)})`);
    await ate(`document.activeElement?.dataset?.acaoTime === "renomear"`);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.acaoTime === "excluir"`);
    // O desligado é focável (APG: o leitor de tela ouve que a opção existe), mas Enter nele não escolhe.
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.acaoTime === "subir"`);
    expect(await avaliar<string>(cdp, `document.activeElement.getAttribute("aria-disabled")`)).toBe("true");
    await tecla("Enter", "Enter", 13);
    await esperar(200);
    expect(await avaliar<unknown>(cdp, "window.__escolha")).toBeNull();
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector(".rx-menu-host")`);
    expect(await avaliar<unknown>(cdp, "window.__escolha")).toBeNull();
  }, 60_000);

  it("o menu da pílula: centrado 8 px abaixo dela, as páginas como menuitemradio (a atual marcada), ↓ e Enter vão à página", async () => {
    await esperar(300);
    const html = '<div role="menu" aria-label="Conversa"><button type="button" role="menuitem" data-pilula="buscar">Buscar na conversa</button><button type="button" role="menuitemradio" data-pilula="pagina" data-pos="0" aria-checked="true">Conversa</button><button type="button" role="menuitemradio" data-pilula="pagina" data-pos="1" aria-checked="false">Tarefa NOD-7</button></div>';
    await avaliar(cdp, `window.__menuHtml(${JSON.stringify(html)}, { lado: "bottom", alinhar: "center", distancia: 8, classe: "menu-pilula" })`);
    await ate(`document.activeElement?.dataset?.pilula === "buscar"`);
    const r = await avaliar<{ cx: number; top: number; acx: number; abottom: number; papeis: string[]; marcado: string | null }>(cdp, `(() => { const m = document.querySelector(".bot-menu.rx-menu.menu-pilula").getBoundingClientRect(); const a = document.getElementById("pilula").getBoundingClientRect();
      return { cx: Math.round(m.left + m.width / 2), top: Math.round(m.top), acx: Math.round(a.left + a.width / 2), abottom: Math.round(a.bottom), papeis: [...document.querySelectorAll(".rx-menu [data-pilula]")].map((b) => b.getAttribute("role")), marcado: document.querySelector('.rx-menu [aria-checked="true"]')?.dataset.pos ?? null }; })()`);
    expect(Math.abs(r.cx - r.acx)).toBeLessThanOrEqual(1);
    expect(r.top).toBe(r.abottom + 8);
    expect(r.papeis).toEqual(["menuitem", "menuitemradio", "menuitemradio"]);
    expect(r.marcado).toBe("0");
    await tecla("ArrowDown", "ArrowDown", 40);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.pos === "1"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__escolha === "1"`);
  }, 60_000);

  it("o menu da fala: o + troca a linha de emojis sem fechar (o foco no 1º), ← → andam, o desligado não escolhe, o emoji escolhe", async () => {
    await esperar(300);
    const emoji = (e: string, marcado = false) => `<button type="button" role="menuitemcheckbox" class="emoji-reacao" data-reacao="${e}" aria-checked="${marcado}" aria-label="${e}" title="${e}">${e}</button>`;
    const linha = (todas: boolean) => `<div class="linha-emojis${todas ? " todas" : ""}" role="group" aria-label="Reagir">${["👍", "❤️"].map((e, i) => emoji(e, i === 0)).join("")}${todas ? emoji("🎉") + emoji("👀") : '<button type="button" role="menuitem" class="emoji-mais" data-reacao-mais aria-label="Mais emojis" title="Mais emojis">+</button>'}</div>`;
    const html = `<div role="menu" aria-label="Mais ações da mensagem">${linha(false)}<button type="button" role="menuitem" data-fala="copiar">Copiar texto</button><button type="button" role="menuitem" data-fala="desfazer" class="dft-mi" aria-disabled="true">Desfazer</button></div>`;
    await avaliar(cdp, `window.__linhaToda = ${JSON.stringify(linha(true))}; window.__menuHtml(${JSON.stringify(html)}, { lado: "bottom", alinhar: "start", distancia: 6, classe: "menu-fala", setasDosLados: true, rotulo: "Mais ações da mensagem",
      expandir: { seletor: "[data-reacao-mais]", html: () => ${JSON.stringify(html)}.replace(/<div class="linha-emojis[\\s\\S]*?<\\/div>/, window.__linhaToda), focar: ".linha-emojis button" } })`);
    await ate(`document.activeElement?.dataset?.reacao === "👍"`);
    expect(await avaliar<string | null>(cdp, `document.activeElement.getAttribute("role") + ":" + document.activeElement.getAttribute("aria-checked")`)).toBe("menuitemcheckbox:true");
    await tecla("ArrowRight", "ArrowRight", 39);
    await ate(`document.activeElement?.dataset?.reacao === "❤️"`);
    await tecla("ArrowRight", "ArrowRight", 39);
    await ate(`document.activeElement?.hasAttribute("data-reacao-mais")`);
    await tecla("Enter", "Enter", 13);
    await ate(`document.querySelectorAll(".rx-menu .linha-emojis.todas button").length === 4`);
    await ate(`document.activeElement?.dataset?.reacao === "👍"`);
    expect(await avaliar<unknown>(cdp, "window.__escolha")).toBeNull();
    await tecla("ArrowLeft", "ArrowLeft", 37);
    await ate(`document.activeElement?.dataset?.fala === "desfazer"`);
    await tecla("Enter", "Enter", 13);
    await esperar(200);
    expect(await avaliar<unknown>(cdp, "window.__escolha")).toBeNull();
    await tecla("ArrowRight", "ArrowRight", 39);
    await tecla("ArrowRight", "ArrowRight", 39);
    await ate(`document.activeElement?.dataset?.reacao === "❤️"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__escolha === "❤️"`);
    await ate(`!document.querySelector(".rx-menu-host")`);
  }, 60_000);

  it("o menu do modo: acima do botão com o foco no atual; o total abre a confirmação (foco em Agora não); Esc fecha só ela; o clique apressado não conta; confirmar escolhe", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__menuModo()");
    await ate(`document.activeElement?.dataset?.modo === "manual"`);
    await ate(`Math.round(document.querySelector(".bot-menu.rx-menu.modo-menu")?.getBoundingClientRect().bottom ?? 0) === 712`);
    const r = await avaliar<{ fundo: number; esquerda: number }>(cdp, `(() => { const m = document.querySelector(".bot-menu.rx-menu.modo-menu").getBoundingClientRect(); return { fundo: Math.round(m.bottom), esquerda: Math.round(m.left) }; })()`);
    expect(r).toEqual({ fundo: 712, esquerda: 300 });
    await tecla("ArrowDown", "ArrowDown", 40);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.modo === "total"`);
    await tecla("Enter", "Enter", 13);
    await ate(`document.activeElement?.dataset?.confirma === "nao"`);
    expect(await avaliar<string | null>(cdp, `document.querySelector('.rx-menu [data-modo="total"]').getAttribute("aria-expanded")`)).toBe("true");
    // O menu cresceu e continua acima do botão: o Base UI reposiciona no quadro seguinte ao crescimento (no CI, mais lento,
    // a medida logo depois do foco ainda pega o topo antigo), então espera assentar.
    await ate(`Math.round(document.querySelector(".modo-menu.rx-menu")?.getBoundingClientRect().bottom ?? 0) === 712`);
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector(".rx-menu .modo-confirma")`);
    await ate(`document.activeElement?.dataset?.modo === "total"`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector(".rx-menu-host")`)).toBe(true);
    // O relógio do menu fica parado enquanto a confirmação abre e o clique apressado chega: o tempo das idas e voltas ao
    // Chrome (que no CI passa dos 500 ms) não decide o teste. Depois anda 600 ms, e o clique seguinte conta.
    await avaliar(cdp, "window.__relogio = performance.now()");
    await tecla("Enter", "Enter", 13);
    await ate(`document.querySelector('.rx-menu [data-confirma="sim"]')`);
    // A confirmação fez o menu crescer: o centro do Sim só vale depois de o Base UI o reposicionar (senão o clique cai
    // fora do menu, no lugar antigo, e o fecha).
    await ate(`Math.round(document.querySelector(".modo-menu.rx-menu")?.getBoundingClientRect().bottom ?? 0) === 712`);
    const sim = async () => {
      const p = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('.rx-menu [data-confirma="sim"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) await cdp.enviar("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
    };
    // Logo depois de a confirmação abrir, o clique não conta (o segundo de um duplo clique).
    await sim();
    await esperar(150);
    expect(await avaliar<unknown>(cdp, "window.__modo")).toBeNull();
    await avaliar(cdp, "window.__relogio += 600");
    await sim();
    await ate(`window.__modo === "total:true"`);
    await avaliar(cdp, "window.__relogio = null");
    expect(await avaliar<string>(cdp, "window.__focoNoModo")).toBe("chip-modo");
    await ate(`!document.querySelector(".rx-menu-host")`);
    expect(await avaliar<string | null>(cdp, `document.getElementById("chip-modo").getAttribute("aria-expanded")`)).toBe("false");
  }, 60_000);

  it("o seletor de IA: acima do botão e alinhado à direita, o foco na escolha atual, o desligado inerte, a escolha pelo dataset; o aria-expanded redesenha a seta", async () => {
    await esperar(300);
    const html = '<div role="menu" aria-label="IA e modelo"><button type="button" role="menuitemradio" data-escolha="auto" aria-checked="false">Automático</button><p class="ia-sel-grupo">Claude</p><button type="button" role="menuitemradio" data-escolha="modelo" data-ia="claude-cli" data-modelo="opus" aria-checked="true">Opus</button><button type="button" role="menuitemradio" data-escolha="modelo" data-ia="codex-cli" data-modelo="gpt" aria-checked="false" disabled>GPT</button><button type="button" role="menuitem" data-escolha="provedores">Provedores de IA</button></div>';
    await avaliar(cdp, `window.__menuIa(${JSON.stringify(html)})`);
    await ate(`document.activeElement?.dataset?.modelo === "opus"`);
    await ate(`Math.round(document.querySelector(".bot-menu.rx-menu.ia-sel-menu")?.getBoundingClientRect().bottom ?? 0) === 712`);
    const r = await avaliar<{ fundo: number; direita: number }>(cdp, `(() => { const m = document.querySelector(".bot-menu.rx-menu.ia-sel-menu").getBoundingClientRect(); return { fundo: Math.round(m.bottom), direita: Math.round(m.right) }; })()`);
    expect(r).toEqual({ fundo: 712, direita: 980 });
    expect(await avaliar<string[]>(cdp, "window.__mudou")).toEqual(["true"]);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.modelo === "gpt"`);
    await tecla("Enter", "Enter", 13);
    await esperar(200);
    expect(await avaliar<unknown>(cdp, "window.__ia")).toBeNull();
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.escolha === "provedores"`);
    await tecla("ArrowUp", "ArrowUp", 38);
    await tecla("ArrowUp", "ArrowUp", 38);
    await ate(`document.activeElement?.dataset?.modelo === "opus"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__ia !== null`);
    expect(JSON.parse(await avaliar<string>(cdp, "window.__ia"))).toEqual({ tipo: "modelo", ia: "claude-cli", modelo: "opus" });
    expect(await avaliar<string[]>(cdp, "window.__mudou")).toEqual(["true", "false"]);
    await ate(`document.activeElement?.id === "composer-ia"`);
    // Fechar por código (o campo trocou de conversa com o menu aberto): sai sem escolha.
    await esperar(300);
    await avaliar(cdp, `window.__menuIa(${JSON.stringify(html)})`);
    await ate(`document.querySelector(".ia-sel-menu.rx-menu")`);
    await avaliar(cdp, "window.__menuIaAberto.fechar()");
    await ate(`!document.querySelector(".rx-menu-host")`);
    expect(await avaliar<unknown>(cdp, "window.__ia")).toBeNull();
  }, 60_000);

  it("a trava do toque duplo (a folha + do celular) vale no popup do Base UI: o toque cedo demais não escolhe; o de depois, sim", async () => {
    await esperar(300);
    const html = '<div role="menu" aria-label="IA e modelo"><button type="button" role="menuitemradio" data-escolha="auto" aria-checked="true">Automático</button></div>';
    await avaliar(cdp, `window.__menuIa(${JSON.stringify(html)})`);
    await ate(`document.querySelector(".ia-sel-menu.rx-menu [data-escolha]")`);
    await avaliar(cdp, "window.__travar()");
    const p = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('.rx-menu [data-escolha="auto"]').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
    const tocar = async () => { for (const type of ["mousePressed", "mouseReleased"] as const) await cdp.enviar("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
    await tocar();
    await esperar(150);
    expect(await avaliar<unknown>(cdp, "window.__ia")).toBeNull();
    expect(await avaliar<boolean>(cdp, `!!document.querySelector(".rx-menu-host")`)).toBe(true);
    await esperar(600);
    await tocar();
    await ate(`window.__ia !== null`);
    expect(JSON.parse(await avaliar<string>(cdp, "window.__ia"))).toEqual({ tipo: "auto" });
  }, 60_000);

  it("o menu da Biblioteca: embaixo do …, alinhado à direita; o Ir carregando fica desligado e focável; a falha mostra a nota com o foco; depois, ir até a fala fecha", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__biblioteca()");
    await ate(`document.activeElement?.dataset?.gestao === "baixar"`);
    const r = await avaliar<{ topo: number; direita: number }>(cdp, `(() => { const m = document.querySelector(".bot-menu.rx-menu.menu-compartilhar").getBoundingClientRect(); return { topo: Math.round(m.top), direita: Math.round(m.right) }; })()`);
    expect(r).toEqual({ topo: 238, direita: 932 });
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.gestao === "ir"`);
    await tecla("Enter", "Enter", 13);
    await ate(`document.activeElement?.textContent === "Carregando…" && document.activeElement.getAttribute("aria-disabled") === "true"`);
    expect(await avaliar<string>(cdp, `document.querySelector(".rx-menu .menu-status").textContent`)).toBe("Carregando…");
    await avaliar(cdp, "window.__ui.falhou(false)");
    await ate(`document.activeElement?.classList.contains("menu-nota")`);
    expect(await avaliar<string>(cdp, `document.activeElement.textContent`)).toContain("demorou");
    expect(await avaliar<string>(cdp, `document.querySelector('.rx-menu [data-gestao="ir"]').textContent`)).toBe("Ir para a mensagem");
    await avaliar(cdp, `(() => { const f = Object.assign(document.createElement("div"), { id: "fala-1" }); document.body.append(f); window.__ui.irAte(f, true); })()`);
    await ate(`!document.querySelector(".rx-menu-host")`);
    expect(await avaliar<string>(cdp, "window.__foi")).toBe("fala-1:true");
    expect(await avaliar<boolean>(cdp, "window.__soltou")).toBe(true);
    expect(await avaliar<string | null>(cdp, `document.getElementById("bib-mais").getAttribute("aria-expanded")`)).toBe("false");
    expect(await avaliar<boolean>(cdp, "window.__ui.aberto()")).toBe(false);
  }, 60_000);

  it("o menu da página do Quadro: o popup é o .pg-menu (sem a casca do bot-menu), embaixo do ícone; o desligado inerte; a escolha leva o data-act", async () => {
    await esperar(300);
    await avaliar(cdp, "window.__menuPagina()");
    await ate(`document.activeElement?.dataset?.act === "pagina-depois"`);
    const r = await avaliar<{ topo: number; esquerda: number; casca: boolean; filhos: string[]; posicao: string }>(cdp, `(() => { const m = document.querySelector(".pg-menu.rx-menu"); const r = m.getBoundingClientRect();
      return { topo: Math.round(r.top), esquerda: Math.round(r.left), casca: !!document.querySelector(".rx-menu .bot-menu, .bot-menu.rx-menu, .rx-menu #pg-menu"), filhos: [...m.children].map((c) => c.className), posicao: getComputedStyle(m).position }; })()`);
    expect(r).toEqual({ topo: 98, esquerda: 400, casca: false, filhos: ["pg-menu-it", "pg-menu-it", "pg-menu-it", "pg-menu-traco", "pg-menu-it pg-menu-perigo"], posicao: "static" });
    await tecla("ArrowUp", "ArrowUp", 38);
    await ate(`document.activeElement?.dataset?.act === "pagina-antes"`);
    await tecla("Enter", "Enter", 13);
    await esperar(200);
    expect(await avaliar<unknown>(cdp, "window.__acaoPg")).toBeNull();
    await tecla("ArrowDown", "ArrowDown", 40);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.activeElement?.dataset?.act === "app-editar"`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__acaoPg === "app-editar"`);
    await ate(`document.activeElement?.id === "pg-ic"`);
  }, 60_000);
});

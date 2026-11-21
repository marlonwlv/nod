import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * Fase 5 da ADR-179 / ADR-180 (decisão 2, item 6): a grade do quadro em React (`gradeReact`, a chave ligada) no Chrome de verdade,
 * arrastando por PONTEIRO (Input.dispatchMouseEvent, como a mão: o dnd-kit não ouve o arrasto nativo do HTML). É o par das
 * jornadas que arrastam pelo evento nativo — quadro-jornada (o campo Responder dentro do card arrastável), quadro-composer
 * (soltar arquivo no quadro) e quadro-rolagem (a releitura no meio do arrasto) —, que seguem valendo para a grade por
 * string (`?quadro-react=0`; quem monta o quadro sem `gradeReact` tem a por string). Aqui, com o quadro-na-tela, o CSS e o JS do app e uma API falsa na página (sem servidor):
 *  - arrastar um card até outra coluna: o flutuante e a dica no meio, o `mudarTarefa` com a coluna ao soltar;
 *  - a releitura que chega no meio do arrasto: a grade é o mesmo nó (o desenho grava em volta dela) e o arrasto termina;
 *  - apertar no Responder e arrastar seleciona o texto e não pega o card;
 *  - soltar um arquivo no quadro anexa na pílula (o dnd-kit não come o arrasto nativo de arquivo);
 *  - o "Mover para…" pelo teclado: Enter abre, a seta escolhe, Enter move; Esc fecha e devolve o foco ao botão.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADR-180: o CI precisa do Chrome para provar a grade do quadro em React (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
const agora = 1_700_000_000_000;
const STS = ["backlog", "afazer", "fazendo", "revisao", "bloqueado", "feito"];
const tarefa = (i) => ({ id: "t" + i, quadroId: "q1", titulo: "Tarefa " + i, descricao: "", status: STS[i % STS.length], agenteId: null, ordem: i,
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: null });
let tarefas = Array.from({ length: 40 }, (_, i) => tarefa(i));
// t1 em Bloqueado: o Responder no card (NOD-420), como o da quadro-jornada.
tarefas[1] = { ...tarefas[1], status: "bloqueado", agenteId: "a", agenteNome: "Ada" };
let versao = 0;
const q = () => ({ id: "q1", agenteId: "a", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora + versao,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: tarefas.length, tarefas: tarefas.map((t) => ({ ...t })) });
window.__mudancas = [];
window.__lidas = 0;
window.__fila = [];
const api = {
  quadro: async () => { window.__lidas++; return { quadro: q() }; },
  conversa: async () => ({ mensagens: [] }),
  mudarTarefa: async (_a, id, campos) => { window.__mudancas.push([id, campos.status]); tarefas = tarefas.map((t) => (t.id === id ? { ...t, ...campos } : t)); versao++; return { quadro: q() }; },
  enviar: async () => ({ ids: { mensagem: "m9" } }),
  trabalhosDaTarefa: async () => ({ execucoes: [], recados: [], conversaId: "c1", semAgente: false }),
  historicoTarefa: async () => ({ historico: [] }),
  comentariosDaTarefa: async () => ({ comentarios: [], atividade: [], criadaPor: null, runs: [] }),
  passosDoRun: async () => ({ passos: [], fim: true }),
  // Com a passagem, os cards nascem arrastáveis (o arrasto entre colunas).
  definirPassagem: async () => ({ quadro: q() }),
};
const frame = (tipo, dados) => window.__q.aoFrame({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados });
// A releitura que chega no meio de um arrasto: outra tarefa mudou (o quadro volta com outra versão).
// A t3 (Em revisão) é a que muda: a t5 está no Feito, que começa recolhido (Paper K6-a), e o card dela não aparece.
window.__mudou = () => { versao++; tarefas = tarefas.map((t) => (t.id === "t3" ? { ...t, titulo: "Tarefa 3 (editada " + versao + ")" } : t)); frame("quadro.mudou", { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "t3" }); };
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, gradeReact: true, dados: { api: () => api, agente: () => ({ avatar: "<span>A</span>", nome: "Ada" }),
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10, agentes: () => [{ id: "a", nome: "Ada" }],
    composer: { celular: () => false, sugestoes: () => [], anexos: { aceita: () => "tudo", adicionar: (fs) => { for (const f of fs) window.__fila.push(f.name); },
      prontos: () => [], quantos: () => window.__fila.length, retirar: () => ({ confirmar: () => {}, devolver: () => {} }) } } } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
`;

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

descrever("ADR-180: a grade do quadro em React no Chrome real, arrastando por ponteiro", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-grade-rx-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent",
      jsx: "automatic", outdir: dir, loader: { ".css": "empty" } });
    let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
    // As folhas do app, inclusive as de componente (web/react/quadro/grade-do-quadro.css), embutidas.
    html = html.replace(/<link rel="stylesheet" href="\/([\w/-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles.find((f) => f.path.endsWith(".js"))!.text}</script>`);
    writeFileSync(join(dir, "p.html"), html);
    url = pathToFileURL(join(dir, "p.html")).href;
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Runtime.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  const ate = async (expr: string): Promise<void> => {
    for (let i = 0; i < 100; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const mouse = async (type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number, apertado: boolean): Promise<void> => {
    await cdp.enviar("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !apertado ? "none" : "left", buttons: apertado ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "mouse" });
  };
  const tecla = async (key: string, code: string, vk: number): Promise<void> => {
    await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    // O Enter ativa o botão pelo `char` (como a tecla de verdade), não só pelo keydown.
    if (key === "Enter") await cdp.enviar("Input.dispatchKeyEvent", { type: "char", key, code, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: vk });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  /** O ponto de pegar um card (no corpo, fora dos botões do canto) e o de soltar (perto do topo da coluna de destino). */
  const pontos = (tarefa: string, para: string) => avaliar<{ x: number; y: number; x1: number; y1: number }>(cdp, `(() => {
    const card = document.querySelector('#quadro li.qd-card[data-tarefa="${tarefa}"]'); card.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = card.getBoundingClientRect(); const c = document.querySelector('#quadro section.qd-col[data-coluna="${para}"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.35), y: Math.round(r.top + Math.min(r.height / 2, 18)), x1: Math.round(c.left + c.width / 2), y1: Math.round(c.top + 80) }; })()`);

  async function montar(): Promise<void> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector("#quadro [data-react-regiao='quadro-grade'] li.qd-card[data-rx-arrasta]")`);
    await esperar(150);
  }

  it("a grade é a do React, os cards arrastam por ponteiro e soltar leva a coluna ao mudarTarefa; o flutuante e a dica aparecem no meio", async () => {
    await montar();
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#quadro .qd-so-largo li.qd-card[draggable='true']").length`), "a grade por string não está na tela").toBe(0);
    const p = await pontos("t0", "afazer");
    await mouse("mouseMoved", p.x, p.y, false);
    await mouse("mousePressed", p.x, p.y, true);
    for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", Math.round(p.x + ((p.x1 - p.x) * i) / 8), Math.round(p.y + ((p.y1 - p.y) * i) / 8), true); await esperar(16); }
    const meio = await avaliar<{ flutuantes: number; alvo: boolean; arrastando: boolean }>(cdp, `({ flutuantes: document.querySelectorAll(".rx-qd-flutuante").length,
      alvo: !!document.querySelector('#quadro section.qd-col[data-coluna="afazer"].qd-alvo'), arrastando: !!document.querySelector('#quadro li.qd-card[data-tarefa="t0"].qd-arrastando') })`);
    expect(meio).toEqual({ flutuantes: 1, alvo: true, arrastando: true });
    await mouse("mouseReleased", p.x1, p.y1, false);
    await ate(`window.__mudancas.length > 0`);
    expect(await avaliar<unknown[]>(cdp, "window.__mudancas")).toEqual([["t0", "afazer"]]);
    await ate(`document.querySelector('#quadro section.qd-col[data-coluna="afazer"] li.qd-card[data-tarefa="t0"]')`);
    expect(await avaliar<number>(cdp, `document.querySelectorAll(".rx-qd-flutuante").length`)).toBe(0);
  }, 60_000);

  it("a releitura que chega no meio do arrasto espera soltar (o gesto segura, como na grade por string); depois, a grade é o mesmo nó e o card foi", async () => {
    await montar();
    await avaliar(cdp, `window.__grade = document.querySelector("#quadro [data-react-regiao='quadro-grade']"); window.__saiu = 0;
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) if (n === window.__grade) window.__saiu++; }).observe(document.querySelector("#quadro > .qd-conteudo"), { childList: true })`);
    const p = await pontos("t2", "bloqueado");
    await mouse("mouseMoved", p.x, p.y, false);
    await mouse("mousePressed", p.x, p.y, true);
    await mouse("mouseMoved", p.x + 12, p.y + 4, true);
    await mouse("mouseMoved", Math.round((p.x + p.x1) / 2), Math.round((p.y + p.y1) / 2), true);
    await avaliar(cdp, "window.__mudou()");
    // Um respiro longo no meio do arrasto (passa do GESTO_MS): o arrasto segue vivo, o flutuante e o card de origem no lugar.
    await esperar(1500);
    const durante = await avaliar<{ card: boolean; flutuantes: number; editada: boolean }>(cdp, `({ card: !!document.querySelector('#quadro li.qd-card[data-tarefa="t2"]')?.isConnected,
      flutuantes: document.querySelectorAll(".rx-qd-flutuante").length, editada: /editada/.test(document.querySelector('#quadro li.qd-card[data-tarefa="t3"]')?.textContent ?? "") })`);
    expect(durante.card).toBe(true);
    expect(durante.flutuantes).toBe(1);
    // O dnd-kit rola a grade sozinho com o ponteiro perto da borda: o destino é medido de novo antes de soltar, na parte
    // do Bloqueado que aparece (as tiras presas à direita, Feito e Cancelado, cobrem o fim da grade que rola por baixo).
    const d = await avaliar<{ x: number; y: number }>(cdp, `(() => { const c = document.querySelector('#quadro section.qd-col[data-coluna="bloqueado"]').getBoundingClientRect();
      const g = document.querySelector('#quadro .qd-grade').getBoundingClientRect();
      const presas = [...document.querySelectorAll('#quadro .qd-grade > .qd-fixa')].map((e) => e.getBoundingClientRect().left - 10);
      const fim = Math.min(c.right, g.right, ...presas), inicio = Math.max(c.left, g.left);
      return { x: Math.round((inicio + fim) / 2), y: Math.round(c.top + 80) }; })()`);
    await mouse("mouseMoved", d.x, d.y, true);
    await esperar(50);
    await mouse("mouseReleased", d.x, d.y, false);
    await ate(`window.__mudancas.some((m) => m[0] === "t2")`);
    expect(await avaliar<unknown[]>(cdp, `window.__mudancas.find((m) => m[0] === "t2")`)).toEqual(["t2", "bloqueado"]);
    // A releitura chega (no meio, se o gesto a soltou; ou logo depois): a t3 editada, e a grade nunca saiu do documento.
    await ate(`/editada/.test(document.querySelector('#quadro li.qd-card[data-tarefa="t3"]')?.textContent ?? "")`);
    await ate(`document.querySelector('#quadro section.qd-col[data-coluna="bloqueado"] li.qd-card[data-tarefa="t2"]')`);
    expect(await avaliar<{ mesmo: boolean; saiu: number }>(cdp, `({ mesmo: document.querySelector("#quadro [data-react-regiao='quadro-grade']") === window.__grade, saiu: window.__saiu })`))
      .toEqual({ mesmo: true, saiu: 0 });
  }, 60_000);

  it("apertar no Responder do card e arrastar seleciona o texto e não pega o card (o par do NOD-420 da quadro-jornada)", async () => {
    await montar();
    const campo = `#quadro li.qd-card[data-tarefa="t1"] textarea`;
    await ate(`document.querySelector('${campo}')`);
    const r = await avaliar<{ x: number; y: number; w: number; h: number }>(cdp, `(() => { const t = document.querySelector('${campo}'); t.scrollIntoView({ block: "center" });
      const b = t.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    await mouse("mouseMoved", r.x + r.w / 2, r.y + r.h / 2, false);
    await mouse("mousePressed", r.x + r.w / 2, r.y + r.h / 2, true);
    await mouse("mouseReleased", r.x + r.w / 2, r.y + r.h / 2, false);
    expect(await avaliar<string>(cdp, `document.activeElement?.tagName ?? ""`)).toBe("TEXTAREA");
    await cdp.enviar("Input.insertText", { text: "Pode publicar sim" });
    const r1 = await avaliar<{ x: number; y: number; w: number; h: number }>(cdp, `(() => { const b = document.querySelector('${campo}').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    await mouse("mouseMoved", r1.x + 6, r1.y + 10, false);
    await mouse("mousePressed", r1.x + 6, r1.y + 10, true);
    for (const f of [0.25, 0.5, 0.75, 1]) await mouse("mouseMoved", r1.x + 6 + (r1.w - 10) * f, r1.y + 10 + (r1.h - 16) * f, true);
    await mouse("mouseReleased", r1.x + r1.w - 4, r1.y + r1.h - 6, false);
    const sel = await avaliar<{ ini: number; fim: number; flutuantes: number; mudancas: number; valor: string }>(cdp, `(() => { const t = document.querySelector('${campo}');
      return { ini: t.selectionStart, fim: t.selectionEnd, flutuantes: document.querySelectorAll(".rx-qd-flutuante").length, mudancas: window.__mudancas.length, valor: t.value }; })()`);
    expect(sel.flutuantes).toBe(0);
    expect(sel.mudancas).toBe(0);
    expect(sel.valor).toBe("Pode publicar sim");
    expect(sel.fim - sel.ini).toBeGreaterThan(5);
  }, 60_000);

  it("soltar um arquivo no quadro anexa na pílula: o dnd-kit não come o arrasto nativo de arquivo (o par da quadro-composer)", async () => {
    await montar();
    const r = await avaliar<{ impedido: boolean }>(cdp, `(() => {
      const dt = new DataTransfer(); dt.items.add(new File(["x"], "solto.png", { type: "image/png" }));
      const alvo = document.querySelector('#quadro section.qd-col[data-coluna="afazer"]');
      alvo.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      alvo.dispatchEvent(ev);
      return { impedido: ev.defaultPrevented };
    })()`);
    expect(r.impedido).toBe(true);
    expect(await avaliar<string[]>(cdp, "window.__fila")).toEqual(["solto.png"]);
    expect(await avaliar<unknown[]>(cdp, "window.__mudancas")).toEqual([]);
  }, 60_000);

  it("Mover para… pelo teclado: Enter abre o menu único, a seta escolhe e Enter move; Esc fecha e devolve o foco ao botão", async () => {
    await montar();
    const bt = `#quadro li.qd-card[data-tarefa="t3"] .rx-qd-mover`;
    await avaliar(cdp, `document.querySelector('${bt}').focus()`);
    await tecla("Enter", "Enter", 13);
    const aberto = `document.querySelector('[role="menu"]:not([data-closed])')`;
    await ate(aberto);
    expect(await avaliar<number>(cdp, `document.querySelectorAll('[role="menu"]').length`), "um menu só para a grade").toBe(1);
    expect(await avaliar<string | null>(cdp, `document.querySelector('${bt}').getAttribute("aria-expanded")`)).toBe("true");
    // Esc fecha e o foco fica (ou volta) no botão do card.
    await esperar(150);
    await tecla("Escape", "Escape", 27);
    await ate(`!${aberto}`);
    await ate(`document.activeElement === document.querySelector('${bt}')`);
    await tecla("Enter", "Enter", 13);
    await ate(aberto);
    await esperar(150);
    await tecla("ArrowDown", "ArrowDown", 40);
    await ate(`document.querySelector('[role="menu"]:not([data-closed]) [role="menuitem"][data-highlighted]')`);
    const escolhido = await avaliar<string>(cdp, `document.querySelector('[role="menu"]:not([data-closed]) [role="menuitem"][data-highlighted]').textContent`);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__mudancas.some((m) => m[0] === "t3")`);
    const [, coluna] = await avaliar<[string, string]>(cdp, `window.__mudancas.find((m) => m[0] === "t3")`);
    expect(coluna).not.toBe("revisao");
    expect(escolhido.length).toBeGreaterThan(0);
  }, 60_000);
});

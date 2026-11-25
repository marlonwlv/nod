// O cenário "quadro" do teste de carga da tela (definido em 2026-11-12, fase 0 da migração do front): o quadro do bot
// pesado à vista com TAREFAS cards, os outros bots escrevendo (cada turno que começa ou acaba é um frame que o quadro
// ouvia) e a pessoa arrastando cards entre duas colunas — às vezes dois arrastos seguidos, o segundo ainda com o
// primeiro no ar. Mede, além do que o medir.ts já mede: quantas vezes a grade foi regravada, quantos GET do quadro a
// aba fez e quantos arrastos chegaram ao servidor (o resto foi descartado na tela).
//
// Fase 5 da ADR-179 (2026-11-19): mede também ABRIR o quadro (o clique em Tarefas até os cards pintados, com a leitura
// do servidor à parte) e, em cada arrasto, o servidor × a tela: quanto o PATCH da tarefa levou e quanto a tela levou do
// soltar até o card aparecer na coluna nova. A grade em React (`?quadro-react=1`, dnd-kit) não ouve o arrasto nativo do
// HTML: com ela, o arrasto vai por ponteiro de verdade (Input.dispatchMouseEvent), como a mão da pessoa.
import { avaliar, type Cdp } from "./cdp.ts";
import { api, escrever, type Bot, type Sessao } from "./comum.ts";

const TAREFAS = Number(process.env.CARGA_TAREFAS ?? 24);
/** Intervalo entre arrastos; a cada PAR_A_CADA, um segundo arrasto sai PAR_MS depois do primeiro. */
const ARRASTO_MS = Number(process.env.CARGA_ARRASTO_MS ?? 1200);
const PAR_A_CADA = 3;
const PAR_MS = 150;
/** Quantas vezes abrir o quadro de novo (Conversa → Quadro) depois da 1ª abertura, para a mediana. */
const REABERTURAS = Number(process.env.CARGA_REABERTURAS ?? 4);
/** As duas colunas do vaivém: abertas no quadro novo e sem passagem, então soltar nelas não começa trabalho. */
export const COLUNA_A = "revisao";
export const COLUNA_B = "bloqueado";

type TarefaApi = { id: string; status: string };

/** Liga o experimento, cria o quadro do bot pesado e as tarefas (metade em cada coluna). Roda no banco recém-copiado. */
export async function prepararQuadro(s: Sessao, pesada: Bot): Promise<void> {
  await api(s, "PUT", "preferencias", { experimentos: { quadro: true } });
  try {
    await api(s, "POST", `agentes/${pesada.id}/quadro`, { nome: "Carga" });
  } catch {
    // já existe
  }
  for (let i = 0; i < TAREFAS; i++) {
    await api(s, "POST", `agentes/${pesada.id}/quadro/tarefas`, { titulo: `Tarefa de carga ${i + 1}`, status: i % 2 ? COLUNA_B : COLUNA_A, agente: null });
  }
}

export async function tarefasPorColuna(s: Sessao, pesada: Bot): Promise<Record<string, number>> {
  const { quadro } = await api<{ quadro: { tarefas: TarefaApi[] } | null }>(s, "GET", `agentes/${pesada.id}/quadro`);
  const r: Record<string, number> = {};
  for (const t of quadro?.tarefas ?? []) r[t.status] = (r[t.status] ?? 0) + 1;
  return r;
}

const BOTAO = (pg: "tarefas" | "conversa"): string => pg === "tarefas"
  ? `document.querySelector('#cabecalho [data-act="pagina"][data-pg-id="tarefas"], #cabecalho [data-act="modo-da-conversa"][data-modo="quadro"]')`
  : `document.querySelector('#cabecalho [data-act="pagina"][data-pg-id="conversa"], #cabecalho [data-act="modo-da-conversa"][data-modo="conversa"]')`;

/** Uma abertura: o clique em Tarefas até os cards no DOM e o quadro seguinte pintado; a leitura do servidor à parte. */
export interface Abertura { cards: number; ateCardsMs: number; atePintarMs: number; maiorTarefaMs: number; leituras: number; leituraMs: number | null; servidorMs: number | null; react: boolean }

/**
 * Clica em Tarefas e mede, na página: até o 1º card no DOM, até o quadro seguinte (o que a pessoa vê), a maior tarefa
 * longa no meio e o GET do quadro (duração e o tempo até o 1º byte, que é o servidor).
 */
const ABRIR = `(async () => {
  const c = window.__carga;
  const lt0 = c.longtasks.length;
  performance.clearResourceTimings();
  const temCards = () => document.querySelectorAll("#quadro li.qd-card[data-tarefa]").length > 0 && !document.getElementById("quadro")?.hidden;
  const t0 = performance.now();
  ${BOTAO("tarefas")}?.click();
  let tCards = null;
  await new Promise((r) => {
    if (temCards()) { tCards = performance.now(); return r(); }
    const mo = new MutationObserver(() => { if (temCards()) { tCards = performance.now(); mo.disconnect(); r(); } });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    setTimeout(() => { mo.disconnect(); r(); }, 20000);
  });
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const tPintou = performance.now();
  // As tarefas longas chegam ao observer depois do fim delas: um respiro antes de ler.
  await new Promise((r) => setTimeout(r, 300));
  const lts = c.longtasks.slice(lt0).filter((x) => x.inicio + x.dur >= t0 && x.inicio <= tPintou);
  const gets = performance.getEntriesByType("resource").filter((e) => /\\/quadro(\\?[^/]*)?$/.test(e.name) && e.startTime >= t0 - 1);
  const g = gets[0];
  return {
    cards: document.querySelectorAll("#quadro li.qd-card[data-tarefa]").length,
    ateCardsMs: tCards === null ? -1 : Math.round(tCards - t0),
    atePintarMs: Math.round(tPintou - t0),
    maiorTarefaMs: Math.round(lts.reduce((a, x) => Math.max(a, x.dur), 0)),
    leituras: gets.length,
    leituraMs: g ? Math.round(g.responseEnd - g.startTime) : null,
    servidorMs: g && g.responseStart > 0 ? Math.round(g.responseStart - g.requestStart) : null,
    react: !!document.querySelector("#quadro [data-react-regiao='quadro-grade']"),
  };
})()`;

/** A 1ª abertura (logo depois de carregar a página) e REABERTURAS idas e voltas Conversa → Quadro. */
export async function medirAberturas(cdp: Cdp): Promise<{ primeira: Abertura; reaberturas: Abertura[] }> {
  for (let i = 0; i < 50 && !(await avaliar<boolean>(cdp, `!!${BOTAO("tarefas")}`)); i++) await new Promise((r) => setTimeout(r, 200));
  const primeira = await avaliar<Abertura>(cdp, ABRIR);
  escrever(`  abrir o quadro (1ª): ${JSON.stringify(primeira)}`);
  const reaberturas: Abertura[] = [];
  for (let i = 0; i < REABERTURAS; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    await avaliar(cdp, `${BOTAO("conversa")}?.click()`);
    await new Promise((r) => setTimeout(r, 1500));
    reaberturas.push(await avaliar<Abertura>(cdp, ABRIR));
  }
  escrever(`  abrir o quadro (de novo): ${reaberturas.map((a) => `${a.atePintarMs} ms (maior tarefa ${a.maiorTarefaMs}, GET ${a.leituraMs ?? "-"}/${a.servidorMs ?? "-"})`).join(" · ")}`);
  return { primeira, reaberturas };
}

/** Entra no modo Quadro da conversa aberta e espera os cards; instala os contadores de regravação, leitura e soltura. */
export async function abrirQuadro(cdp: Cdp): Promise<{ primeira: Abertura; reaberturas: Abertura[] }> {
  const aberturas = await medirAberturas(cdp);
  for (let i = 0; i < 150 && !(await avaliar<boolean>(cdp, `!!document.querySelector("#quadro li.qd-card[data-tarefa]")`)); i++) await new Promise((r) => setTimeout(r, 200));
  const visto = await avaliar<Record<string, unknown>>(cdp, `({ paginas: [...document.querySelectorAll('#cabecalho [data-act="pagina"]')].map((b) => b.dataset.pgId), cards: document.querySelectorAll("#quadro li.qd-card[data-tarefa]").length, arrastaveis: document.querySelectorAll('#quadro li.qd-card[draggable="true"], #quadro li.qd-card[data-rx-arrasta]').length, react: !!document.querySelector("#quadro [data-react-regiao='quadro-grade']"), colunas: [...document.querySelectorAll("#quadro section.qd-col[data-coluna]")].map((c) => c.dataset.coluna) })`);
  escrever(`quadro à vista: ${JSON.stringify(visto)}`);
  await new Promise((r) => setTimeout(r, 2000));
  await avaliar(cdp, INSTALAR);
  return aberturas;
}

/**
 * Os contadores do cenário: regravações da grade, GET do quadro (e quanto levaram), o PATCH de cada arrasto (servidor) e,
 * por soltura, do soltar (o drop nativo ou o pointerup) até o card estar na coluna nova num quadro pintado (tela).
 */
const INSTALAR = `(() => { const c = window.__carga; c.quadro = { regravacoes: 0, leituras: 0, leiturasMs: [], mudancasMs: [], solturasMs: [], perdidas: 0 };
  const qd = document.querySelector("#quadro"); if (qd) new MutationObserver(() => c.quadro.regravacoes++).observe(qd, { childList: true, subtree: false });
  const conteudo = document.querySelector("#quadro > .qd-conteudo"); if (conteudo) new MutationObserver(() => c.quadro.regravacoes++).observe(conteudo, { childList: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) {
    if (/\\/quadro(\\?[^/]*)?$/.test(e.name)) { c.quadro.leituras++; c.quadro.leiturasMs.push(Math.round(e.responseEnd - e.startTime)); }
    else if (/\\/quadro\\/tarefas\\/[^/?]+(\\?[^/]*)?$/.test(e.name)) c.quadro.mudancasMs.push(Math.round(e.responseEnd - e.startTime));
  } }).observe({ type: "resource" });
  c.vigiar = (id, para) => {
    const v = { t0: null };
    const marcar = () => { if (v.t0 === null) v.t0 = performance.now(); };
    document.addEventListener("drop", marcar, { capture: true, once: true });
    document.addEventListener("pointerup", marcar, { capture: true, once: true });
    const ate = performance.now() + 5000;
    const olhar = () => {
      if (v.t0 !== null && document.querySelector('#quadro section.qd-col[data-coluna="' + para + '"] li.qd-card[data-tarefa="' + id + '"]')) { c.quadro.solturasMs.push(Math.round(performance.now() - v.t0)); return; }
      if (performance.now() > ate) { c.quadro.perdidas++; return; }
      requestAnimationFrame(olhar);
    };
    requestAnimationFrame(olhar);
  };
  return true; })()`;

/** Um arrasto completo pelo evento nativo (dragstart → dragover → drop → dragend): a grade por string. */
const ARRASTAR = (de: string, para: string): string => `(() => {
  const card = [...document.querySelectorAll('#quadro section.qd-col[data-coluna="${de}"] li.qd-card[draggable="true"][data-tarefa]')].find((e) => e.offsetParent);
  const col = document.querySelector('#quadro section.qd-col[data-coluna="${para}"]');
  if (!card || !col) return false;
  window.__carga.vigiar?.(card.dataset.tarefa, "${para}");
  card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() }));
  col.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  col.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  card.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  return true;
})()`;

/** A grade em React (dnd-kit) está na tela: o arrasto vai por ponteiro. */
const POR_PONTEIRO = `!!document.querySelector('#quadro li.qd-card[data-rx-arrasta]')`;

/** Onde pegar o card (o centro dele, à vista) e onde soltar (perto do topo da coluna de destino, à vista). */
const ALVOS = (de: string, para: string): string => `(() => {
  const col = document.querySelector('#quadro section.qd-col[data-coluna="${para}"]');
  const cards = [...document.querySelectorAll('#quadro section.qd-col[data-coluna="${de}"] li.qd-card[data-rx-arrasta][data-tarefa]')];
  if (!col || !cards.length) return { erro: "sem coluna ou sem card" };
  const vw = innerWidth, vh = innerHeight;
  for (const card of cards.slice(0, 6)) {
    card.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = card.getBoundingClientRect();
    // No meio do card, um pouco abaixo do título: fora do "Mover para…" e dos botões do canto.
    const x = Math.round(r.left + r.width * 0.35), y = Math.round(r.top + Math.min(r.height / 2, 18));
    if (x < 0 || y < 0 || x > vw || y > vh) continue;
    // O corpo do card é o botão de abrir: o sensor da grade pega nele (só não em campo, no "Mover para…" e em menu aberto).
    const el = document.elementFromPoint(x, y);
    if (el?.closest("li.qd-card") !== card || el.closest("input, textarea, select, .rx-qd-mover, .qd-menu")) continue;
    const rc = col.getBoundingClientRect();
    const x1 = Math.round(Math.min(Math.max(rc.left + rc.width / 2, 4), vw - 4)), y1 = Math.round(Math.min(Math.max(rc.top + 80, 4), vh - 4));
    window.__carga.vigiar?.(card.dataset.tarefa, "${para}");
    return { x, y, x1, y1 };
  }
  return { erro: "nenhum card à vista no ponto de pegar" };
})()`;

let avisou = false;
async function arrastarPorPonteiro(cdp: Cdp, de: string, para: string): Promise<boolean> {
  const a = await avaliar<{ x: number; y: number; x1: number; y1: number } | { erro: string }>(cdp, ALVOS(de, para));
  if ("erro" in a) {
    if (!avisou) escrever(`  arrasto por ponteiro: ${a.erro}`);
    avisou = true;
    return false;
  }
  const mouse = (type: string, x: number, y: number, buttons: number): Promise<unknown> =>
    cdp.enviar("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "mouse" });
  await mouse("mouseMoved", a.x, a.y, 0);
  await mouse("mousePressed", a.x, a.y, 1);
  // Como a mão: passa da distância de ativação (6 px) e anda até a coluna em alguns passos, um por quadro.
  const passos = 10;
  for (let i = 1; i <= passos; i++) {
    await mouse("mouseMoved", Math.round(a.x + ((a.x1 - a.x) * i) / passos), Math.round(a.y + ((a.y1 - a.y) * i) / passos), 1);
    await new Promise((r) => setTimeout(r, 16));
  }
  await mouse("mouseReleased", a.x1, a.y1, 0);
  return true;
}

async function umArrasto(cdp: Cdp): Promise<boolean> {
  if (await avaliar<boolean>(cdp, POR_PONTEIRO)) return arrastarPorPonteiro(cdp, COLUNA_A, COLUNA_B);
  return avaliar<boolean>(cdp, ARRASTAR(COLUNA_A, COLUNA_B));
}

/** Arrasta de A para B até `parar()`; devolve quantos arrastos a tela aceitou disparar. */
export async function arrastarAte(cdp: Cdp, parar: () => boolean): Promise<number> {
  let n = 0;
  for (let i = 0; !parar(); i++) {
    if (await umArrasto(cdp)) n++;
    if (i % PAR_A_CADA === PAR_A_CADA - 1) {
      await new Promise((r) => setTimeout(r, PAR_MS));
      if (await umArrasto(cdp)) n++;
    }
    await new Promise((r) => setTimeout(r, ARRASTO_MS));
  }
  return n;
}

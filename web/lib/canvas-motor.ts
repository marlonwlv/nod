/**
 * ADA-13 (ADR-150): a página Canvas sem DOM. As jornadas em fileiras, cada tela no tamanho de verdade (1440×900 no
 * computador, 390×844 no celular) em coordenadas do mundo; a vista é um deslocamento e um zoom. Aqui ficam o layout,
 * o Ajustar, o tamanho real, o zoom no ponto do ponteiro, o endereço #Jx-y, quais telas aparecem e quais têm o iframe
 * vivo (ADA-228: no máximo 6, as mais perto do centro, e só a partir de 50% de zoom; abaixo disso, a miniatura). O DOM mora em web/lib/canvas-na-tela.ts.
 */
import type { EstruturaCanvasDto, TelaCanvasDto } from "../../src/contracts/canvas.ts";
import { CSP_ARTEFATO, jsonParaScript } from "./artefato.ts";
import { esc } from "./escape.ts";

export const TAMANHO = { desk: { w: 1440, h: 900 }, cel: { w: 390, h: 844 } } as const;
/**
 * ADA-228 (protótipo v4 da ADA-13): o rótulo da jornada à esquerda da fileira ("J1 No card" e o resumo), o cabeçalho
 * de cada tela em cima ("J1-1 Hoje ⤢"), a legenda embaixo e a seta no vão entre as telas. Os textos têm tamanho fixo
 * na tela (o CSS multiplica por --cv-k); estas medidas do mundo são as do zoom de abrir (~10%), como no protótipo.
 */
export const ROTULO = 1180;
export const VAO = 260;
export const VAO_FILEIRA = 360;
export const CABECA = 200;
/** A legenda embaixo de cada tela. */
export const LEGENDA = 420;
/** A coluna dos post-its no fim da fileira (os do protótipo e os da pessoa). */
export const NOTAS = 1900;
export const ZOOM_MIN = 0.03;
export const ZOOM_MAX = 2;
export const MAX_VIVOS = 6;
/** ADA-228 (J3): abaixo deste zoom nenhuma tela fica viva; a miniatura basta e o motor fica leve. */
export const ZOOM_VIVO = 0.5;

export type Caixa = { x: number; y: number; w: number; h: number };
export type TelaNoMundo = Caixa & { tela: TelaCanvasDto };
export type FileiraNoMundo = { id: string; titulo: string; resumo: string; y: number; telas: TelaNoMundo[] };
export type Layout = { fileiras: FileiraNoMundo[]; porId: Map<string, TelaNoMundo>; limites: Caixa };
export type Vista = { x: number; y: number; zoom: number };

/**
 * As fileiras: uma por jornada, as telas lado a lado na ordem; a fileira seguinte começa embaixo da mais alta. ADA-228
 * (J4-4): `notasDaPessoa` são as jornadas com post-it da pessoa ou do bot (os comentários), que também reservam a coluna,
 * para o "ajustar tudo" mostrar os post-its como no protótipo.
 */
export function montarLayout(e: Pick<EstruturaCanvasDto, "jornadas"> & { notas?: EstruturaCanvasDto["notas"] }, notasDaPessoa: Iterable<string> = []): Layout {
  const comNotas = new Set([...(e.notas ?? []).map((n) => n.jornada).filter((j): j is string => !!j), ...notasDaPessoa]);
  const fileiras: FileiraNoMundo[] = [];
  const porId = new Map<string, TelaNoMundo>();
  let y = 0;
  let largura = 0;
  for (const j of e.jornadas) {
    let x = ROTULO;
    let alta = 0;
    const telas: TelaNoMundo[] = [];
    for (const t of j.telas) {
      const tam = TAMANHO[t.tamanho] ?? TAMANHO.desk;
      const n: TelaNoMundo = { x, y: y + CABECA, w: tam.w, h: tam.h, tela: t };
      telas.push(n);
      porId.set(t.id, n);
      x += tam.w + VAO;
      alta = Math.max(alta, tam.h);
    }
    largura = Math.max(largura, x - VAO + (comNotas.has(j.id) ? VAO + NOTAS : 0));
    fileiras.push({ id: j.id, titulo: j.titulo, resumo: j.resumo, y, telas });
    y += CABECA + alta + LEGENDA + VAO_FILEIRA;
  }
  const altura = Math.max(0, y - VAO_FILEIRA);
  return { fileiras, porId, limites: { x: 0, y: 0, w: Math.max(0, largura), h: altura } };
}

export const prender = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Cabe a caixa na tela (com folga), centrada. Caixa vazia = zoom 1 na origem. */
export function ajustar(c: Caixa, tela: { w: number; h: number }, folga = 48): Vista {
  if (c.w <= 0 || c.h <= 0 || tela.w <= 0 || tela.h <= 0) return { x: folga, y: folga, zoom: 1 };
  const zoom = prender(Math.min((tela.w - 2 * folga) / c.w, (tela.h - 2 * folga) / c.h));
  return { zoom, x: (tela.w - c.w * zoom) / 2 - c.x * zoom, y: (tela.h - c.h * zoom) / 2 - c.y * zoom };
}

/**
 * ADA-228 (J3-1): abrir como no protótipo, com a largura toda (as fileiras de cima à vista, o resto rola), entre a
 * barra em cima e o input embaixo. Fileira estreita não passa de 50%.
 */
export function ajustarLargura(c: Caixa, tela: { w: number; h: number }, o: { topo: number; base: number; folga?: number } = { topo: 72, base: 88 }): Vista {
  const folga = o.folga ?? 48;
  if (c.w <= 0 || tela.w <= 0) return { x: folga, y: o.topo, zoom: 1 };
  const zoom = prender(Math.min(0.5, (tela.w - 2 * folga) / c.w));
  return { zoom, x: folga - c.x * zoom, y: o.topo - c.y * zoom };
}

/** Ajustar à janela com a barra em cima e o input embaixo (Shift 1 e o clique no %). */
export function ajustarEntre(c: Caixa, tela: { w: number; h: number }, o: { topo: number; base: number } = { topo: 72, base: 88 }): Vista {
  const v = ajustar(c, { w: tela.w, h: Math.max(1, tela.h - o.topo - o.base) }, 32);
  return { ...v, y: v.y + o.topo };
}

/** O tamanho real de uma tela: zoom 1, a tela no centro (ou no topo, se for mais alta que a vista). */
export function tamanhoReal(t: Caixa, tela: { w: number; h: number }): Vista {
  const x = (tela.w - t.w) / 2 - t.x;
  const y = t.h + 32 > tela.h ? 16 - t.y : (tela.h - t.h) / 2 - t.y;
  return { zoom: 1, x, y };
}

/** Zoom com o ponto (px, py) da tela parado embaixo do ponteiro. */
export function zoomNoPonto(v: Vista, fator: number, px: number, py: number): Vista {
  const zoom = prender(v.zoom * fator);
  const k = zoom / v.zoom;
  return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

/** O fator de zoom da roda (o trackpad manda deltas pequenos; o mouse, ~100 por clique). */
export function fatorDaRoda(deltaY: number): number {
  return Math.exp(-Math.max(-200, Math.min(200, deltaY)) * 0.0022);
}

/** O ponto da tela (px, py) no mundo. */
export const noMundo = (v: Vista, px: number, py: number): { x: number; y: number } => ({ x: (px - v.x) / v.zoom, y: (py - v.y) / v.zoom });

/** O endereço do hash: #J1-2 é a tela; #J1, a jornada. Outro texto = null. */
export function lerHash(h: string): { tela: string } | { jornada: string } | null {
  const s = h.replace(/^#/, "").trim();
  if (/^J\d{1,3}-\d{1,3}$/.test(s)) return { tela: s };
  if (/^J\d{1,3}$/.test(s)) return { jornada: s };
  return null;
}

/** O parâmetro da URL com o canvas aberto: com ele, o #J1-2 volta ao mesmo lugar depois de recarregar (#649 revisão 3, M3). */
export const PARAMETRO_CANVAS = "canvas";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O canvas da URL (só um uuid; o resto é null). */
export function canvasDaUrl(href: string): string | null {
  const id = new URL(href).searchParams.get(PARAMETRO_CANVAS);
  return id && RE_UUID.test(id) ? id : null;
}

/** O caminho com o canvas e o endereço: `endereco` undefined mantém o hash de agora; null tira. */
export function urlDoCanvas(href: string, canvasId: string | null, endereco?: string | null): string {
  const u = new URL(href);
  if (canvasId) u.searchParams.set(PARAMETRO_CANVAS, canvasId); else u.searchParams.delete(PARAMETRO_CANVAS);
  if (endereco !== undefined) u.hash = endereco ? `#${endereco}` : "";
  if (!canvasId) u.hash = "";
  return u.pathname + u.search + u.hash;
}

/** A caixa da jornada (a fileira inteira, com o cabeçalho). */
export function caixaDaFileira(f: FileiraNoMundo): Caixa {
  const ult = f.telas.at(-1);
  const alta = Math.max(0, ...f.telas.map((t) => t.h));
  return { x: 0, y: f.y, w: ult ? ult.x + ult.w : ROTULO, h: CABECA + alta + LEGENDA };
}

/** As telas que cruzam a vista (com uma margem de meia tela, para o iframe já estar pronto ao chegar). */
export function visiveis(l: Layout, v: Vista, tela: { w: number; h: number }): TelaNoMundo[] {
  const a = noMundo(v, -tela.w / 2, -tela.h / 2);
  const b = noMundo(v, tela.w * 1.5, tela.h * 1.5);
  return [...l.porId.values()].filter((t) => t.x < b.x && t.x + t.w > a.x && t.y < b.y && t.y + t.h > a.y);
}

/**
 * Quais telas ficam com o iframe vivo: abaixo de um zoom em que o texto nem se lê, nenhuma (a miniatura basta); acima,
 * as visíveis mais perto do centro, até 6. As que já estavam vivas ganham na disputa (sem piscar ao rolar).
 */
export function escolherVivos(vis: readonly TelaNoMundo[], v: Vista, tela: { w: number; h: number }, vivos: ReadonlySet<string>, o: { minZoom?: number; max?: number } = {}): string[] {
  if (v.zoom < (o.minZoom ?? ZOOM_VIVO)) return [];
  const c = noMundo(v, tela.w / 2, tela.h / 2);
  const dist = (t: TelaNoMundo): number => Math.hypot(t.x + t.w / 2 - c.x, t.y + t.h / 2 - c.y) * (vivos.has(t.tela.id) ? 0.7 : 1);
  return [...vis].sort((p, q) => dist(p) - dist(q)).slice(0, o.max ?? MAX_VIVOS).map((t) => t.tela.id);
}

/**
 * ADA-228 (J3, proposta do Gil): "onde parou" por canvas. Na 1ª vez, Ajustar; depois, a vista guardada. O #Jx-y no
 * endereço sempre manda (quem chama tenta o hash antes).
 */
export const chaveOndeParou = (canvasId: string): string => `nod.canvas.vista.${canvasId}`;
export function lerOndeParou(bruto: string | null | undefined): Vista | null {
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto) as Partial<Vista>;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    if (!ok(v.x) || !ok(v.y) || !ok(v.zoom)) return null;
    return { x: v.x, y: v.y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom)) };
  } catch { return null; }
}
export const gravarOndeParou = (v: Vista): string => JSON.stringify({ x: Math.round(v.x), y: Math.round(v.y), zoom: Math.round(v.zoom * 10_000) / 10_000 });

/** O pino na tela: x e y em [0, 1] da tela, presos. */
export function fracaoNaTela(t: Caixa, m: { x: number; y: number }): { x: number; y: number } {
  const f = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
  return { x: f((m.x - t.x) / t.w), y: f((m.y - t.y) / t.h) };
}

/** A tela embaixo de um ponto do mundo. */
export function telaNoPonto(l: Layout, m: { x: number; y: number }): TelaNoMundo | null {
  for (const t of l.porId.values()) if (m.x >= t.x && m.x <= t.x + t.w && m.y >= t.y && m.y <= t.y + t.h) return t;
  return null;
}

/**
 * A ponte do srcdoc da tela (roda antes do protótipo): links inertes, WebRTC desligado, o contorno sutil nos seletores
 * de `novo` e o Esc repassado ao nod (para sair do tamanho real). Só posta para o pai.
 */
export function ponteDaTela(novo: readonly string[]): string {
  return `(function(){"use strict";var pai=window.parent;function enviar(m){try{pai.postMessage(m,"*")}catch(e){}}
["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel"].forEach(function(k){try{Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false})}catch(e){}});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a&&(a.getAttribute("href")||"").charAt(0)!=="#")e.preventDefault()},true);
document.addEventListener("keydown",function(e){if(e.key==="Escape")enviar({nod:"esc"})},true);
var novo=${jsonParaScript(novo)};function marcar(){novo.forEach(function(s){try{document.querySelectorAll(s).forEach(function(el){el.setAttribute("data-nod-novo","")})}catch(e){}})}
document.addEventListener("DOMContentLoaded",marcar);window.addEventListener("load",marcar);})();`;
}

/**
 * O documento de uma tela: a CSP sem rede da ADR-051 e a ponte no <head>, antes de qualquer byte do protótipo; o CSS
 * comum do canvas, o HTML da tela e o JS comum depois. O protótipo é dado, nunca código do nod.
 */
export function documentoDaTela(o: { html: string; css: readonly string[]; js: readonly string[]; novo: readonly string[]; tamanho?: "desk" | "cel" }): string {
  const fecha = (s: string): string => s.replace(/<\/(script|style)/gi, "<\\/$1");
  // O mesmo contexto do docHtml do Gil (_nod/canvas/canvas.js): tema claro fixo, as classes cv-dentro/cv-cel e o wrapper
  // .cv-tela, senão o CSS dele aplica o tema escuro, a moldura de celular e as animações (#649 revisão 9, M1).
  const classes = `cv-dentro${o.tamanho === "cel" ? " cv-cel" : ""}`;
  return `<!DOCTYPE html><html lang="pt-BR" data-theme="light" class="${classes}"><head><meta charset="utf-8"><meta http-equiv="x-dns-prefetch-control" content="off"><meta http-equiv="Content-Security-Policy" content="${esc(CSP_ARTEFATO)}"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${ponteDaTela(o.novo)}</script>` +
    `<style>[data-nod-novo]{outline:1.5px dashed rgba(99,102,241,.55);outline-offset:3px}</style>${o.css.map((c) => `<style>${fecha(c)}</style>`).join("")}</head><body><div class="cv-tela">${o.html}</div>${o.js.map((j) => `<script>${fecha(j)}</script>`).join("")}</body></html>`;
}

/** Os hashes que a vista precisa e ainda não tem (o CSS e o JS comuns sempre; das telas, as vivas e as miniaturas). */
export function hashesQueFaltam(e: EstruturaCanvasDto, vivas: readonly string[], tem: ReadonlySet<string>): string[] {
  const porId = new Map(e.jornadas.flatMap((j) => j.telas).map((t) => [t.id, t] as const));
  const quer = [...e.css, ...e.js, ...vivas.map((id) => porId.get(id)?.html ?? ""), ...[...porId.values()].map((t) => t.miniatura ?? "")];
  return [...new Set(quer.filter((h) => /^[0-9a-f]{64}$/.test(h) && !tem.has(h)))];
}

/** Pausa depois de um pedido de blobs que falhou: a próxima mexida só tenta de novo depois dela. */
export const PAUSA_BLOBS_MS = 5000;

/**
 * Codex no #649 (P2): o que a busca de blobs deixa para a próxima. Se falhou, pausa até `agora + PAUSA_BLOBS_MS`,
 * em vez de pedir de novo na hora (o laço sem fim). Se deu certo, o hash pedido que não veio não existe no servidor
 * e entra em `ausentes`, que não se pede outra vez.
 */
export function depoisDaBusca(quer: readonly string[], recebidos: ReadonlySet<string>, falhou: boolean, agora: number): { ausentes: string[]; pausaAte: number } {
  if (falhou) return { ausentes: [], pausaAte: agora + PAUSA_BLOBS_MS };
  return { ausentes: quer.filter((h) => !recebidos.has(h)), pausaAte: 0 };
}

/** O post-it e o pino contados por endereço (para o selo "N" de cada tela e de cada jornada). */
export function abertosPorEndereco(cs: readonly { telaId: string | null; jornada: string | null; paiId: string | null; resolvido: boolean; arquivado: boolean }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cs) {
    if (c.paiId || c.resolvido || c.arquivado) continue;
    const k = c.telaId ?? c.jornada;
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** ADR-051 §3 (revisão 1 do #649, A3): a versão publicada num turno com conteúdo de fora leva a marca no topo. */
export function seloDaVersao(confiavel: boolean): string {
  return confiavel ? "" : '<span class="cv-fora" title="Esta versão foi publicada num turno com conteúdo de fora">não confiável</span>';
}

type CaixaDeTexto = { value: string; focus(): void };
type ComCampos = { querySelector(sel: string): unknown };
/** O que a pessoa estava escrevendo (comentário novo e resposta) e onde estava o foco. */
export type Rascunhos = { novo: string; resp: string; foco: string | null };
const IDS_DE_RASCUNHO = { novo: "#cv-novo-in", resp: "#cv-resp-in" } as const;
const campo = (raiz: ComCampos | null | undefined, sel: string): CaixaDeTexto | null => (raiz?.querySelector(sel) as CaixaDeTexto | null) ?? null;

/** Guarda o rascunho antes de um innerHTML que recria os campos (revisão 1 do #649, M7). */
export function guardarRascunhos(raiz: ComCampos | null | undefined, focado: string | null | undefined): Rascunhos {
  return { novo: campo(raiz, IDS_DE_RASCUNHO.novo)?.value ?? "", resp: campo(raiz, IDS_DE_RASCUNHO.resp)?.value ?? "", foco: focado ?? null };
}

/** Devolve o rascunho e o foco aos campos recriados (os que ainda existem). */
export function restaurarRascunhos(raiz: ComCampos | null | undefined, r: Rascunhos): void {
  const n = campo(raiz, IDS_DE_RASCUNHO.novo);
  const resp = campo(raiz, IDS_DE_RASCUNHO.resp);
  if (n && r.novo) n.value = r.novo;
  if (resp && r.resp) resp.value = r.resp;
  if (r.foco === "cv-novo-in") n?.focus();
  else if (r.foco === "cv-resp-in") resp?.focus();
}

/**
 * O pointerdown do palco: botão e link nunca arrastam; a tela no tamanho real é do protótipo (rola e clica), salvo no
 * modo Pino, em que o clique marca o pino (#649 revisão 2, M3: o pino não funcionava no tamanho real).
 */
export const ignorarPonteiro = (a: { controle: boolean; noReal: boolean; modoPino: boolean }): boolean => a.controle || (a.noReal && !a.modoPino);

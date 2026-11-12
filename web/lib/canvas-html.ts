/**
 * ADA-228: o HTML da página Canvas, fiel ao protótipo v4 da ADA-13 (proto/nod-ada-13-canvas, prefixo a13- → cv-). Só
 * funções puras (dados → string), para o teste unitário ler sem DOM; o estado e os eventos moram em canvas-na-tela.ts.
 * Todo texto que vem do canvas (títulos, comentários, nomes) passa por esc.
 */
import type { CanvasItemDto, ComentarioCanvasDto, EstadoCanvasDto, VersaoCanvasDto, VistaCanvasDto } from "../../src/contracts/canvas.ts";
import { caixaDaFileira, ROTULO, VAO, type Layout } from "./canvas-motor.ts";
import { esc } from "./escape.ts";
import { textoFormatado } from "./texto-formatado.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Ícones (os do protótipo: viewBox 16, traço 1.6, pontas redondas)

const svg = (d: string, extra = ""): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra}${d.split("|").map((p) => `<path d="${p}"/>`).join("")}</svg>`;
export const ICONES = {
  anterior: svg("M10 3.5 5.5 8l4.5 4.5"),
  proxima: svg("M6 3.5 10.5 8 6 12.5"),
  comentar: svg("M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 13.5V11H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"),
  nota: svg("M3 2.5h10v7l-3.5 4H3z|M13 9.5H9.5v4"),
  apresentar: svg("M5 3.3v9.4L12.4 8z"),
  cheia: svg("M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"),
  link: svg("M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"),
  expandir: svg("M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"),
  ok: svg("M3.5 8.5 6.5 11.5 12.5 4.5"),
  busca: svg("M10.5 10.5 13.5 13.5", '<circle cx="7" cy="7" r="4.5"/>'),
  todos: svg("M9 11.5h5.5", '<rect x="1.5" y="3" width="5.5" height="4" rx="1"/><rect x="9" y="3" width="5.5" height="4" rx="1"/><rect x="1.5" y="9.5" width="5.5" height="4" rx="1"/>'),
  enviar: svg("M8 13V3.5|M4 7.5 8 3.5l4 4"),
  canvas: svg("M9 11.5h5.5", '<rect x="1.5" y="3" width="5.5" height="4" rx="1"/><rect x="9" y="3" width="5.5" height="4" rx="1"/><rect x="1.5" y="9.5" width="5.5" height="4" rx="1"/>'),
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Regras pequenas (puras, testadas)

export const enderecoDe = (c: Pick<ComentarioCanvasDto, "telaId" | "jornada">): string => c.telaId ?? c.jornada ?? "";
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;
const hora = (ms: number): string => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
/** "hoje 14:35", "ontem 09:10" ou "03/11 18:02". */
export function quando(ms: number, agora = Date.now()): string {
  const d = new Date(ms);
  const h = new Date(agora);
  const dia = (x: Date): number => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const dif = dia(h) - dia(d);
  if (dif === 0) return `hoje ${hora(ms)}`;
  if (dif === 1) return `ontem ${hora(ms)}`;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}
/** Regra da Ada (ADA-228): o Aprovado mostra quando a tarefa saiu de Prototipando ("aprovado hoje", "aprovado em 03/11"). */
export function aprovadoQuando(ms: number | null | undefined, agora = Date.now()): string {
  if (ms === null || ms === undefined) return "aprovado";
  const q = quando(ms, agora);
  return q.startsWith("hoje") ? "aprovado hoje" : q.startsWith("ontem") ? "aprovado ontem" : `aprovado em ${q.split(" ")[0]}`;
}
/** As iniciais do avatar: "Marlon Wanderllich" → "MW", "Você" → "VO". */
export const iniciais = (nome: string): string => {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p.length > 1 ? (p[0]?.[0] ?? "") + (p.at(-1)?.[0] ?? "") : (p[0] ?? "?").slice(0, 2)) || "?").toUpperCase();
};

/** O número de cada pino na tela: a ordem dos comentários raiz (os resolvidos mantêm o seu). */
export function numerarPinos(cs: readonly ComentarioCanvasDto[]): Map<string, number> {
  const r = new Map<string, number>();
  let n = 0;
  for (const c of [...cs].filter((x) => !x.paiId).sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id))) r.set(c.id, ++n);
  return r;
}

export const ROTULO_DO_ESTADO: Record<EstadoCanvasDto, string> = { esperando_voce: "Esperando você", em_producao: "Em produção", aprovado: "Aprovado" };
const ORDEM_DO_ESTADO: readonly EstadoCanvasDto[] = ["esperando_voce", "em_producao", "aprovado"];

/** A lista por estado (J7-3), na ordem do protótipo; dentro do grupo, o mais recente primeiro. A busca olha issue e título. */
export function agruparPorEstado(lista: readonly CanvasItemDto[], busca = ""): { estado: EstadoCanvasDto; itens: CanvasItemDto[] }[] {
  const q = busca.trim().toLocaleLowerCase("pt-BR");
  const passa = (c: CanvasItemDto): boolean => !q || `${c.issue ?? ""} ${c.titulo}`.toLocaleLowerCase("pt-BR").includes(q);
  return ORDEM_DO_ESTADO.map((estado) => ({ estado, itens: lista.filter((c) => c.estado === estado && passa(c)).sort((a, b) => b.atualizadoEm - a.atualizadoEm) }))
    .filter((g) => g.itens.length > 0);
}

/** O nome curto do canvas na barra e nos avisos: a issue, ou o título. */
export const nomeCurto = (c: Pick<CanvasItemDto, "issue" | "titulo">): string => c.issue ?? c.titulo;

/** A linha de baixo de uma versão no ▾ (J5-6): "hoje 14:35 · atual · resolveu J1-2 e J1-3 · J1-1 segue aberto". */
export function linhaDaVersao(v: VersaoCanvasDto, o: { atual: number; comentarios: readonly ComentarioCanvasDto[]; agora?: number }): string {
  const partes = [quando(v.criadoEm, o.agora)];
  if (v.versao === o.atual) partes.push("atual");
  const porId = new Map(o.comentarios.map((c) => [c.id, c] as const));
  const ends = [...new Set(v.resolvidos.map((id) => porId.get(id)).filter((c): c is ComentarioCanvasDto => !!c).map(enderecoDe).filter(Boolean))];
  if (ends.length) partes.push(`resolveu ${ends.length === 1 ? ends[0] : `${ends.slice(0, -1).join(", ")} e ${ends.at(-1)}`}`);
  if (v.versao === o.atual) {
    const abertos = [...new Set(o.comentarios.filter((c) => !c.paiId && !c.resolvido && !c.arquivado).map(enderecoDe).filter(Boolean))];
    if (abertos.length) partes.push(`${abertos.join(", ")} segue${abertos.length > 1 ? "m" : ""} aberto${abertos.length > 1 ? "s" : ""}`);
  }
  if (v.arquivados) partes.push(plural(v.arquivados, "comentário arquivado", "comentários arquivados"));
  return partes.join(" · ");
}
/** O título de uma versão: o resumo do bot, ou o que dá para dizer sem ele. */
export const tituloDaVersao = (v: VersaoCanvasDto): string =>
  v.resumo ?? (v.versao === 1 ? `criada · ${plural(v.jornadas, "jornada", "jornadas")}, ${plural(v.telas, "tela", "telas")}` : v.mudaram.length ? `mudou ${v.mudaram.slice(0, 4).join(", ")}${v.mudaram.length > 4 ? "…" : ""}` : "nova versão");

// ---------------------------------------------------------------------------------------------------------------------
// O recibo da rodada no chat (J5-3): a mensagem que vai para a conversa e que o chat desenha como recibo.

export type ItemDaRodada = { endereco: string; texto: string };
const RE_CAB = /^Rodada (\d+) no canvas (.+?) \((\d+) comentários?\):$/;
const RE_ITEM = /^- #(J\d+(?:-\d+)?): (.+)$/;

/** O texto da mensagem: uma linha de cabeçalho e uma por comentário (o bot lê, o chat reconhece). */
export function reciboDaRodada(o: { canvas: string; rodada: number; itens: readonly ItemDaRodada[] }): string {
  const linha = (t: string): string => t.replace(/\s+/g, " ").trim();
  return [`Rodada ${o.rodada} no canvas ${linha(o.canvas)} (${plural(o.itens.length, "comentário", "comentários")}):`, ...o.itens.map((i) => `- #${i.endereco}: ${linha(i.texto)}`)].join("\n");
}
/** O inverso, para o chat: null se a mensagem não é um recibo (qualquer linha fora do formato). */
export function lerRecibo(texto: string): { canvas: string; rodada: number; itens: ItemDaRodada[] } | null {
  const [cab, ...resto] = texto.trim().split("\n");
  const m = RE_CAB.exec(cab ?? "");
  if (!m || !resto.length) return null;
  const itens: ItemDaRodada[] = [];
  for (const l of resto) {
    const i = RE_ITEM.exec(l);
    if (!i) return null;
    itens.push({ endereco: i[1] ?? "", texto: i[2] ?? "" });
  }
  return Number(m[3]) === itens.length ? { canvas: m[2] ?? "", rodada: Number(m[1]), itens } : null;
}
/** O recibo desenhado no chat: "Rodada 1 · 3 comentários no NOD-512", e cada #Jx-y abre a tela no canvas. */
export function htmlDoRecibo(r: { canvas: string; rodada: number; itens: readonly ItemDaRodada[] }, canvasId: string | null): string {
  const link = (e: string): string => canvasId
    ? `<button type="button" class="cv-rodada-id" data-act="abrir-canvas" data-id="${esc(canvasId)}" data-endereco="${esc(e)}">${esc(e)}</button>`
    : `<span class="cv-rodada-id">${esc(e)}</span>`;
  return `<div class="cv-rodada"><span class="cv-rodada-cab">${ICONES.comentar}<b>Rodada ${r.rodada}</b> · ${plural(r.itens.length, "comentário", "comentários")} no ${esc(r.canvas)}</span>` +
    `<ol>${r.itens.map((i) => `<li>${link(i.endereco)}<span>${esc(i.texto)}</span></li>`).join("")}</ol></div>`;
}

/** A pergunta do input de vidro (J4-4): vai para a conversa do bot com o endereço na frente. */
export const perguntaSobre = (o: { endereco: string | null; canvas: string; texto: string }): string =>
  o.endereco ? `sobre #${o.endereco} do ${o.canvas}: ${o.texto.trim()}` : `sobre o canvas ${o.canvas}: ${o.texto.trim()}`;

// ---------------------------------------------------------------------------------------------------------------------
// A barra (J3-1): a pílula de vidro ao lado da pílula do bot

export type Barra = {
  nome: string; versao: number; vendo: number | null; onde: string; pct: number;
  modo: "pino" | "nota" | null; rascunhos: number; abertos: number; vivo: boolean; enviando: boolean;
  menu: "nome" | "ver" | null; apresentando: boolean; podeLink: boolean;
  /** J3-3: apresentando, o título da tela ao lado do endereço. */
  titulo?: string;
};

export function htmlDaBarra(b: Barra): string {
  const bt = (cv: string, rotulo: string, corpo: string, o: { on?: boolean; cls?: string; dis?: boolean } = {}): string =>
    `<button type="button" class="cv-fer-bt${o.cls ? ` ${o.cls}` : ""}${o.on ? " cv-fer-on" : ""}" data-cv="${cv}" aria-label="${esc(rotulo)}" title="${esc(rotulo)}"${o.on !== undefined ? ` aria-pressed="${o.on}"` : ""}${o.dis ? " disabled" : ""}>${corpo}</button>`;
  const fio = '<i class="cv-fer-fio" aria-hidden="true"></i>';
  const nav = `<span class="cv-fer-nav">${bt("anterior", "Anterior", ICONES.anterior)}<span class="cv-fer-onde" aria-live="polite">${esc(b.onde)}</span>${bt("proxima", "Próxima", ICONES.proxima)}` +
    (b.podeLink && !b.apresentando ? bt("link", "Copiar link desta tela", ICONES.link, { cls: "cv-fer-link" }) : "") + "</span>";
  if (b.apresentando) {
    // J3-3: ‹ J3-1 Mudar › · 100% · ×. O % é a escala da tela grande (só leitura: o zoom é o do aparelho).
    const nomeTela = b.titulo ? `<span class="cv-fer-tit">${esc(b.titulo)}</span>` : "";
    const navA = nav.replace('</span>' + bt("proxima", "Próxima", ICONES.proxima), `</span>${nomeTela}${bt("proxima", "Próxima", ICONES.proxima)}`);
    return `<div class="cv-fer" role="toolbar" aria-label="Apresentação">${navA}${fio}<span class="cv-fer-pct cv-fer-pct-so">${Math.round(b.pct * 100)}%</span>${fio}${bt("sair-apresentar", "Sair (Esc)", "×")}</div>`;
  }
  const velha = b.vendo !== null && b.vendo !== b.versao;
  return `<div class="cv-fer" role="toolbar" aria-label="Ferramentas do canvas">` +
    `<button type="button" class="cv-fer-nome" data-cv="menu-nome" aria-label="Trocar de canvas" aria-expanded="${b.menu === "nome"}">${b.vivo ? '<i class="cv-vivo" aria-label="trabalhando"></i>' : ""}${esc(b.nome)}<span aria-hidden="true" class="cv-fer-seta">▾</span></button>` +
    `<button type="button" class="cv-fer-ver${velha ? " cv-fer-velha" : ""}" data-cv="menu-ver" aria-label="Versões desta folha" title="Versões desta folha" aria-expanded="${b.menu === "ver"}">v${velha ? b.vendo : b.versao}</button>${fio}` +
    nav + fio +
    bt("afastar", "Afastar", "−", { cls: "cv-fer-txt" }) +
    `<button type="button" class="cv-fer-pct" data-cv="ajustar" aria-label="Ajustar à janela" title="Ajustar (Shift 1)">${Math.round(b.pct * 100)}%</button>` +
    bt("aproximar", "Aproximar", "+", { cls: "cv-fer-txt" }) + fio +
    bt("comentar", "Comentar (C)", ICONES.comentar + (b.abertos ? `<span class="cv-fer-n">${b.abertos}</span>` : ""), { on: b.modo === "pino", cls: "cv-fer-com", dis: velha }) +
    bt("nota", "Nota (N)", ICONES.nota, { on: b.modo === "nota", dis: velha }) +
    bt("apresentar", "Apresentar", ICONES.apresentar) +
    bt("cheia", "Tela cheia", ICONES.cheia) +
    (b.rascunhos > 0 ? `${fio}<button type="button" class="cv-fer-enviar" data-cv="enviar-rodada"${b.enviando ? " disabled" : ""}>Enviar ${b.rascunhos} <span aria-hidden="true">›</span></button>` : "") +
    `</div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Avisos (vidro, logo abaixo da barra)

export type Aviso = { chave: string; tipo: "info" | "ok" | "vivo" | "velha"; texto: string; acao?: { cv: string; rotulo: string; forte?: boolean }; fechar?: boolean };

export function htmlDoAviso(a: Aviso): string {
  const ic = a.tipo === "ok" ? `<span class="cv-aviso-ic">${ICONES.ok}</span>` : a.tipo === "vivo" ? '<i class="cv-vivo" aria-hidden="true"></i>' : "";
  const cls = a.tipo === "info" ? "" : ` cv-aviso-${a.tipo}`;
  return `<p class="cv-aviso${cls}" role="status" data-aviso="${esc(a.chave)}">${ic}<span>${esc(a.texto)}</span>` +
    (a.acao ? `<button type="button" class="cv-link${a.acao.forte ? " cv-forte" : ""}" data-cv="${esc(a.acao.cv)}">${esc(a.acao.rotulo)}</button>` : "") +
    (a.fechar ? `<button type="button" class="cv-aviso-x" data-cv="fechar-aviso" data-aviso="${esc(a.chave)}" aria-label="Fechar">×</button>` : "") + `</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Menus da barra

export function htmlMenuVersoes(o: { canvas: string; versoes: readonly VersaoCanvasDto[] | null; atual: number; vendo: number; comparar: boolean; comentarios: readonly ComentarioCanvasDto[]; agora?: number }): string {
  const vs = o.versoes ? [...o.versoes].sort((a, b) => b.versao - a.versao) : null;
  const corpo = vs === null ? '<p class="cv-mudo" aria-busy="true">Lendo as versões…</p>'
    : `<ol class="cv-vers">${vs.map((v) => `<li class="cv-ver${v.versao === o.vendo ? " cv-ver-cur" : ""}"><span class="cv-ver-id">v${v.versao}</span>` +
      `<span class="cv-ver-txt"><b>${esc(tituloDaVersao(v))}</b><span>${esc(linhaDaVersao(v, { atual: o.atual, comentarios: o.comentarios, ...(o.agora ? { agora: o.agora } : {}) }))}</span></span>` +
      (v.versao === o.vendo ? `<span class="cv-ver-ok">${ICONES.ok}</span>` : `<button type="button" class="cv-link" data-cv="ver-versao" data-versao="${v.versao}">${v.versao === o.atual ? "Voltar" : "Ver"}</button>`) + `</li>`).join("")}</ol>`;
  return `<div class="cv-menu cv-menu-ver" role="dialog" aria-label="Versões desta folha"><div class="cv-menu-cab"><b>Versões</b><span>${esc(o.canvas)} · uma folha, ${plural(o.atual, "versão", "versões")}</span></div>${corpo}` +
    (o.atual > 1 ? `<button type="button" class="cv-menu-pe" data-cv="comparar" aria-pressed="${o.comparar}"><span class="cv-chave${o.comparar ? " cv-chave-on" : ""}" aria-hidden="true"></span>Comparar com a ${o.vendo === o.atual ? "anterior" : "atual"}</button>` : "") + `</div>`;
}

const marcaDoEstado = (e: EstadoCanvasDto, cur: boolean): string =>
  e === "em_producao" ? '<i class="cv-vivo" aria-hidden="true"></i>' : cur || e === "aprovado" ? `<span class="cv-est-ok">${ICONES.ok}</span>` : '<i class="cv-pt" aria-hidden="true"></i>';

export function htmlMenuNome(o: { lista: readonly CanvasItemDto[]; aberto: string | null; busca: string; nome: string }): string {
  const grupos = agruparPorEstado(o.lista, o.busca);
  return `<div class="cv-menu cv-menu-nome" role="dialog" aria-label="Trocar de canvas">` +
    `<label class="cv-busca cv-menu-busca">${ICONES.busca}<input id="cv-busca-menu" placeholder="Buscar canvas do ${esc(o.nome)}" aria-label="Buscar canvas" value="${esc(o.busca)}"></label>` +
    `<button type="button" class="cv-menu-todos" data-cv="todos"><span class="cv-mi-est">${ICONES.todos}</span><span>Todos os canvas</span><span class="cv-mi-info">${o.lista.length} <span aria-hidden="true">›</span></span></button>` +
    (grupos.length ? grupos.map((g) => `<h4>${ROTULO_DO_ESTADO[g.estado]}</h4><ul>${g.itens.map((c) =>
      `<li><button type="button" class="cv-mi${c.id === o.aberto ? " cv-mi-cur" : ""}" data-cv="abrir" data-id="${esc(c.id)}"><span class="cv-mi-est">${marcaDoEstado(c.estado, c.id === o.aberto)}</span>` +
      `<span class="cv-mi-txt">${c.issue ? `<b>${esc(c.issue)}</b> ` : ""}${esc(c.titulo)}</span><span class="cv-mi-info">${esc(c.estado === "em_producao" && c.etapa ? c.etapa.split(" · ")[0] : `v${c.versao}`)}</span></button></li>`).join("")}</ul>`).join("")
      : '<p class="cv-lista-nada">Nenhum canvas com esse nome.</p>') + `</div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// J1-3 · Vazio e J7-3 · Todos os canvas

export const htmlDoVazio = (): string =>
  `<div class="cv-vazio"><span class="cv-vazio-ic" aria-hidden="true">${ICONES.todos}</span><p>Nenhum canvas ainda.</p><span class="cv-mudo">Peça aqui embaixo ou na conversa.</span></div>`;

export type Filtro = "todos" | EstadoCanvasDto;
export function htmlDaLista(o: { lista: readonly CanvasItemDto[]; filtro: Filtro; busca: string; nome: string; miniatura: (c: CanvasItemDto) => string | null }): string {
  const conta = (e: EstadoCanvasDto): number => o.lista.filter((c) => c.estado === e).length;
  const prod = conta("em_producao");
  const filtros: [Filtro, string, number][] = [["todos", "Todos", o.lista.length], ["esperando_voce", "Esperando você", conta("esperando_voce")], ["em_producao", "Em produção", prod]];
  if (conta("aprovado")) filtros.push(["aprovado", "Aprovados", conta("aprovado")]);
  const grupos = agruparPorEstado(o.filtro === "todos" ? o.lista : o.lista.filter((c) => c.estado === o.filtro), o.busca);
  const linha = (c: CanvasItemDto): string => {
    const mini = o.miniatura(c);
    const est = c.estado === "em_producao" ? `<i class="cv-vivo" aria-hidden="true"></i>${esc(c.etapa ?? "em produção")}`
      : c.estado === "aprovado" ? `<span class="cv-est-ok">${ICONES.ok}</span>${esc(aprovadoQuando(c.aprovadoEm))}`
        : `<i class="cv-pt" aria-hidden="true"></i>${esc(c.etapa === "pronto para você ver" || !c.etapa ? "pronto para você ver" : `${c.etapa} para você`)}`;
    return `<li class="cv-lin cv-lin-${c.estado === "esperando_voce" ? "esperando" : c.estado === "em_producao" ? "producao" : "aprovado"}">` +
      `<button type="button" class="cv-lin-a" data-cv="abrir" data-id="${esc(c.id)}" aria-label="Abrir ${esc(nomeCurto(c))}"><span class="cv-lin-mini" aria-hidden="true">${mini ? `<img alt="" src="${esc(mini)}">` : ""}</span>` +
      `<span class="cv-lin-txt"><b>${c.issue ? `${esc(c.issue)} · ` : ""}${esc(c.titulo)}</b><span>v${c.versao} · ${plural(c.jornadas, "jornada", "jornadas")} · ${plural(c.telas, "tela", "telas")}</span></span>` +
      `<span class="cv-lin-est">${est}</span><time>${esc(quando(c.atualizadoEm).replace(/^hoje /, ""))}</time></button></li>`;
  };
  return `<div class="cv-lista"><div class="cv-lista-in"><div class="cv-lista-cab"><h2>Canvas do ${esc(o.nome)}</h2><span class="cv-mudo">${plural(o.lista.length, "canvas", "canvas")}${prod ? ` · ${prod} em produção agora` : ""}</span></div>` +
    `<div class="cv-lista-ctl"><div class="cv-filtros" role="tablist" aria-label="Filtrar canvas">${filtros.map(([f, r, n]) =>
      `<button type="button" role="tab" aria-selected="${o.filtro === f}" class="cv-filtro" data-cv="filtro" data-filtro="${f}">${r} <i>${n}</i></button>`).join("")}</div>` +
    `<label class="cv-busca">${ICONES.busca}<input id="cv-busca-lista" placeholder="Buscar por issue ou nome" aria-label="Buscar canvas" value="${esc(o.busca)}"></label></div>` +
    (grupos.length ? grupos.map((g) => `<section class="cv-grupo"><h3>${ROTULO_DO_ESTADO[g.estado]}</h3><ul>${g.itens.map(linha).join("")}</ul></section>`).join("") : '<p class="cv-lista-nada">Nenhum canvas aqui.</p>') +
    `</div></div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// O mundo (J2-3): rótulo da jornada, cabeçalho e legenda de cada tela, setas e a coluna dos post-its

export function htmlDoMundo(l: Layout, e: VistaCanvasDto["estrutura"], o: { mudaram: ReadonlySet<string>; versao?: number }): string {
  const notasPorJornada = new Map<string, string[]>();
  for (const n of e.notas) if (n.jornada) notasPorJornada.set(n.jornada, [...(notasPorJornada.get(n.jornada) ?? []), `<span class="cv-nota" role="note">${n.titulo ? `<b>${esc(n.titulo)}</b>` : ""}${esc(n.texto)}</span>`]);
  const primeiraPendente = l.fileiras.flatMap((f) => f.telas).find((t) => t.tela.pendente)?.tela.id;
  return l.fileiras.map((f) => {
    const cx = caixaDaFileira(f);
    const rot = `<div class="cv-rot" style="left:0;top:${f.y}px;width:${ROTULO - VAO}px"><b><i>${esc(f.id)}</i> ${esc(f.titulo)}</b>${f.resumo ? `<small>${esc(f.resumo)}</small>` : ""}</div>`;
    const telas = f.telas.map((t, i) => {
      const pend = t.tela.pendente === true;
      const mudou = o.mudaram.has(t.tela.id);
      const prox = f.telas[i + 1];
      return `<div class="cv-t-cab${pend ? " cv-t-fazendo" : ""}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;transform:translateY(-100%) translateY(calc(-8px * var(--cv-k)))"><i>${esc(t.tela.id)}</i><b>${esc(t.tela.titulo)}</b>` +
        (mudou ? `<span class="cv-tag">mudou${o.versao ? ` na v${o.versao}` : ""}</span>` : "") + (pend ? "" : `<button type="button" class="cv-exp" data-cv="expandir" data-tela="${esc(t.tela.id)}" aria-label="Abrir ${esc(t.tela.id)} no tamanho real" title="Tamanho real">${ICONES.expandir}</button>`) + `</div>` +
        `<div class="cv-tela${t.tela.tamanho === "cel" ? " cv-cel" : ""}${pend ? " cv-fazendo" : ""}${mudou ? " cv-mudou" : ""}" data-tela="${esc(t.tela.id)}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px">` +
        `<div class="cv-mini">${pend ? (t.tela.id === primeiraPendente ? '<span class="cv-fazendo-txt"><i class="cv-vivo"></i>montando</span>' : "") : `<span>${esc(t.tela.titulo)}</span>`}</div><div class="cv-pinos"></div></div>` +
        (t.tela.legenda && !pend ? `<div class="cv-leg" style="left:${t.x}px;top:${t.y + t.h}px;width:${t.w}px;padding-top:calc(10px * var(--cv-k))">${esc(t.tela.legenda)}</div>` : "") +
        (prox ? `<i class="cv-seta" aria-hidden="true" style="left:${t.x + t.w + VAO * 0.2}px;top:${t.y + t.h / 2}px;width:${VAO * 0.6}px"></i>` : "");
    }).join("");
    const ult = f.telas.at(-1);
    const notas = `<div class="cv-notas" data-jornada="${esc(f.id)}" style="left:${(ult ? ult.x + ult.w : ROTULO) + VAO}px;top:${f.y + (ult ? ult.y - f.y : 0)}px">${(notasPorJornada.get(f.id) ?? []).join("")}<span class="cv-notas-pessoa"></span></div>`;
    return `<section class="cv-fila" data-jornada="${esc(f.id)}" aria-label="${esc(`${f.id} ${f.titulo}`)}" style="display:contents" data-largura="${cx.w}">${rot}${telas}${notas}</section>`;
  }).join("");
}

// ---------------------------------------------------------------------------------------------------------------------
// Pinos, post-its, o popover do novo e a thread

export type Rascunho = { id: string; tipo: "pino" | "nota"; endereco: string; x?: number; y?: number; texto: string };

export function htmlDosPinos(o: { tela: string; comentarios: readonly ComentarioCanvasDto[]; numeros: ReadonlyMap<string, number>; rascunhos: readonly Rascunho[]; ativo: string | null; velha: boolean; novo: { x: number; y: number } | null }): string {
  const nRasc = o.rascunhos.filter((r) => r.tipo === "pino");
  const base = o.numeros.size;
  return o.comentarios.filter((c) => !c.paiId && !c.arquivado && c.tipo === "pino" && c.telaId === o.tela && c.x !== null && c.y !== null).map((c) => {
    const cls = o.velha ? " cv-pino-velho" : c.resolvido ? " cv-pino-ok" : c.id === o.ativo ? " cv-pino-ativo" : "";
    const n = o.numeros.get(c.id) ?? 0;
    return `<button type="button" class="cv-pino${cls}" data-cv="thread" data-id="${esc(c.id)}" style="left:${(c.x ?? 0.5) * 100}%;top:${(c.y ?? 0.5) * 100}%" aria-label="Comentário ${n}${c.resolvido ? " (resolvido)" : ""}: ${esc(c.texto.slice(0, 80))}">${c.resolvido ? "" : n}</button>`;
  }).join("") +
    nRasc.map((r, i) => r.endereco === o.tela ? `<button type="button" class="cv-pino cv-pino-rasc" data-cv="rascunho" data-id="${esc(r.id)}" style="left:${(r.x ?? 0.5) * 100}%;top:${(r.y ?? 0.5) * 100}%" aria-label="Rascunho ${base + i + 1}: ${esc(r.texto.slice(0, 80))}">${base + i + 1}</button>` : "").join("") +
    (o.novo ? `<span class="cv-pino cv-pino-ativo" style="left:${o.novo.x * 100}%;top:${o.novo.y * 100}%" aria-hidden="true">${base + nRasc.length + 1}</span>` : "");
}

export function htmlDasNotas(o: { jornada: string; comentarios: readonly ComentarioCanvasDto[]; rascunhos: readonly Rascunho[]; editando: string | null; autor: (c: ComentarioCanvasDto) => string; texto?: string }): string {
  const daJornada = o.comentarios.filter((c) => !c.paiId && !c.arquivado && c.tipo === "nota" && !c.telaId && c.jornada === o.jornada);
  return daJornada.map((c) => `<button type="button" class="cv-nota${c.resolvido ? " cv-nota-ok" : ""}" data-cv="thread" data-id="${esc(c.id)}"><b>${esc(o.autor(c))}</b>${esc(c.texto.length > 160 ? `${c.texto.slice(0, 160)}…` : c.texto)}</button>`).join("") +
    o.rascunhos.filter((r) => r.tipo === "nota" && r.endereco === o.jornada).map((r) => `<button type="button" class="cv-nota cv-nota-rasc" data-cv="rascunho" data-id="${esc(r.id)}"><b>Rascunho</b>${esc(r.texto)}</button>`).join("") +
    (o.editando === o.jornada ? `<span class="cv-nota cv-nota-editando" role="note"><b>Você · agora</b><textarea id="cv-nota-in" rows="3" maxlength="4000" aria-label="Nota na ${esc(o.jornada)}" placeholder="Escreva a nota…">${esc(o.texto ?? "")}</textarea><span class="cv-mudo">Enter guarda na rodada · Esc cancela</span></span>` : "");
}

/** O popover do comentário novo (J4-2 e J5-1): Enter guarda na rodada. */
export const htmlPopNovo = (o: { endereco: string; x: number; y: number; texto?: string; editando?: boolean }): string =>
  `<div class="cv-pop" data-pop="novo" style="left:${Math.round(o.x)}px;top:${Math.round(o.y)}px"><textarea id="cv-novo-in" rows="2" maxlength="4000" placeholder="Comentar na ${esc(o.endereco)}…" aria-label="Comentar na ${esc(o.endereco)}">${esc(o.texto ?? "")}</textarea>` +
  `<span class="cv-pop-acoes"><span class="cv-mudo">Enter guarda na rodada · Esc cancela</span>${o.editando ? '<button type="button" class="cv-link" data-cv="tirar-rascunho">Tirar</button>' : ""}<button type="button" class="cv-link cv-forte" data-cv="guardar">Guardar</button></span></div>`;

/** A conversa do pino (J4-3): as mensagens, Responder… e Resolver. Na versão antiga, só leitura. */
export function htmlThread(o: { raiz: ComentarioCanvasDto; respostas: readonly ComentarioCanvasDto[]; x: number; y: number; autor: (c: ComentarioCanvasDto) => string; leitura: boolean; enviando: boolean; erro?: string; mascote?: (c: ComentarioCanvasDto) => string | null }): string {
  const msg = (c: ComentarioCanvasDto): string => {
    const nomeA = o.autor(c);
    // ADA-228 (J4-2): a fala do bot leva o mascote dele, como no protótipo; a pessoa e o importado, as iniciais.
    // O mascote é o do bot que escreveu (autorAgenteId), não o do dono da página: outro bot pode comentar no canvas.
    const m = c.autorTipo === "bot" ? o.mascote?.(c) ?? null : null;
    const av = m ? `<span class="cv-av-mascote" aria-hidden="true">${m}</span>`
      : `<span class="cv-av${c.autorTipo === "bot" ? " cv-av-bot" : ""}" aria-hidden="true">${esc(iniciais(nomeA.replace(/ · importado$/, "")))}</span>`;
    return `<div class="cv-msg">${av}<div><b>${esc(nomeA)}</b>` +
      (c.confiavel ? "" : ` <span class="cv-fora" title="${c.autorTipo === "importado" ? "Veio de um protótipo importado" : "Escrito num turno com conteúdo de fora"}">de fora</span>`) +
      ` <time>${esc(quando(c.criadoEm).replace(/^hoje /, ""))}</time><p>${esc(c.texto)}</p></div></div>`;
  };
  return `<div class="cv-pop cv-thread" data-pop="thread" data-id="${esc(o.raiz.id)}" role="dialog" aria-label="Comentário na ${esc(enderecoDe(o.raiz))}" style="left:${Math.round(o.x)}px;top:${Math.round(o.y)}px">` +
    [o.raiz, ...o.respostas].map(msg).join("") + (o.erro ? `<p class="cv-erro" role="alert">${esc(o.erro)}</p>` : "") +
    (o.leitura ? '<span class="cv-pop-acoes"><span class="cv-mudo">Versão antiga · só leitura</span></span>'
      : `<span class="cv-pop-acoes"><input id="cv-resp-in" class="cv-resp" placeholder="Responder…" aria-label="Responder" maxlength="4000"${o.enviando ? " disabled" : ""}>` +
        `<button type="button" class="cv-link" data-cv="resolver" data-id="${esc(o.raiz.id)}" data-resolvido="${o.raiz.resolvido ? "0" : "1"}">${o.raiz.resolvido ? "Reabrir" : "Resolver"}</button></span>`) + `</div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// O input de vidro (J4-4) e o balão (J4-5..6)

export type Etapa = { id: string; texto: string; estado: "rodando" | "feita" | "falhou"; agora?: string };
export type Balao = { pergunta: string; chip: string | null; etapas: Etapa[]; resposta: string; fim: boolean; inicio: number; agora: number; nome: string; conversaId: string; turnoId: string | null; quebrar?: boolean };

/**
 * O balão segue o turno do bot na conversa (os frames do SSE): o primeiro turno da conversa depois da pergunta é o dele;
 * cada ferramenta vira uma etapa, o texto vai chegando e o encerrado fecha. Frame de outra conversa ou turno, ignora.
 */
export function balaoComFrame(b: Balao, f: { tipo: string; dados: Record<string, unknown> }, agora: number): Balao {
  if (b.fim || f.dados["conversaId"] !== b.conversaId || !f.tipo.startsWith("turno.")) return b;
  const turno = typeof f.dados["turnoId"] === "string" ? f.dados["turnoId"] : null;
  if (b.turnoId && turno && turno !== b.turnoId) return b;
  const r: Balao = { ...b, agora, turnoId: b.turnoId ?? turno };
  const id = typeof f.dados["id"] === "string" ? f.dados["id"] : "";
  if (f.tipo === "turno.atividade") {
    // ADA-228 (teste com a IA real): o servidor manda `emUso` como {texto, frentes} (frameDaFerramenta) e `rotulo` como
    // texto. A lista mostra o rótulo ("Leu a J2-1"); o cabeçalho, o emUso no presente ("Ajustando a J2-1"). Nunca String(objeto).
    const em = f.dados["emUso"];
    const emTexto = typeof em === "string" ? em : em && typeof em === "object" ? (em as Record<string, unknown>)["texto"] : null;
    const agoraTxt = typeof emTexto === "string" && emTexto.trim() ? emTexto.trim().slice(0, 80) : undefined;
    const rot = f.dados["rotulo"];
    const texto = (typeof rot === "string" && rot.trim() ? rot.trim() : agoraTxt ?? "").slice(0, 120);
    if (!texto) return r;
    const etapas = r.etapas.map((e) => (e.estado === "rodando" && !id ? { ...e, estado: "feita" as const } : e));
    return { ...r, quebrar: r.resposta !== "", etapas: id && etapas.some((e) => e.id === id) ? etapas.map((e) => (e.id === id ? { ...e, texto, ...(agoraTxt ? { agora: agoraTxt } : {}) } : e)) : [...etapas, { id: id || `e${etapas.length}`, texto, estado: "rodando", ...(agoraTxt ? { agora: agoraTxt } : {}) }] };
  }
  if (f.tipo === "turno.acao_fim") return { ...r, etapas: r.etapas.map((e) => (e.id === id ? { ...e, estado: f.dados["falhou"] === true ? "falhou" : "feita" } : e)) };
  // ADA-228 (teste com a IA real): o texto que volta depois de uma ferramenta é outra fala; sem a quebra, "v5.O chip" grudava.
  if (f.tipo === "turno.delta" && typeof f.dados["texto"] === "string") {
    const sep = r.quebrar && r.resposta && !/\s$/.test(r.resposta) ? "\n\n" : "";
    return { ...r, quebrar: false, resposta: r.resposta + sep + f.dados["texto"] };
  }
  if (f.tipo === "turno.fala") return { ...r, resposta: r.resposta && !r.resposta.endsWith("\n\n") ? `${r.resposta}\n\n` : r.resposta };
  if (f.tipo === "turno.encerrado" || f.tipo === "turno.interrompido") {
    return { ...r, fim: true, resposta: r.resposta.trim() || (f.tipo === "turno.interrompido" ? "Parou antes de responder." : r.resposta), etapas: r.etapas.map((e) => (e.estado === "rodando" ? { ...e, estado: "feita" } : e)) };
  }
  return r;
}

export function htmlDoComp(o: { chip: string | null; nome: string; escrevendo: boolean; enviando: boolean }): string {
  return `<form class="cv-comp${o.escrevendo ? " cv-comp-escrevendo" : ""}" data-cv-form="perguntar"><div class="cv-comp-box">` +
    (o.chip ? `<i class="cv-chip" title="A tela no centro">${esc(o.chip)}</i>` : "") +
    `<textarea id="cv-comp-in" rows="1" maxlength="8000" placeholder="Peça ao ${esc(o.nome)} sobre esta tela…" aria-label="Pedir ao ${esc(o.nome)}"${o.enviando ? " disabled" : ""}></textarea>` +
    `<button type="submit" class="cv-comp-enviar" aria-label="Enviar"${o.enviando ? " disabled" : ""}>${ICONES.enviar}</button></div></form>`;
}

const duracao = (ms: number): string => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`; };

export function htmlDoBalao(b: Balao, mascote: string | null = null): string {
  const feitas = b.etapas.length;
  const cab = b.fim ? `Trabalhou por ${duracao(b.agora - b.inicio)}${feitas ? ` · ${plural(feitas, "ação", "ações")}` : ""}`
    : `${esc(((e) => e?.agora ?? e?.texto)([...b.etapas].reverse().find((e) => e.estado === "rodando")) ?? (b.chip ? `Olhando a ${b.chip}` : "Pensando"))} · ${duracao(b.agora - b.inicio)}`;
  const lista = b.etapas.map((e) => `<li class="pensar-acao" data-estado="${e.estado}"><i class="pensar-ic" aria-hidden="true"></i><span>${esc(e.texto)}</span></li>`).join("");
  return `<div class="cv-bal" role="log" aria-label="Conversa com o ${esc(b.nome)} neste canvas"><button type="button" class="cv-aviso-x cv-bal-x" data-cv="fechar-balao" aria-label="Fechar">×</button>` +
    `<p class="cv-bal-voce"><span>${esc(b.pergunta)}</span>${b.chip ? `<i class="cv-chip">${esc(b.chip)}</i>` : ""}</p>` +
    `<div class="cv-bal-bot">${mascote ? `<span class="cv-av-mascote" aria-hidden="true">${mascote}</span>` : `<span class="cv-av cv-av-bot" aria-hidden="true">${esc(iniciais(b.nome))}</span>`}<div class="cv-bal-corpo">` +
    `<details class="pensar"${b.fim ? "" : " open"} data-fase="${b.fim ? "pronto" : ""}"><summary class="pensar-cab"><span class="fala-viva-estado">${cab}</span><span class="pensar-seta" aria-hidden="true"></span></summary>` +
    `<div class="pensar-corpo"><div class="pensar-dentro"><ol class="pensar-lista" role="list">${lista}</ol></div></div></details>` +
    // ADA-228 (teste com a IA real): a resposta vem em markdown, como no chat; formatada pelo mesmo textoFormatado.
    (b.resposta ? `<div class="cv-bal-txt">${textoFormatado(b.resposta)}</div>` : "") +
    (b.fim ? '<span class="cv-bal-pe">Também ficou na conversa · <button type="button" class="cv-link" data-cv="ver-conversa">abrir</button></span>' : "") +
    `</div></div></div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// No chat: o card do canvas (J2-1) e a linha "vN no ar" (J2-2) e a lista compacta (J7-5)

export function htmlDoCard(c: Pick<CanvasItemDto, "id" | "issue" | "titulo" | "versao" | "telas" | "jornadas" | "origemUrl">, o: { aviso?: string | null; origem?: boolean } = {}): string {
  const n = Math.min(6, Math.max(1, c.telas));
  return `<button type="button" class="cv-card" data-act="abrir-canvas" data-id="${esc(c.id)}" aria-label="Abrir ${esc(nomeCurto(c))} no Canvas">` +
    `<span class="cv-card-mini" aria-hidden="true"><span class="cv-card-telas">${"<i></i>".repeat(n)}</span></span>` +
    `<span class="cv-card-txt"><b>${c.issue ? `${esc(c.issue)} · ` : ""}${esc(c.titulo)}</b><span>v${c.versao} · ${plural(c.jornadas, "jornada", "jornadas")} · ${plural(c.telas, "tela", "telas")}</span>` +
    (o.aviso ? `<span class="cv-card-aviso">${esc(o.aviso)}</span>` : "") +
    (o.origem ? `<span class="cv-card-origem">${c.origemUrl ? `de ${esc(origemDoRepo(c.origemUrl))}` : "importado"}</span>` : "") + `</span>` +
    `<span class="cv-card-abrir">Abrir no Canvas <span aria-hidden="true">›</span></span></button>`;
}
/** ADA-228 (J4-3, J5-4): como no protótipo, "NOD-512 · v3 no ar / na mesma folha · resumo / Abrir ›". */
export const htmlDaLinhaNoAr = (c: Pick<CanvasItemDto, "id" | "issue" | "titulo" | "versao">, resumo: string | null): string =>
  `<button type="button" class="cv-atual" data-act="abrir-canvas" data-id="${esc(c.id)}"><span class="cv-atual-ic" aria-hidden="true">${ICONES.canvas}</span>` +
  `<span class="cv-atual-txt"><b>${esc(nomeCurto(c))} · v${c.versao} no ar</b><span>na mesma folha${resumo ? ` · ${esc(resumo)}` : ""}</span></span><span class="cv-atual-abrir">Abrir <span aria-hidden="true">›</span></span></button>`;
type ItemCompacto = Pick<CanvasItemDto, "id" | "issue" | "titulo" | "versao" | "estado" | "etapa"> & { aprovadoEm?: number | null };
const linkDoCanvas = (c: ItemCompacto): string => `<button type="button" class="cv-link" data-act="abrir-canvas" data-id="${esc(c.id)}">${esc(nomeCurto(c))}</button>`;
/** ADA-228 (J7-5): no chat, o balão "N esperam você:" traz só os que esperam a pessoa (issue · título · vN · etapa);
 *  os em produção e os aprovados ficam na fala do bot e no Canvas. Sem nenhum esperando, a lista vai inteira, por estado. */
export function htmlDaListaCompacta(lista: readonly ItemCompacto[]): string {
  const esperam = lista.filter((c) => c.estado === "esperando_voce");
  if (esperam.length) {
    return `<p class="cv-lst-cab">${esperam.length === 1 ? "1 espera você:" : `${esperam.length} esperam você:`}</p><ul class="cv-lst">${esperam.map((c) =>
      `<li>${linkDoCanvas(c)}<span>${esc([...(c.issue ? [c.titulo] : []), `v${c.versao}`, c.etapa ?? "pronto para ver"].join(" · "))}</span></li>`).join("")}</ul>`;
  }
  return `<p class="cv-lst-cab">Nenhum espera você.</p><ul class="cv-lst">${ORDEM_DO_ESTADO.flatMap((e) => lista.filter((c) => c.estado === e)).map((c) =>
    `<li><span class="cv-mi-est">${marcaDoEstado(c.estado, false)}</span>${linkDoCanvas(c)}<span class="cv-mudo">${esc(c.estado === "em_producao" ? c.etapa ?? "em produção" : aprovadoQuando(c.aprovadoEm))}</span></li>`).join("")}</ul>`;
}

/** ADA-228 (J6-1), como no protótipo: "https://gamefik.github.io/nod-prototipos/nod-463-canvas/" → "gamefik/nod-prototipos · nod-463-canvas". */
export function origemDoRepo(url: string): string {
  try {
    const u = new URL(url);
    const partes = u.pathname.split("/").filter(Boolean);
    const dono = u.host.endsWith(".github.io") ? u.host.slice(0, -".github.io".length) : null;
    if (dono && partes.length >= 2) return `${dono}/${partes[0]} · ${partes.slice(1).join("/")}`;
    return origemCurta(url);
  } catch { return url; }
}
/** A origem curta: "gamefik.github.io/nod-prototipos/nod-463-canvas/" → "nod-prototipos/nod-463-canvas". */
export function origemCurta(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "").replace(/^\/+/, "");
    return p || u.host;
  } catch { return url; }
}

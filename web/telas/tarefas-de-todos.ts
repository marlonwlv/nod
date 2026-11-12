import { esc } from "../lib/escape.ts";
import type { FiltrosDasTarefas, GrupoDasTarefas, LinhaDaTarefa, VistaDasTarefas } from "../lib/tarefas-de-todos.ts";
import { iconeDaPrioridade } from "./opcoes-quadro.ts";

/**
 * Tela 18d do Paper ("Tarefas de todos os bots"): título, subtítulo, Por quadro | Por bot | Minhas, "Nova tarefa", a busca,
 * os filtros, o "N te perguntou" e um cartão por grupo (o cabeçalho com o projeto, o quadro, o dono e o progresso; as
 * linhas com prioridade, código, título, coluna, responsável e o estado). Só HTML: o controlador trata os cliques.
 */

export type CargaDasTarefas =
  | { tipo: "carregando" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "pronto"; grupos: GrupoDasTarefas[]; resumo: string; perguntaram: number; total: number };

export type OpcoesDaTela = {
  carga: CargaDasTarefas;
  vista: VistaDasTarefas;
  filtros: FiltrosDasTarefas;
  /** O mascote do bot (o controlador recebe do main; o tamanho é do CSS). */
  avatar: (agenteId: string | null) => string;
};

const svg = (d: string, w = 16, extra = ""): string =>
  `<svg width="${w}" height="${w}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const IC = {
  quadro: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/>', 15),
  mais: svg('<path d="M8 3v10M3 8h10"/>', 14),
  busca: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>', 14),
  filtro: svg('<path d="M3 4.5h10M5 8h6M7 11.5h2"/>', 14),
  sino: svg('<path d="M4 11V7.5a4 4 0 018 0V11l1 1.5H3z"/><path d="M6.5 14h3"/>', 12),
  seta: svg('<path d="M6 4l4 4-4 4"/>', 12),
} as const;

const VISTAS: readonly [VistaDasTarefas, string][] = [["quadro", "Por quadro"], ["bot", "Por bot"], ["minhas", "Minhas"]];

function linha(l: LinhaDaTarefa, avatar: OpcoesDaTela["avatar"]): string {
  const quem = l.agenteId ? `<span class="tdt-av" aria-hidden="true">${avatar(l.agenteId)}</span><span class="tdt-quem-nome">${esc(l.agenteNome ?? "")}</span>` : `<span class="tdt-voce" aria-hidden="true">MW</span><span class="tdt-quem-nome">Você</span>`;
  return `<li class="tdt-linha"><button type="button" class="tdt-linha-bt" data-act="tdt-abrir" data-tarefa="${esc(l.id)}" data-quadro="${esc(l.quadroId)}" data-dono="${esc(l.donoId)}" aria-label="${esc(`${l.codigo} ${l.titulo}, ${l.coluna}${l.agenteNome ? `, ${l.agenteNome}` : ""}, ${l.direita.texto}`)}">` +
    `${iconeDaPrioridade(l.prioridade)}<span class="tdt-cod">${esc(l.codigo)}</span><span class="tdt-tit">${esc(l.titulo)}</span>` +
    `<span class="tdt-col"><i class="tdt-ponto tdt-ponto-${l.tom}" aria-hidden="true"></i>${esc(l.coluna)}</span>` +
    `<span class="tdt-quem">${quem}</span>` +
    `<span class="tdt-dir${l.direita.tom === "aguardando" ? " tdt-dir-aguardando" : ""}">${esc(l.direita.texto)}</span></button></li>`;
}

function grupo(g: GrupoDasTarefas, avatar: OpcoesDaTela["avatar"]): string {
  const dono = g.agenteId ? `<span class="tdt-av" aria-hidden="true">${avatar(g.agenteId)}</span><span class="tdt-pagina">página Tarefas de ${esc(g.agenteNome)}</span>` : "";
  const prog = g.progresso !== null
    ? `<span class="tdt-prog" role="img" aria-label="${g.progresso}% feito"><i style="width:${g.progresso}%"></i></span><span class="tdt-pct" aria-hidden="true">${g.progresso}%</span>` : "";
  const nome = g.projeto !== null ? `<span class="tdt-proj">${esc(g.projeto)}</span><span class="tdt-sep" aria-hidden="true">/</span><span class="tdt-nome">${esc(g.nome)}</span>` : `<span class="tdt-nome">${esc(g.nome)}</span>`;
  const cab = g.agenteId
    ? `<button type="button" class="tdt-cab" data-act="tdt-pagina" data-agente="${esc(g.agenteId)}"${g.quadroId ? ` data-quadro="${esc(g.quadroId)}"` : ""}>${IC.quadro}${nome}${dono}<span class="tdt-esp"></span>${prog}${IC.seta}</button>`
    : `<div class="tdt-cab">${IC.quadro}${nome}<span class="tdt-esp"></span></div>`;
  const corpo = g.linhas.length ? `<ul class="tdt-linhas">${g.linhas.map((l) => linha(l, avatar)).join("")}</ul>` : `<p class="tdt-vazio-grupo">Nada em aberto neste quadro.</p>`;
  return `<section class="tdt-grupo" aria-label="${esc(g.projeto ? `${g.projeto} / ${g.nome}` : g.nome)}">${cab}${corpo}</section>`;
}

export function renderTarefasDeTodos(o: OpcoesDaTela): string {
  const c = o.carga;
  const resumo = c.tipo === "pronto" ? ` · ${esc(c.resumo)}` : "";
  const seg = `<div class="tdt-seg" role="group" aria-label="Agrupar">${VISTAS.map(([v, r]) => `<button type="button" class="tdt-seg-bt" data-act="tdt-vista" data-vista="${v}" aria-pressed="${o.vista === v}">${r}</button>`).join("")}</div>`;
  const cab = `<header class="tdt-topo"><div class="tdt-titulos"><h1 class="tdt-h">Tarefas</h1><p class="tdt-sub">Os quadros de todos os seus bots num lugar só${resumo}</p></div>${seg}<button type="button" class="tdt-nova" data-act="tdt-nova">${IC.mais}<span>Nova tarefa</span></button></header>`;
  const perg = c.tipo === "pronto" && c.perguntaram > 0
    ? `<button type="button" class="tdt-perg" data-act="tdt-vista" data-vista="minhas">${IC.sino}<span>${c.perguntaram} te ${c.perguntaram === 1 ? "perguntou" : "perguntaram"}</span></button>` : "";
  const filtros = `<div class="tdt-filtros"><label class="tdt-busca">${IC.busca}<input type="search" class="tdt-busca-campo" data-tdt="busca" placeholder="Buscar tarefa por título ou código" value="${esc(o.filtros.busca)}" aria-label="Buscar tarefa por título ou código"></label>` +
    `<button type="button" class="tdt-filtro" data-act="tdt-aberto" aria-pressed="${o.filtros.emAberto}">${IC.filtro}<span>Status: ${o.filtros.emAberto ? "em aberto" : "todas"}</span></button>` +
    `<button type="button" class="tdt-filtro" data-act="tdt-prioridade" aria-pressed="${o.filtros.porPrioridade}"><span>Prioridade</span></button><span class="tdt-esp"></span>${perg}</div>`;
  let corpo: string;
  if (c.tipo === "carregando") corpo = `<div class="tdt-carregando" aria-busy="true"><div class="tdt-esq"></div><div class="tdt-esq"></div></div>`;
  else if (c.tipo === "erro") corpo = `<p class="tdt-erro" role="alert">${esc(c.mensagem)} <button type="button" class="tdt-link" data-act="tdt-reler">Tentar de novo</button></p>`;
  else if (c.total === 0) corpo = `<p class="tdt-vazio">Nenhum bot tem quadro ainda. Peça a um bot para criar o dele, ou abra a página Tarefas de um bot.</p>`;
  else if (!c.grupos.some((g) => g.linhas.length)) corpo = `<p class="tdt-vazio">Nenhuma tarefa ${o.vista === "minhas" ? "com você" : "com esse filtro"}.</p>`;
  else corpo = c.grupos.map((g) => grupo(g, o.avatar)).join("");
  return `<div class="tdt"><div class="tdt-coluna">${cab}${filtros}<div class="tdt-grupos">${corpo}</div></div></div>`;
}

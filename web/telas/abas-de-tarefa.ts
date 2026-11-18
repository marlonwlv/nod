import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { dividirAbas, type AbaDeTarefa } from "../lib/abas-de-tarefa.ts";
import { esc } from "../lib/render.ts";
import { aberto, tituloCurto, trabalhoPorId, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { ANEL_RODANDO, PONTO_PRECISA } from "./pilula-do-bot.ts";
import { IC_OK } from "./progresso-na-fala.ts";
import { agente } from "./trabalhos.ts";

/**
 * A fileira de abas da tarefa em tela cheia (ADR-187 §6, lote B, passo 3, definido em 2026-11-18; Paper 4j opção 1, 4k e
 * 4p). Só dentro de uma tarefa (ou da tarefa nova): "‹ Conversa", a linha fina, até 3 abas das tarefas que a pessoa abriu
 * deste bot, "N outras ⌄" e o "+" da tarefa nova. Sem ⋯: as ações moram na própria aba — a seta ⌄ aparece no hover e no
 * foco, o clique direito e o toque longo abrem o mesmo menu, e o duplo clique no nome renomeia ali mesmo. As regras de
 * quais abas existem moram em web/lib/abas-de-tarefa.ts; aqui só o HTML.
 */

export type FileiraDeAbas = {
  agenteId: string;
  /** A tarefa à vista; null = a tarefa nova (a aba "Nova tarefa", que só existe enquanto a pessoa está nela). */
  ativa: string | null;
  /** Todas as abas guardadas; a fileira filtra as do bot. */
  abas: readonly AbaDeTarefa[];
  /** A aba com o nome em edição e o texto de agora (o campo é redesenhado com ele). */
  renomeando: { id: string; texto: string } | null;
  /** O "+" (null = este bot não aceita tarefa da pessoa) e a tecla dele. */
  novaTarefa: { texto: string; aria: string } | null;
  /** O que fica no fim da fileira, à direita (o status e o Parar da tarefa à vista). */
  fim?: string;
  /** O nome novo que a pessoa acabou de dar, enquanto o servidor não o devolve. */
  titulos?: ReadonlyMap<string, string>;
};

// Paper 4p: seta ‹ de 12 (traço 1,4), seta ⌄ de 10 (traço 1,3), "+" de 14 (traço 1,5) e o quadrado da parada (o do Parar).
const SETA_VOLTAR = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 2.5 L4 6 L7.5 9.5"/></svg>';
const SETA_MENU = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.75 L5 6.25 L7.5 3.75"/></svg>';
const MAIS = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const QUADRADO = '<svg class="pf-aba-ic at-parada" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>';

/** O ícone do estado: o anel de quem roda, o ponto azul de quem precisa da pessoa, o ✓ de quem terminou e o quadrado da parada. */
export function iconeDaAba(t: Pick<TrabalhoDto, "estado"> | undefined): { html: string; texto: string } {
  switch (t?.estado) {
    case undefined: return { html: ANEL_RODANDO.replace("pf-anel\"", "pf-anel at-quieto\""), texto: "carregando" };
    case "rodando": return { html: ANEL_RODANDO, texto: "trabalhando" };
    case "na_fila": return { html: ANEL_RODANDO.replace("pf-anel\"", "pf-anel at-quieto\""), texto: "na fila" };
    case "precisa_de_voce":
    case "fechado_ocioso": return { html: PONTO_PRECISA, texto: "precisa de você" };
    case "terminado": return { html: `<span class="pf-aba-ic at-feita">${IC_OK}</span>`, texto: "terminou" };
    case "parado": return { html: QUADRADO, texto: "parada" };
    case "falhou": return { html: QUADRADO.replace("at-parada", "at-parada at-falhou"), texto: "falhou" };
  }
}

/** As abas guardadas deste bot cuja tarefa a tela conhece (a à vista sempre: ela pode estar carregando). */
export function abasDoBot(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, abas: readonly AbaDeTarefa[], agenteId: string, ativa: string | null): AbaDeTarefa[] {
  return abas.filter((a) => a.agenteId === agenteId && (a.id === ativa || trabalhoPorId(estado, a.id) !== undefined));
}

/**
 * O que "N outras ⌄" lista: as abas que não couberam (na ordem da fileira) e as outras tarefas abertas do bot que a
 * pessoa ainda não abriu (Paper 4o, jornada 7: "por 'outras ⌄' para as demais"), as mais novas primeiro.
 */
export function outrasDaFileira(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, abas: readonly AbaDeTarefa[], agenteId: string, ativa: string | null): TrabalhoDto[] {
  const doBot = abasDoBot(estado, abas, agenteId, ativa);
  const { aVista, outras } = dividirAbas(doBot, ativa);
  const naFileira = new Set([...aVista, ...outras].map((a) => a.id));
  const sobra = outras.map((a) => trabalhoPorId(estado, a.id)).filter((t): t is TrabalhoDto => t !== undefined);
  const naoAbertas = trabalhosConhecidos(estado).filter((t) => t.agenteId === agenteId && aberto(t) && !naFileira.has(t.id)).sort((a, b) => b.criadoEm - a.criadoEm);
  return [...sobra, ...naoAbertas];
}

function htmlDaAba(estado: Estado, aba: AbaDeTarefa, ativa: boolean, f: FileiraDeAbas): string {
  const t = trabalhoPorId(estado, aba.id);
  const titulo = f.titulos?.get(aba.id) ?? t?.titulo ?? "Tarefa";
  const renomeando = f.renomeando;
  const curto = tituloCurto(titulo);
  const ic = iconeDaAba(t);
  const id = esc(aba.id);
  if (renomeando?.id === aba.id) {
    return `<div class="at-aba ativa renomeando" data-aba="${id}"><span class="at-ir">${ic.html}<input id="at-nome" class="at-nome" data-id="${id}" value="${esc(renomeando.texto)}" maxlength="80" aria-label="Nome da tarefa" autocomplete="off" spellcheck="false"></span></div>`;
  }
  const nome = esc(curto);
  return `<div class="at-aba${ativa ? " ativa" : ""}" data-aba="${id}">`
    + `<button type="button" class="at-ir" data-act="aba-tarefa" data-id="${id}" data-segurar="menu-aba-tarefa"${ativa ? ' aria-current="page"' : ""} title="${esc(`${titulo} · ${ic.texto}`)}">${ic.html}<span class="at-titulo">${nome}</span><span class="at-sr">, ${esc(ic.texto)}</span></button>`
    + `<button type="button" class="at-seta" data-act="menu-aba-tarefa" data-id="${id}" aria-haspopup="menu" aria-label="Ações da tarefa ${nome}">${SETA_MENU}</button>`
    + `<button type="button" class="at-fechar" data-act="fechar-aba-tarefa" data-id="${id}" aria-label="Fechar a aba ${nome}"><span aria-hidden="true">×</span></button>`
    + "</div>";
}

/** A fileira inteira (Paper 4p): altura 40, abas de 36 coladas embaixo, a ativa com fundo leve e o traço de 2 px. */
export function renderFileiraDeAbas(estado: Estado, f: FileiraDeAbas): string {
  const bot = agente(estado, f.agenteId);
  const nomeDoBot = bot?.nome ?? "o bot";
  const doBot = abasDoBot(estado, f.abas, f.agenteId, f.ativa);
  const { aVista } = dividirAbas(doBot, f.ativa);
  const outras = outrasDaFileira(estado, f.abas, f.agenteId, f.ativa);
  const conversa = `<button type="button" class="at-conversa" data-act="aba-conversa" data-agente="${esc(f.agenteId)}" aria-label="Voltar para a conversa com ${esc(nomeDoBot)}">${SETA_VOLTAR}<span>Conversa</span></button><span class="at-traco" aria-hidden="true"></span>`;
  const abas = aVista.map((a) => htmlDaAba(estado, a, a.id === f.ativa, f)).join("");
  const nova = f.ativa === null ? '<div class="at-aba ativa at-nova"><span class="at-ir" aria-current="page"><span class="at-titulo">Nova tarefa</span></span></div>' : "";
  const maisOutras = outras.length
    ? `<button type="button" class="at-outras" data-act="abas-outras" data-agente="${esc(f.agenteId)}" aria-haspopup="menu">${outras.length} ${outras.length === 1 ? "outra" : "outras"}${SETA_MENU}</button>`
    : "";
  const mais = f.novaTarefa
    ? `<button type="button" class="at-mais" data-act="nova-tarefa" aria-label="Nova tarefa com ${esc(nomeDoBot)}" aria-keyshortcuts="${esc(f.novaTarefa.aria)}">${MAIS}<span class="at-dica" aria-hidden="true">Nova tarefa com ${esc(nomeDoBot)}<kbd>${esc(f.novaTarefa.texto)}</kbd></span></button>`
    : "";
  return `<nav class="abas-tarefa" aria-label="Tarefas abertas de ${esc(nomeDoBot)}">${conversa}${abas}${nova}${maisOutras}${mais}<span class="at-espaco"></span>${f.fim ? `<span class="at-fim">${f.fim}</span>` : ""}</nav>`;
}

/** Os itens de "N outras ⌄" (no menu da barra): o ícone do estado e o título curto; o último leva à tela Tarefas. */
export function htmlDoMenuDasOutras(outras: readonly TrabalhoDto[]): string {
  const itens = outras.map((t) => `<button type="button" role="menuitem" class="at-item" data-id="${esc(t.id)}">${iconeDaAba(t).html}<span class="at-item-titulo">${esc(tituloCurto(t.titulo))}</span></button>`).join("");
  return `<div role="menu" class="menu-aba-corpo" aria-label="Outras tarefas"><p class="menu-nome">Outras tarefas</p>${itens}<hr><button type="button" role="menuitem" data-tela-tarefas>Ver todas na tela Tarefas</button></div>`;
}

/**
 * O menu da aba (Paper 4p): "Esta tarefa", Renomear (com a dica do duplo clique), Ver na tela Tarefas, Fechar aba e, com
 * a tarefa aberta, Parar a tarefa em vermelho depois do traço. Arquivos, Finder e Copiar link do protótipo ficam para
 * quando a tarefa tiver endereço e lista de arquivos próprios.
 */
export function htmlDoMenuDaAba(t: Pick<TrabalhoDto, "titulo" | "estado"> | undefined): string {
  const nome = esc(tituloCurto(t?.titulo ?? "Tarefa"));
  const parar = t && aberto(t) ? '<hr><button type="button" role="menuitem" class="danger" data-aba-acao="parar">Parar a tarefa</button>' : "";
  return `<div role="menu" class="menu-aba-corpo" aria-label="Ações da tarefa ${nome}"><p class="menu-nome">Esta tarefa</p>`
    + '<button type="button" role="menuitem" data-aba-acao="renomear">Renomear<span class="at-menu-dica">· duplo clique</span></button>'
    + '<button type="button" role="menuitem" data-aba-acao="tarefas">Ver na tela Tarefas</button>'
    + '<button type="button" role="menuitem" data-aba-acao="fechar">Fechar aba</button>'
    + `${parar}</div>`;
}

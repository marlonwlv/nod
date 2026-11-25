import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { dividirAbas, tarefaAcabou, type AbaDeTarefa } from "../lib/abas-de-tarefa.ts";
import { esc } from "../lib/render.ts";
import { aberto, tituloCurto, trabalhoPorId, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { ANEL_RODANDO, PONTO_PRECISA } from "./icones-da-tarefa.ts";
import { IC_OK } from "./progresso-na-fala.ts";
import { agente } from "./trabalhos.ts";

/**
 * A fileira de abas da tarefa em tela cheia (ADR-187 §6, lote B, passo 3, definido em 2026-11-18; Paper 4j opção 1, 4k e
 * 4p). Modo abas (Paper 10b e 10c A, validação de 2026-11-18): a fileira começa pela própria pílula do bot, que é a aba
 * da Conversa (marcada nela, apagada numa tarefa), a linha fina, até 3 abas das tarefas deste bot, "N outras ⌄", o "+"
 * da tarefa nova e, no fim, "Fechar abas", que recolhe tudo de volta para a pílula. Sem ⋯: cada aba tem o × sempre à
 * vista (validação de 2026-11-19: a ação mais importante dela) e a seta ⌄ do menu, que entra ao lado do × no hover e no
 * foco; o clique direito e o toque longo abrem o mesmo menu, e o duplo clique no nome renomeia ali mesmo. As regras de quais abas existem moram em
 * web/lib/abas-de-tarefa.ts; aqui só o HTML.
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
  /**
   * Paper 10c A: a pílula do bot no começo da fileira, no lugar de "‹ Conversa" (o HTML vem de renderCabecalhoConversa).
   * `conversaAtiva`: a Conversa está à vista (a pílula fica marcada). `botaoDeAbas` (Paper 10b, 2d): o botão de abas, que só
   * aparece quando a página do bot à vista não é a Conversa.
   */
  pilula?: { html: string; conversaAtiva: boolean; botaoDeAbas?: string };
  /** A aba com o menu aberto: o chevron dela fica à vista (validação de 2026-11-18). */
  menuAberto?: string | null;
  /**
   * ADR-190 (Paper D7): a aba de lugar (o navegador do bot), depois da conversa e das tarefas; com o bot precisando da
   * pessoa (`frente`) ela passa à frente das tarefas. O HTML vem de web/lib/navegador-vista.ts (htmlAbaDeLugar).
   */
  lugares?: { html: string; frente: boolean; ativa?: boolean };
  /** 5e: lugares cuja aba a pessoa fechou com o bot ainda nele; entram em "N outras" (o ponto diz se algum está vivo). */
  lugaresFechados?: { quantos: number; ponto: "vivo" | "precisa" | null };
};

// Paper 4p: seta ‹ de 12 (traço 1,4), seta ⌄ de 10 (traço 1,3), "+" de 14 (traço 1,5) e o quadrado da parada (o do Parar).
const SETA_VOLTAR = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 2.5 L4 6 L7.5 9.5"/></svg>';
const SETA_MENU = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.75 L5 6.25 L7.5 3.75"/></svg>';
const MAIS = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const QUADRADO = '<svg class="pf-aba-ic at-parada" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>';

const XIS = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
// Paper 9i A / 10b: o ícone de abas (uma janela com duas abas em cima), traço 1,2.
const ICONE_ABAS = '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5"/><path d="M1.5 5.5h11M5.5 2.5v3M9 2.5v3"/></svg>';

/** Precisa da pessoa: a aba nunca fica escondida (dividirAbas) e o botão de abas ganha o ponto. */
export function precisaDaPessoa(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, id: string): boolean {
  const e = trabalhoPorId(estado, id)?.estado;
  return e === "precisa_de_voce" || e === "fechado_ocioso";
}

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
  const { aVista, outras } = dividirAbas(doBot, ativa, undefined, (id) => precisaDaPessoa(estado, id));
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
  return `<div class="at-aba${ativa ? " ativa" : ""}${f.menuAberto === aba.id ? " menu-aberto" : ""}" data-aba="${id}">`
    + `<button type="button" class="at-ir" data-act="aba-tarefa" data-id="${id}" data-segurar="menu-aba-tarefa"${ativa ? ' aria-current="page"' : ""} title="${esc(`${titulo} · ${ic.texto}`)}">${ic.html}<span class="at-titulo">${nome}</span><span class="at-sr">, ${esc(ic.texto)}</span></button>`
    + `<span class="at-acoes"><button type="button" class="at-seta" data-act="menu-aba-tarefa" data-id="${id}" aria-haspopup="menu" aria-label="Ações da tarefa ${nome}">${SETA_MENU}</button>`
    + `<button type="button" class="at-fechar" data-act="fechar-aba-tarefa" data-id="${id}" aria-label="Fechar a aba ${nome}" title="Fechar aba"><span aria-hidden="true">×</span></button></span>`
    + "</div>";
}

/** A fileira inteira (Paper 4p): altura 40, abas de 36 coladas embaixo, a ativa com fundo leve e o traço de 2 px. */
export function renderFileiraDeAbas(estado: Estado, f: FileiraDeAbas): string {
  const bot = agente(estado, f.agenteId);
  const nomeDoBot = bot?.nome ?? "o bot";
  const doBot = abasDoBot(estado, f.abas, f.agenteId, f.ativa);
  const { aVista } = dividirAbas(doBot, f.ativa, undefined, (id) => precisaDaPessoa(estado, id));
  const outras = outrasDaFileira(estado, f.abas, f.agenteId, f.ativa);
  const traco = '<span class="at-traco" aria-hidden="true"></span>';
  const conversa = f.pilula
    ? `<div class="at-pilula${f.pilula.conversaAtiva ? " ativa" : ""}">${f.pilula.html}${f.pilula.botaoDeAbas ?? ""}</div>${traco}`
    : `<button type="button" class="at-conversa" data-act="aba-conversa" data-agente="${esc(f.agenteId)}" aria-label="Voltar para a conversa com ${esc(nomeDoBot)}">${SETA_VOLTAR}<span>Conversa</span></button>${traco}`;
  const abas = aVista.map((a) => htmlDaAba(estado, a, a.id === f.ativa, f)).join("");
  const nova = f.ativa === null && !f.pilula?.conversaAtiva && !f.lugares?.ativa ?'<div class="at-aba ativa at-nova"><span class="at-ir" aria-current="page"><span class="at-titulo">Nova tarefa</span></span></div>' : "";
  // Paper 10b (3b): se uma escondida precisa da pessoa (mais delas do que cabem), "N outras" ganha o ponto.
  const fechados = f.lugaresFechados?.quantos ?? 0;
  const outraPrecisa = outras.some((t) => precisaDaPessoa(estado, t.id)) || f.lugaresFechados?.ponto === "precisa";
  const total = outras.length + fechados;
  // 5e: um lugar fechado com o bot vivo nele leva o ponto verde ("● 1 outra").
  const pontoLugar = f.lugaresFechados?.ponto && !outraPrecisa ? `<i class="nv-aba-lugar-ponto" data-ponto="${f.lugaresFechados.ponto}" aria-hidden="true"></i>` : "";
  const maisOutras = total
    ? `<button type="button" class="at-outras${outraPrecisa ? " precisa" : ""}" data-act="abas-outras" data-agente="${esc(f.agenteId)}" aria-haspopup="menu">${pontoLugar}${total} ${total === 1 ? "outra" : "outras"}${SETA_MENU}${outraPrecisa ? '<span class="at-sr">, uma precisa de você</span>' : ""}</button>`
    : "";
  const mais = f.novaTarefa
    ? `<button type="button" class="at-mais" data-act="nova-tarefa" aria-label="Nova tarefa com ${esc(nomeDoBot)}" aria-keyshortcuts="${esc(f.novaTarefa.aria)}">${MAIS}<span class="at-dica" aria-hidden="true">Nova tarefa com ${esc(nomeDoBot)}<kbd>${esc(f.novaTarefa.texto)}</kbd></span></button>`
    : "";
  // Paper 10b: "Fechar abas" é o único jeito de sair do modo abas (e Esc com o foco na fileira); não para nenhuma tarefa.
  const fechar = f.pilula ? `<button type="button" class="at-fechar-abas" data-act="fechar-abas" data-agente="${esc(f.agenteId)}" title="Volta para a pílula; as tarefas continuam">${XIS}<span>Fechar abas</span></button>` : "";
  const lugarFrente = f.lugares?.frente ? f.lugares.html : "";
  const lugarFim = f.lugares && !f.lugares.frente ? f.lugares.html : "";
  return `<nav class="abas-tarefa${f.pilula ? " abas-com-pilula" : ""}" aria-label="Tarefas abertas de ${esc(nomeDoBot)}">${conversa}${lugarFrente}${abas}${lugarFim}${nova}${maisOutras}${mais}<span class="at-espaco"></span>${fechar}${f.fim ? `<span class="at-fim">${f.fim}</span>` : ""}</nav>`;
}

/**
 * O botão de abas ao lado da pílula do bot (Paper 9i A e 10b): só o ícone, sem número — quantas e em que estado quem diz é
 * a pílula sobre o campo. O ponto quando alguma precisa da pessoa; o número (`.ba-num`) o CSS só mostra fora da página
 * Conversa (Paper 10b, 2d), onde a pílula do campo não existe. `null` = nada a mostrar (nenhuma aba, tarefa nem lugar).
 * ADR-190 (Paper 5c, 2): conta também os lugares ativos (o navegador do bot), com o ponto verde quando algum está ao vivo
 * (o azul de quem precisa da pessoa vence).
 */
export function botaoDeAbas(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, abas: readonly AbaDeTarefa[], agenteId: string, lugares: readonly { ponto: "vivo" | "precisa" }[] = []): string | null {
  const ids = new Set(abasDoBot(estado, abas, agenteId, null).map((a) => a.id));
  for (const t of trabalhosConhecidos(estado)) if (t.agenteId === agenteId && aberto(t)) ids.add(t.id);
  const total = ids.size + lugares.length;
  if (total === 0) return null;
  const tarefaPrecisa = [...ids].some((id) => precisaDaPessoa(estado, id));
  const lugarPrecisa = lugares.some((l) => l.ponto === "precisa");
  const precisa = tarefaPrecisa || lugarPrecisa;
  const vivo = !precisa && lugares.some((l) => l.ponto === "vivo");
  const tarefas = `${ids.size} ${ids.size === 1 ? "tarefa" : "tarefas"}`;
  const quem = tarefaPrecisa ? ", uma precisa de você" : lugarPrecisa ? ", o navegador precisa de você" : "";
  const rotulo = lugares.length
    ? `Mostrar em abas, ${[ids.size ? tarefas : "", `${lugares.length} ${lugares.length === 1 ? "lugar" : "lugares"}${vivo ? " ao vivo" : ""}`].filter(Boolean).join(" e ")}${quem}`
    : `Mostrar as tarefas em abas, ${tarefas}${quem}`;
  return `<button type="button" class="botao-abas${precisa ? " precisa" : vivo ? " vivo" : ""}" data-act="mostrar-em-abas" data-agente="${esc(agenteId)}" aria-label="${esc(rotulo)}" title="Mostrar em abas">${ICONE_ABAS}<span class="ba-num" aria-hidden="true">${total}</span><span class="ba-ponto" aria-hidden="true"></span></button>`;
}

/**
 * Os itens de "N outras ⌄" (no menu da barra): o ícone do estado e o título curto; depois, com feitas na fileira, "Tirar as
 * N feitas das abas" (Paper 10b, 3c), e o último leva à tela Tarefas.
 */
export function htmlDoMenuDasOutras(outras: readonly TrabalhoDto[], feitasNaFileira = 0, lugares = ""): string {
  const itens = outras.map((t) => `<button type="button" role="menuitem" class="at-item" data-id="${esc(t.id)}">${iconeDaAba(t).html}<span class="at-item-titulo">${esc(tituloCurto(t.titulo))}</span></button>`).join("");
  const tirar = feitasNaFileira > 0 ? `<button type="button" role="menuitem" data-tirar-feitas>Tirar ${feitasNaFileira === 1 ? "a feita" : `as ${feitasNaFileira} feitas`} das abas</button>` : "";
  // 5e: os lugares fechados vêm primeiro, com a dica do ⌘⇧T; sem outras tarefas, o menu é só deles.
  const tarefas = outras.length || !lugares ? `<p class="menu-nome">Outras tarefas</p>${itens}<hr>${tirar}<button type="button" role="menuitem" data-tela-tarefas>Ver todas na tela Tarefas</button>` : "";
  return `<div role="menu" class="menu-aba-corpo" aria-label="${lugares && !outras.length ? "Lugares fechados" : "Outras tarefas"}">${lugares}${lugares && tarefas ? "<hr>" : ""}${tarefas}</div>`;
}

/** As abas do bot cuja tarefa terminou de vez (para "Tirar as feitas das abas"). */
export function feitasDaFileira(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, abas: readonly AbaDeTarefa[], agenteId: string): string[] {
  return abas.filter((a) => a.agenteId === agenteId && tarefaAcabou(trabalhoPorId(estado, a.id)?.estado)).map((a) => a.id);
}

/**
 * O menu da aba (Paper 4p): "Esta tarefa", Renomear (com a dica do duplo clique), Ver na tela Tarefas, Fechar aba e, com
 * a tarefa aberta, Parar a tarefa em vermelho depois do traço. Arquivos, Finder e Copiar link do protótipo ficam para
 * quando a tarefa tiver endereço e lista de arquivos próprios.
 */
export function htmlDoMenuDaAba(t: Pick<TrabalhoDto, "titulo" | "estado"> | undefined, o: { fazerNaConversa?: boolean } = {}): string {
  const nome = esc(tituloCurto(t?.titulo ?? "Tarefa"));
  const parar = t && aberto(t) ? '<hr><button type="button" role="menuitem" class="danger" data-aba-acao="parar">Parar a tarefa</button>' : "";
  // ADR-187 §6 (lote B, passo 4, 2026-11-18): o "Fazer aqui" saiu do topo da tarefa (o Paper não o tem) e mora aqui, com
  // o nome do que faz, só quando valia lá (a tarefa sozinha que a pessoa pediu, ainda não terminada: acoesDeFazer).
  const fazer = o.fazerNaConversa ? '<button type="button" role="menuitem" data-aba-acao="fazer-aqui">Fazer na conversa<span class="at-menu-dica">· cancela a tarefa</span></button>' : "";
  return `<div role="menu" class="menu-aba-corpo" aria-label="Ações da tarefa ${nome}"><p class="menu-nome">Esta tarefa</p>`
    + '<button type="button" role="menuitem" data-aba-acao="renomear">Renomear<span class="at-menu-dica">· duplo clique</span></button>'
    + '<button type="button" role="menuitem" data-aba-acao="tarefas">Ver na tela Tarefas</button>'
    + fazer
    + '<button type="button" role="menuitem" data-aba-acao="fechar">Fechar aba</button>'
    + `${parar}</div>`;
}

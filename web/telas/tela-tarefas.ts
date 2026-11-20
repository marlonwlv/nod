import type { DonoDto } from "../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado, MostrarTarefas, Tela } from "../estado/reducer.ts";
import { acaoLocal, comAcaoLocal, htmlDasAcoes } from "../lib/esperas-de-colega.ts";
import { conversaViva, esperaNaTela, grupoDaLinha, linhaDoDono, quemPediu, temDonos, type GrupoDoBot, type LinhaDoDono } from "../lib/dono.ts";
import { avatarDoBot } from "../lib/mascote.ts";
import { duracaoCurta } from "../lib/relogio.ts";
import { esc, hora, horaSemZero, iconeAgente } from "../lib/render.ts";
import { aberto, agrupar, dicaSemContato, emEspera, filtrar, meiaNoiteDe, naFilaDaCota, pilulaDaCota, situacaoDe, tempoDe, textoNaFilaDaCota, tituloCurto, type GruposTrabalhos } from "../lib/trabalhos.ts";
import { iconeDaAba } from "./abas-de-tarefa.ts";
import { botAceitaTarefa } from "./nova-tarefa.ts";
import { ANEL_RODANDO, PONTO_PRECISA } from "./icones-da-tarefa.ts";
import { IC_OK } from "./progresso-na-fala.ts";
import { agente } from "./trabalhos.ts";

/**
 * A tela Tarefas (ADR-187 §8, lote B, passo 5, definido em 2026-11-18; Paper 5a "Por bot (abre nesta)", 5b "Por estado"
 * e 4e "Na tela Tarefas: onde você clica"). O topo: "Tarefas", o segmentado "Por bot | Por estado" colado no título e o
 * "+ Nova tarefa" à direita; embaixo, os chips Abertas N / Feitas / Todas e "Todos os bots ▾". Por bot: um cartão por
 * grupo (Precisa de você, Trabalhando, Esperando) com uma linha por bot, que abre as tarefas dele; "Livres: …" no fim.
 * Por estado: uma linha por tarefa (ícone, título e passo, o bot, a origem e o tempo). Clicar numa tarefa abre a tarefa em
 * tela cheia (a aba dela, passo 3). O aviso da máquina mora no selo da aba das tarefas (web/lib/aviso-da-maquina.ts) e
 * não se repete aqui; a pílula da cota da IA fica (não é da máquina).
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];
export type TelaTarefas = Extract<Tela, { tipo: "trabalhos" }>;

// Paper 5a: o anel tracejado de quem espera (14 de caixa, raio 5,5, traço 1,6 em 2 2), o par do anel de quem roda.
export const ANEL_ESPERANDO = '<svg class="pf-aba-ic tf-espera" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/></svg>';
export const SETA_DIREITA = '<svg class="tf-seta" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.75 2.5 L6.25 5 L3.75 7.5"/></svg>';
export const SETA_CIMA = '<svg class="tf-seta" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.25 L5 3.75 L7.5 6.25"/></svg>';
export const SETA_MENU = '<svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M2 3.5 H8 L5 7 Z"/></svg>';

export const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;
const precisaDeVoce = (t: Pick<TrabalhoDto, "estado">): boolean => t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso";
const esperandoAlgo = (t: TrabalhoDto): boolean => t.estado === "rodando" && emEspera(t);
const rodandoDeFato = (t: TrabalhoDto): boolean => t.estado === "rodando" && !emEspera(t);

/** O ícone do estado da tarefa: os da aba (anel, ponto azul, ✓, quadrado) e o anel tracejado de quem espera. */
export function iconeDaTarefa(t: TrabalhoDto): string {
  return esperandoAlgo(t) ? ANEL_ESPERANDO : iconeDaAba(t).html;
}

/** A origem que a linha mostra (ADR-187 §4: "do Quadro", "da rotina"); a da pessoa e a da rede não levam chip. */
export function origemNaTela(t: Pick<TrabalhoDto, "origem" | "pedidoPorNome">): string {
  if (t.origem === "quadro") return "do Quadro";
  if (t.origem === "rotina") return "da rotina";
  if (t.origem === "colega") return `pedido do ${t.pedidoPorNome ?? "colega"}`;
  return "";
}

/** Os bots que aceitam uma tarefa aberta pela pessoa (o "+ Nova tarefa" e a escolha do bot dele). */
export function botsDaNovaTarefa(estado: Pick<Estado, "frota" | "sessao">): Agente[] {
  return (estado.frota?.agentes ?? []).filter((a) => !a.excluidoEm && botAceitaTarefa(estado, a.id));
}

// ---- o topo -------------------------------------------------------------------------------------------------------------

/** O segmentado "Por bot | Por estado" (Paper 5a: 13/18, a escolhida em branco com o contorno de 0,5 px). */
function vista(porBot: boolean): string {
  const op = (id: string, nome: string, ativa: boolean): string => `<button type="button" class="tf-vista-op" data-act="vista-tarefas" data-id="${id}" aria-pressed="${ativa}">${nome}</button>`;
  return `<div class="tf-vista" role="group" aria-label="Ver as tarefas">${op("por-bot", "Por bot", porBot)}${op("por-estado", "Por estado", !porBot)}</div>`;
}

/** Os chips do Paper 5a: Abertas N (o número só nela), Feitas, Todas, o traço e "Todos os bots ▾" (ou o bot escolhido). */
function filtros(estado: Estado, tela: TelaTarefas, abertas: number): string {
  const mostrar = tela.mostrar ?? "abertas";
  const chip = (id: MostrarTarefas, nome: string): string => `<button type="button" class="tf-chip" data-act="mostrar-tarefas" data-id="${id}" aria-pressed="${mostrar === id}">${nome}</button>`;
  const bot = tela.bot ? agente(estado, tela.bot) : undefined;
  const bots = `<button type="button" class="tf-chip tf-chip-bots" data-act="bots-tarefas" aria-haspopup="menu" aria-pressed="${!!bot}">${esc(bot?.nome ?? "Todos os bots")}${SETA_MENU}</button>`;
  return `<div class="tf-filtros" role="group" aria-label="Filtrar tarefas">${chip("abertas", `Abertas <span class="tf-chip-n">${abertas}</span>`)}${chip("feitas", "Feitas")}${chip("todas", "Todas")}<span class="tf-traco" aria-hidden="true"></span>${bots}</div>`;
}

/** O menu de "Todos os bots ▾": todos e cada bot com tarefa (ou da frota), o escolhido marcado. */
export function htmlDoMenuDeBots(estado: Estado, atual: string | undefined): string {
  const comTarefa = new Set((estado.trabalhos?.trabalhos ?? []).map((t) => t.agenteId));
  const bots = (estado.frota?.agentes ?? []).filter((a) => !a.excluidoEm && a.papel !== "nod" && (comTarefa.has(a.id) || a.ownerId === estado.sessao?.pessoaId));
  const item = (id: string, nome: string, av: string): string => `<button type="button" role="menuitemradio" class="tf-menu-item" data-bot="${esc(id)}" aria-checked="${(atual ?? "") === id}">${av}<span class="at-item-titulo">${esc(nome)}</span>${(atual ?? "") === id ? `<span class="tf-menu-ok">${IC_OK}</span>` : ""}</button>`;
  return `<div role="menu" class="menu-aba-corpo" aria-label="Filtrar por bot"><p class="menu-nome">Bots</p>${item("", "Todos os bots", "")}${bots.map((b) => item(b.id, b.nome, iconeAgente(b, "sm"))).join("")}</div>`;
}

/** O menu do "+ Nova tarefa" sem bot na tela (definido em 2026-11-18): a pessoa escolhe com quem a tarefa abre. */
export function htmlDoMenuDaNovaTarefa(bots: readonly Agente[]): string {
  const itens = bots.map((b) => `<button type="button" role="menuitem" class="tf-menu-item" data-bot="${esc(b.id)}">${iconeAgente(b, "sm")}<span class="at-item-titulo">${esc(b.nome)}</span></button>`).join("");
  return `<div role="menu" class="menu-aba-corpo" aria-label="Nova tarefa com"><p class="menu-nome">Nova tarefa com</p>${itens}</div>`;
}

function topo(estado: Estado, tela: TelaTarefas, porBot: boolean, abertas: number): string {
  const nova = botsDaNovaTarefa(estado).length ? '<button type="button" class="tf-nova" data-act="nova-tarefa" aria-haspopup="menu">+ Nova tarefa</button>' : "";
  return `<header class="tf-cab"><h1>Tarefas</h1>${temDonos(estado) ? vista(porBot) : ""}<span class="tf-espaco"></span>${nova}</header>${filtros(estado, tela, abertas)}`;
}

/**
 * A tela inteira. Por bot com o dono de cada bot no servidor e sem `filtro`; senão Por estado (o servidor anterior ao
 * dono só tem esta).
 */
export function renderTelaTarefas(estado: Estado, tela: TelaTarefas = { tipo: "trabalhos" }): string {
  if (!estado.trabalhos) return '<section class="tela-tarefas" aria-label="Tarefas"><p class="tf-vazio">carregando…</p></section>';
  const porBot = temDonos(estado) && !tela.filtro;
  const todos = estado.trabalhos.trabalhos.filter((t) => !tela.bot || t.agenteId === tela.bot);
  const abertas = todos.filter(aberto).length;
  const cota = pilulaDaCota(estado.trabalhos.cota, estado.trabalhos.trabalhos, estado.agora, estado.trabalhos.pedidosNaFila);
  const corpo = porBot ? renderTarefasPorBot(estado, tela) : renderTarefasPorEstado(estado, tela);
  return `<section class="tela-tarefas" aria-label="Tarefas" data-vista="${porBot ? "por-bot" : "por-estado"}">${topo(estado, tela, porBot, abertas)}${cota}<div class="tf-lista">${corpo}</div></section>`;
}

// ---- Por bot (Paper 5a) -----------------------------------------------------------------------------------------------

export const GRUPOS_DO_BOT: { chave: GrupoDoBot; titulo: string }[] = [
  { chave: "precisa", titulo: "Precisa de você" },
  { chave: "trabalhando", titulo: "Trabalhando" },
  { chave: "esperando", titulo: "Esperando" },
];

export type LinhaDoBot = { bot: Agente; dono: DonoDto; linha: LinhaDoDono; grupo: GrupoDoBot };

/** As decisões abertas do bot (a mais nova primeiro): a pergunta vira o título da linha do bot sem tarefa. */
export function decisoesDoBot(estado: Estado, agenteId: string): { frase: string; desde: number }[] {
  const itens = (estado.suaVez?.itens ?? []).filter((i) => i.decisao.agenteId === agenteId && i.estadoColuna !== "vencido");
  return itens.map((i) => ({ frase: i.decisao.frase, desde: Date.parse(i.decisao.criadoEm) })).sort((a, b) => b.desde - a.desde);
}

/** As tarefas do bot na ordem da lista aberta: quem precisa de você, quem roda, quem espera, a fila (o mais antigo antes). */
export function tarefasDoBot(todos: readonly TrabalhoDto[], agenteId: string, hoje: number, mostrar: MostrarTarefas): TrabalhoDto[] {
  const doBot = todos.filter((t) => t.agenteId === agenteId);
  const ordem = (t: TrabalhoDto): number => (precisaDeVoce(t) ? 0 : rodandoDeFato(t) ? 1 : t.estado === "rodando" ? 2 : 3);
  const abertas = doBot.filter(aberto).sort((a, b) => ordem(a) - ordem(b) || a.criadoEm - b.criadoEm);
  const feitas = doBot.filter((t) => !aberto(t) && (t.terminadoEm ?? t.criadoEm) >= hoje).sort((a, b) => (b.terminadoEm ?? b.criadoEm) - (a.terminadoEm ?? a.criadoEm));
  return mostrar === "abertas" ? abertas : mostrar === "feitas" ? feitas : [...abertas, ...feitas];
}

/**
 * O título da linha do bot (Paper 5a): a tarefa principal (a aberta mais antiga); sem tarefa, a pergunta que espera a
 * pessoa, o que o bot faz na conversa ou o que ele espera.
 */
export function tituloDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const [principal] = todos.filter((t) => t.agenteId === x.bot.id && aberto(t)).sort((a, b) => (a.iniciadoEm ?? a.criadoEm) - (b.iniciadoEm ?? b.criadoEm));
  if (principal) return tituloCurto(principal.titulo);
  if (x.grupo === "precisa") {
    // A frase da fila da pergunta é "parei para perguntar a <pessoa>: <a pergunta>"; aqui só a pergunta.
    return decisoesDoBot(estado, x.bot.id)[0]?.frase.replace(/^parei para perguntar a [^:]{1,60}:\s*/, "") || "Esperando você";
  }
  return x.linha.texto;
}

/** "1 precisa de você · 8 rodando · 3 prontas" (Paper 5a): o que o bot tem em cada estado, com as prontas de hoje. */
export function contasDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[], hoje: number): string {
  const doBot = todos.filter((t) => t.agenteId === x.bot.id);
  const daConversa = x.dono.esperas.filter((e) => e.trabalhoId === null).length;
  const precisa = doBot.filter(precisaDeVoce).length || (x.grupo === "precisa" ? Math.max(1, decisoesDoBot(estado, x.bot.id).length) : 0);
  const partes = [
    precisa ? `${precisa} precisa de você` : "",
    doBot.filter(rodandoDeFato).length ? `${doBot.filter(rodandoDeFato).length} rodando` : "",
    doBot.filter(esperandoAlgo).length + daConversa ? `${doBot.filter(esperandoAlgo).length + daConversa} esperando` : "",
    doBot.filter((t) => t.estado === "na_fila").length + x.dono.fila.length ? `${doBot.filter((t) => t.estado === "na_fila").length + x.dono.fila.length} na fila` : "",
    prontas(doBot, hoje),
  ];
  return partes.filter(Boolean).join(" · ");
}

export function prontas(doBot: readonly TrabalhoDto[], hoje: number): string {
  const n = doBot.filter((t) => t.estado === "terminado" && (t.terminadoEm ?? t.criadoEm) >= hoje).length;
  return n ? plural(n, "pronta", "prontas") : "";
}

/** O tempo à direita: "há 9 min" (menos de uma hora) ou "desde 9:14"; a espera de colega vencida, "sem resposta há 26h". */
export function tempoDoBot(estado: Estado, x: LinhaDoBot): string {
  const desde = x.dono.estado.desde ?? estado.agora;
  if (x.grupo === "precisa") {
    const ds = decisoesDoBot(estado, x.bot.id);
    const pedido = x.dono.estado.frentes > 0 || !ds.length ? desde : Math.min(...ds.map((d) => d.desde));
    return `há ${duracaoCurta(estado.agora - pedido)}`;
  }
  if (x.grupo === "esperando") {
    // NOD-377: a única espera, de colega vencida, diz "sem resposta há 26h" no lugar do "desde".
    const esperas = x.dono.esperas.map((e) => comAcaoLocal(e)).filter((e) => e !== null);
    const [unica] = esperas;
    const vencida = esperas.length === 1 && unica?.tipo === "colega" && unica.colega?.vencida === true && unica.colega.tarefaId ? esperaNaTela(unica, estado.agora).colega?.resumo : undefined;
    return vencida ?? horaSemZero(desde);
  }
  return estado.agora - desde < 60 * 60_000 ? `há ${duracaoCurta(estado.agora - desde)}` : `desde ${horaSemZero(desde)}`;
}

export const ICONE_DO_GRUPO: Record<GrupoDoBot | "feitas", string> = { precisa: PONTO_PRECISA, trabalhando: ANEL_RODANDO, esperando: ANEL_ESPERANDO, feitas: `<span class="pf-aba-ic at-feita">${IC_OK}</span>` };

/** Uma linha de bot (Paper 5a): estado, mascote, nome (90), o título, as contas, o tempo (60) e a seta. */
function linhaDoBot(estado: Estado, b: { bot: Agente; grupo: GrupoDoBot | "feitas"; titulo: string; contas: string; tempo: string }, aberta: boolean, tarefas: string): string {
  const linha = `<button type="button" class="tf-linha-bot" data-act="bot-trabalhos" data-agente="${esc(b.bot.id)}" aria-expanded="${aberta}" data-grupo="${b.grupo}">`
    + `<span class="tf-ic">${ICONE_DO_GRUPO[b.grupo]}</span><span class="tf-av">${iconeAgente(b.bot, "sm", avatarDoBot(estado, b.bot))}</span><b class="tf-nome">${esc(b.bot.nome)}</b>`
    + `<span class="tf-titulo" title="${esc(b.titulo)}">${esc(b.titulo)}</span>${b.contas ? `<span class="tf-contas">${esc(b.contas)}</span>` : ""}<span class="tf-tempo">${esc(b.tempo)}</span>${aberta ? SETA_CIMA : SETA_DIREITA}</button>`;
  return `<div class="tf-bot">${linha}${aberta ? tarefas : ""}</div>`;
}

/** Uma tarefa dentro do bot aberto (Paper 5a): ícone, título (240), o passo (azul quando pergunta) e o tempo. */
function tarefaNoBot(t: TrabalhoDto, todos: readonly TrabalhoDto[], estado: Estado): string {
  const { passo, dica } = passoDaTarefa(t, todos, estado);
  return `<button type="button" class="tf-tarefa-bot" data-act="abrir-trabalho" data-id="${esc(t.id)}" data-estado="${t.estado}"><span class="tf-ic">${iconeDaTarefa(t)}</span>`
    + `<span class="tf-t-titulo"${tituloCurto(t.titulo) === t.titulo ? "" : ` title="${esc(t.titulo)}"`}>${esc(tituloCurto(t.titulo))}</span><span class="tf-t-passo"${dica ? ` title="${esc(dica)}"` : passo ? ` title="${esc(passo)}"` : ""}>${esc(passo)}</span><span class="tf-tempo">${esc(tempoDaTarefa(t, estado.agora))}</span></button>`;
}

// definido em 2026-11-18 (Paper 5a: três tarefas e "+ 9 tarefas do mesmo pedido"): até 4 cabem; mais que isso, 3 e a conta.
export const TAREFAS_A_VISTA = 3;

/** As tarefas do bot aberto, as esperas da conversa, a fila e o rodapé ("+ N tarefas do mesmo pedido", "Abrir a conversa"). */
function tarefasDoBotAberto(estado: Estado, x: { bot: Agente; dono: DonoDto | null }, todos: readonly TrabalhoDto[], mostrar: MostrarTarefas): string {
  const lista = tarefasDoBot(todos, x.bot.id, meiaNoiteDe(estado.agora), mostrar);
  const aVista = lista.length > TAREFAS_A_VISTA + 1 ? lista.slice(0, TAREFAS_A_VISTA) : lista;
  const resto = lista.slice(aVista.length);
  const lote = resto[0]?.loteId;
  const mesmoPedido = !!lote && resto.every((t) => t.loteId === lote);
  const mais = resto.length ? `<button type="button" class="tf-mais" data-act="vista-tarefas" data-id="por-estado" data-bot="${esc(x.bot.id)}">+ ${plural(resto.length, "tarefa", "tarefas")}${mesmoPedido ? " do mesmo pedido" : ""}</button>` : "";
  const esperas = mostrar === "feitas" || !x.dono ? "" : esperasDaConversa(estado, x.bot.id, x.dono);
  const fila = mostrar === "feitas" || !x.dono ? "" : x.dono.fila.map((p, i) => {
    // NOD-302: o pedido que a cota da IA segura diz "na fila (cota)" e quando volta.
    const cota = naFilaDaCota(estado.trabalhos, p.turnoId);
    return `<div class="tf-tarefa-bot estatica"${cota ? ' data-cota="1"' : ""}><span class="tf-ic tf-ordem" aria-hidden="true">${i + 1}</span><span class="tf-t-titulo">Na fila: ${esc(quemPediu(p))}</span><span class="tf-t-passo">${cota ? esc(textoNaFilaDaCota(cota, estado.agora)) : ""}</span><span class="tf-tempo">${esc(hora(p.desde))}</span></div>`;
  }).join("");
  const corpo = aVista.map((t) => tarefaNoBot(t, todos, estado)).join("") + esperas + fila;
  const conversa = `<button type="button" class="tf-abrir-conversa" data-act="abrir-conversa" data-conversa="${esc(x.bot.conversaId)}" data-agente="${esc(x.bot.id)}">Abrir a conversa com ${esc(x.bot.nome)} ›</button>`;
  return `<div class="tf-tarefas-do-bot" role="group" aria-label="Tarefas de ${esc(x.bot.nome)}"><div class="tf-trilho">${corpo || '<p class="tf-sub">Nenhuma tarefa aqui.</p>'}<div class="tf-rodape">${mais}${conversa}</div></div></div>`;
}

/** As esperas da própria conversa (sem tarefa): o colega, o comando, a volta marcada; vencida, com Cobrar e Desistir. */
export function esperasDaConversa(estado: Estado, agenteId: string, dono: DonoDto): string {
  return dono.esperas.filter((e) => e.trabalhoId === null).map((d) => comAcaoLocal(d)).filter((e) => e !== null).map((e) => {
    const v = esperaNaTela(e, estado.agora);
    const c = v.colega;
    // NOD-377 (protótipo, passo 10): vencida, "sem resposta há 26h" à direita e a linha de Cobrar/Desistir embaixo.
    const fim = c?.vencida ? c.resumo : v.tempo;
    const passo = c?.resumo && !c.vencida ? `${c.resumo} · ${v.linhas.at(-1) ?? ""}` : v.linhas.at(-1) ?? "";
    const acoes = c?.acoes ? htmlDasAcoes({ agenteId, tarefaId: c.tarefaId, colega: c.nome, podeCobrar: c.podeCobrar, fase: acaoLocal.fase(c.tarefaId), classe: "p377-acoes-tb" }) : "";
    return `<div class="tf-tarefa-bot estatica${c?.vencida ? " p377-frente" : ""}"><span class="tf-ic">${ANEL_ESPERANDO}</span><span class="tf-t-titulo">${esc(v.titulo)}</span><span class="tf-t-passo">${esc(passo)}</span><span class="tf-tempo${c?.vencida ? " p377-venc" : ""}">${esc(fim)}</span></div>${acoes}`;
  }).join("");
}

/** As linhas de bot pelo dono de cada um (ADR-099 item 10): o grupo sai do sinal da linha; sem linha, o bot está livre. */
export function linhasDosBots(estado: Estado): { linhas: LinhaDoBot[]; livres: Agente[] } {
  const linhas: LinhaDoBot[] = [];
  const livres: Agente[] = [];
  for (const dono of estado.trabalhos?.donos ?? []) {
    const bot = agente(estado, dono.estado.agenteId);
    if (!bot) continue;
    // O bot que só conversa: trabalhando pelo turno ao vivo da conversa, não pelo GET trabalhos (que fica velho).
    const vivaAgora = conversaViva(estado, bot.conversaId);
    const viva = { ...dono, estado: { ...dono.estado, conversaTrabalhando: vivaAgora, conversaPropriaTrabalhando: vivaAgora } };
    const linha = linhaDoDono(viva, estado.agora, { comConversa: true });
    const grupo = grupoDaLinha(linha);
    if (linha && grupo) linhas.push({ bot, dono: viva, linha, grupo });
    // definido em 2026-11-18 (Paper 5a): o Nod cuida da conta e não abre tarefas; não entra em "Livres".
    else if (bot.papel !== "nod") livres.push(bot);
  }
  const vistos = new Set([...linhas.map((l) => l.bot.id), ...livres.map((b) => b.id)]);
  // Livres são todos os bots sem linha, não só os donos sem nada (o bot que nunca trabalhou também está livre).
  for (const b of estado.frota?.agentes ?? []) if (!vistos.has(b.id) && b.papel !== "nod" && !b.excluidoEm) livres.push(b);
  return { linhas, livres };
}

const rotuloDoGrupo = (titulo: string, n: number): string => `<h2 class="tf-rotulo">${titulo} · ${plural(n, "bot", "bots")}</h2>`;

/** Por bot (Paper 5a): os três grupos em cartões, as feitas de hoje (com Feitas ou Todas) e "Livres: …" no fim. */
export function renderTarefasPorBot(estado: Estado, tela: TelaTarefas = { tipo: "trabalhos" }): string {
  const todos = estado.trabalhos?.trabalhos ?? [];
  const mostrar = tela.mostrar ?? "abertas";
  const hoje = meiaNoiteDe(estado.agora);
  const { linhas: todasAsLinhas, livres: todosOsLivres } = linhasDosBots(estado);
  const linhas = todasAsLinhas.filter((l) => !tela.bot || l.bot.id === tela.bot);
  const comLinha = new Set(linhas.map((l) => l.bot.id));
  const abertoAgora = (id: string): boolean => estado.botAbertoEmTrabalhos === id;
  const secoes = mostrar === "feitas" ? "" : GRUPOS_DO_BOT.map((g) => {
    // Em "Precisa de você", a ordem é a do pedido mais antigo; nos outros, a de quem começou antes.
    const pedidos = (l: LinhaDoBot) => decisoesDoBot(estado, l.bot.id).map((d) => d.desde);
    const chave = (l: LinhaDoBot): number => (g.chave === "precisa" && pedidos(l).length ? Math.min(...pedidos(l)) : l.dono.estado.desde ?? 0);
    const doGrupo = linhas.filter((l) => l.grupo === g.chave).sort((a, b) => chave(a) - chave(b));
    if (!doGrupo.length) return "";
    const html = doGrupo.map((x) => linhaDoBot(estado, { bot: x.bot, grupo: x.grupo, titulo: tituloDoBot(estado, x, todos), contas: contasDoBot(estado, x, todos, hoje), tempo: tempoDoBot(estado, x) }, abertoAgora(x.bot.id), abertoAgora(x.bot.id) ? tarefasDoBotAberto(estado, x, todos, mostrar) : "")).join("");
    return `<section class="tf-grupo" data-grupo="${g.chave}">${rotuloDoGrupo(g.titulo, doGrupo.length)}<div class="tf-cartao">${html}</div></section>`;
  }).join("");
  // Feitas hoje: com Feitas, todo bot que terminou algo hoje; com Todas, só os que não têm linha acima (sem repetir o bot).
  const feitasPorBot = mostrar === "abertas" ? [] : (estado.frota?.agentes ?? []).filter((b) => !b.excluidoEm && (!tela.bot || b.id === tela.bot) && (mostrar === "feitas" || !comLinha.has(b.id))).map((bot) => ({ bot, feitas: tarefasDoBot(todos, bot.id, hoje, "feitas") })).filter((f) => f.feitas.length > 0);
  const feitas = feitasPorBot.length ? `<section class="tf-grupo" data-grupo="feitas">${rotuloDoGrupo("Feitas hoje", feitasPorBot.length)}<div class="tf-cartao">${feitasPorBot.map(({ bot, feitas: lista }) => {
    const [ultima] = lista;
    const contas = [prontas(lista, hoje), lista.filter((t) => t.estado === "parado").length ? plural(lista.filter((t) => t.estado === "parado").length, "parada", "paradas") : "", lista.filter((t) => t.estado === "falhou").length ? `${lista.filter((t) => t.estado === "falhou").length} não terminou` : ""].filter(Boolean).join(" · ");
    const dono = estado.trabalhos?.donos?.find((d) => d.estado.agenteId === bot.id) ?? null;
    return linhaDoBot(estado, { bot, grupo: "feitas", titulo: tituloCurto(ultima?.titulo ?? ""), contas, tempo: ultima ? hora(ultima.terminadoEm ?? ultima.criadoEm) : "" }, abertoAgora(bot.id), abertoAgora(bot.id) ? tarefasDoBotAberto(estado, { bot, dono }, todos, "feitas") : "");
  }).join("")}</div></section>` : "";
  const nomesFeitas = new Set(feitasPorBot.map((f) => f.bot.id));
  const livres = mostrar === "feitas" || tela.bot ? [] : todosOsLivres.filter((b) => !nomesFeitas.has(b.id));
  // definido em 2026-11-18 (Paper 5a: oito nomes numa linha): até 12 nomes, depois "e mais N".
  const nomes = livres.map((b) => b.nome);
  const livresHtml = nomes.length ? `<p class="tf-livres">Livres: ${esc(nomes.length > 12 ? `${nomes.slice(0, 11).join(", ")} e mais ${nomes.length - 11}` : nomes.join(", "))}</p>` : "";
  const vazio = secoes || feitas ? "" : `<p class="tf-vazio">${mostrar === "feitas" ? "Nenhuma tarefa terminou hoje." : tela.bot ? "Este bot não está com nada agora." : "Nenhum bot está trabalhando agora. Quando um bot começar uma tarefa, esperar algo ou precisar de você, aparece aqui."}</p>`;
  return `${secoes}${feitas}${vazio}${livresHtml}`;
}

// ---- Por estado (Paper 5b) --------------------------------------------------------------------------------------------

export const GRUPOS_DO_ESTADO: { chave: keyof GruposTrabalhos; titulo: string; mostrar: MostrarTarefas }[] = [
  { chave: "precisa", titulo: "Precisa de você", mostrar: "abertas" },
  { chave: "trabalhando", titulo: "Trabalhando", mostrar: "abertas" },
  { chave: "esperando", titulo: "Esperando", mostrar: "abertas" },
  { chave: "fila", titulo: "Na fila", mostrar: "abertas" },
  { chave: "terminados", titulo: "Feitas hoje", mostrar: "feitas" },
];

/** O passo da linha ("rodando os testes de unidade", "esperando a CI"); a terminada diz como acabou. */
export function passoDaTarefa(t: TrabalhoDto, todos: readonly TrabalhoDto[], estado: Estado): { passo: string; dica: string } {
  if (!aberto(t)) return { passo: t.estado === "terminado" ? (t.ultimoPasso ?? "pronta") : t.estado === "parado" ? "parada" : "não terminou", dica: "" };
  const passo = situacaoDe(t, todos, estado.trabalhos?.segurando === true, estado.agora);
  // O passo corta: o title leva o texto inteiro e, sem contato com a máquina, o que fazer.
  return { passo, dica: passo.includes(" · sem contato") ? dicaSemContato(t, estado.agora) : "" };
}

/** O tempo à direita: rodando, há quanto ("22 min"); na fila, nada; terminada, a hora. */
export function tempoDaTarefa(t: TrabalhoDto, agora: number): string {
  if (!aberto(t)) return hora(t.terminadoEm ?? t.criadoEm);
  return t.estado === "na_fila" ? "" : tempoDe(t, agora);
}

/** Uma linha por tarefa (Paper 5b): ícone (16), título e passo, o bot (120), a origem (120) e o tempo (60). */
function linhaDaTarefa(estado: Estado, t: TrabalhoDto, todos: readonly TrabalhoDto[], grupo: keyof GruposTrabalhos): string {
  const bot = agente(estado, t.agenteId);
  const { passo, dica } = passoDaTarefa(t, todos, estado);
  const curto = tituloCurto(t.titulo);
  const origem = origemNaTela(t);
  return `<button type="button" class="tf-tarefa" data-act="abrir-trabalho" data-id="${esc(t.id)}" data-grupo="${grupo}"><span class="tf-ic">${iconeDaTarefa(t)}</span>`
    + `<span class="tf-meio"><span class="tf-t-titulo"${curto === t.titulo ? "" : ` title="${esc(t.titulo)}"`}>${esc(curto)}</span><span class="tf-t-passo"${dica ? ` title="${esc(dica)}"` : passo ? ` title="${esc(passo)}"` : ""}>${esc(passo)}</span></span>`
    + `<span class="tf-quem">${bot ? iconeAgente(bot, "sm") : ""}<span>${esc(bot?.nome ?? "bot")}</span></span><span class="tf-origem">${origem ? `<span class="tf-origem-chip">${esc(origem)}</span>` : ""}</span><span class="tf-tempo">${esc(tempoDaTarefa(t, estado.agora))}</span></button>`;
}

/** Por estado (Paper 5b): Precisa de você, Trabalhando, Esperando e Na fila (Abertas), Feitas hoje (Feitas), ou todos. */
export function renderTarefasPorEstado(estado: Estado, tela: TelaTarefas = { tipo: "trabalhos" }): string {
  const todos = estado.trabalhos?.trabalhos ?? [];
  const mostrar = tela.mostrar ?? "abertas";
  const grupos = agrupar(filtrar(todos, tela.filtro).filter((t) => !tela.bot || t.agenteId === tela.bot), estado.agora);
  const secoes = GRUPOS_DO_ESTADO.filter((g) => (mostrar === "todas" || g.mostrar === mostrar) && grupos[g.chave].length > 0).map((g) =>
    `<section class="tf-grupo" data-grupo="${g.chave}"><h2 class="tf-rotulo">${g.titulo} · ${grupos[g.chave].length}</h2><div class="tf-tarefas">${grupos[g.chave].map((t) => linhaDaTarefa(estado, t, todos, g.chave)).join("")}</div></section>`).join("");
  const vazio = mostrar === "feitas" ? "Nenhuma tarefa terminou hoje." : tela.bot || (tela.filtro && tela.filtro !== "todos") ? "Nada com este filtro agora." : "Nenhum bot está trabalhando agora. Quando um bot abrir uma tarefa, rodar uma rotina ou atender um colega, aparece aqui.";
  return secoes || `<p class="tf-vazio">${vazio}</p>`;
}

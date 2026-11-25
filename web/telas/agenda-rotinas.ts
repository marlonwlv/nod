import type { RotinaDto } from "../../src/contracts/api.ts";
import type { Estado } from "../estado/reducer.ts";
import type { AgendaUi } from "../estado/agenda.ts";
import {
  diaDe, ehWebhook, fraseDaUltima, hora, itemComProblema, linhaDaPassagem, MAX_PROXIMAS, MAX_ULTIMAS, montarLista, proximaVez, somarDias, tituloDaRotina,
  type BotDaAgenda, type LinhaRotina, type ListaRotinas, type Tom, type VisaoRotinas,
} from "../lib/agenda.ts";
import { botaoDaParada, desdeDaParada, rotuloVerEspera } from "../lib/execucao.ts";
import { ICONE } from "../lib/icones.ts";
import { esc, iconeAgente } from "../lib/render.ts";

/**
 * Configurações › Rotinas em lista (2026-11-19, Paper "Rotinas · lista no lugar da agenda", aprovado): no lugar da agenda
 * da NOD-85, a lista do que cada bot faz sozinho. "Precisa de você" só aparece com rotina parada e traz o botão que
 * resolve; "Próximas" vem na ordem da próxima vez, com a hora sempre na mesma coluna; "Pausadas" fica recolhida no fim.
 * A única cor da linha é o ponto da última vez. Clicar abre a rotina na própria linha (no celular, numa folha de baixo).
 */

type Ctx = { estado: Estado; ui: AgendaUi; celular: boolean; agora: number };

const SETA_BAIXO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const PAUSA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>';

const ponto = (tom: Tom) => `<i class="ag-ponto ag-t-${tom}" aria-hidden="true"></i>`;
const mascote = (bot: BotDaAgenda | null) => (bot ? `<span class="ag-masc" aria-hidden="true">${iconeAgente(bot, "sm")}</span>` : '<span class="ag-masc" aria-hidden="true"></span>');
const dadosHtml = (dados: Record<string, string>) => Object.entries(dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
/** O botão em pílula da lista (28 px); `pri` é o preto do botão principal. */
const pilula = (act: string, rotulo: string, dados: Record<string, string> = {}, classe = "") =>
  `<button type="button" class="ag-bt${classe ? ` ${classe}` : ""}" data-act="${esc(act)}"${dadosHtml(dados)}>${esc(rotulo)}</button>`;
const link = (act: string, rotulo: string, dados: Record<string, string> = {}, aria?: string) =>
  `<button type="button" class="ag-link" data-act="${esc(act)}"${dadosHtml(dados)}${aria ? ` aria-label="${esc(aria)}"` : ""}>${esc(rotulo)}</button>`;

const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const nomeDoBot = (l: LinhaRotina) => l.bot?.nome ?? "bot";
const titulo = (r: RotinaDto) => tituloDaRotina(r.rotina.instrucao, 64);

export function renderAgendaRotinas(estado: Estado, celular = false): string {
  const a = estado.agenda;
  const ctx: Ctx = { estado, ui: a.ui, celular, agora: estado.agora };
  const semRotina = estado.rotinas.length === 0 && (!a.dto || a.dto.rotinas.length === 0);
  const lista = montarLista({ rotinas: estado.rotinas, dto: a.dto, agentes: estado.frota?.agentes ?? [], filtro: { visao: a.ui.visao, bots: a.ui.bots, soProblema: a.ui.soProblema }, pessoaId: estado.sessao?.pessoaId ?? null, agora: estado.agora });
  const corpo = a.erro ? renderErro(celular) : !a.dto ? renderCarregando(celular) : semRotina ? renderVazio(celular) : renderGrupos(ctx, lista);
  const filtros = semRotina || a.erro ? "" : renderFiltros(ctx, lista);
  if (celular) {
    return `<section class="ag-agenda ag-cel" aria-label="Rotinas">${blocosDosLotes(ctx)}${filtros}<div class="ag-corpo">${corpo}</div>${folhaDoCelular(ctx, lista)}</section>`;
  }
  return `<section class="espaco-secao cfg-secao ag-agenda" aria-labelledby="ag-titulo">
    <div class="ag-cab"><div class="ag-cab-txt"><h2 id="ag-titulo">Rotinas</h2><p class="intro">${esc(introDasRotinas(estado))}</p></div>${semRotina ? "" : `<button type="button" class="ag-bt ag-nova" data-act="navegar" data-tela="nova-rotina">${ICONE.mais}Nova rotina</button>`}</div>
    ${blocosDosLotes(ctx)}
    ${filtros}
    <div class="ag-corpo">${corpo}</div>
  </section>`;
}

/** "O que seus bots fazem sozinhos, num horário. 14 rotinas de 9 bots." */
export function introDasRotinas(estado: Estado): string {
  const n = estado.rotinas.length;
  const bots = new Set(estado.rotinas.map((r) => r.rotina.agenteId)).size;
  const base = "O que seus bots fazem sozinhos, num horário.";
  if (n === 0) return base;
  return `${base} ${n} ${n === 1 ? "rotina" : "rotinas"} de ${bots} ${bots === 1 ? "bot" : "bots"}.`;
}

/* ---------- Pausadas juntas (desfazer a pausa em lote, #197) ---------- */

/**
 * No topo, antes dos filtros: um bloco por pausa em lote que ainda tem rotina pausada nele — "38 rotinas pausadas
 * juntas", "Reativar as 38" e "Ver quais". Reativar volta só as do lote; as que a pessoa pausou uma a uma ficam no
 * cartão Pausadas, no fim. Some quando o lote acaba. O primeiro bloco leva o id do ajuste "rotinas-pausadas", que a
 * busca das Configurações acha.
 */
function blocosDosLotes(ctx: Ctx): string {
  const minhas = ctx.estado.rotinas.filter((r) => r.rotina.ownerId === ctx.estado.sessao?.pessoaId && r.rotina.estado === "pausada" && r.rotina.pausaLote);
  if (minhas.length === 0) return "";
  const lotes = new Map<string, { em: number; rotinas: RotinaDto[] }>();
  for (const r of minhas) {
    const l = r.rotina.pausaLote!;
    const g = lotes.get(l.id) ?? { em: l.em, rotinas: [] };
    g.rotinas.push(r);
    lotes.set(l.id, g);
  }
  const botDe = (r: RotinaDto) => ctx.estado.frota?.agentes.find((a) => a.id === r.rotina.agenteId) ?? null;
  const hoje = diaDe(ctx.agora);
  return [...lotes.entries()].sort((a, b) => b[1].em - a[1].em).map(([id, g], i) => {
    const n = g.rotinas.length;
    const bots = new Set(g.rotinas.map((r) => r.rotina.agenteId)).size;
    const aberto = ctx.ui.loteAberto === id;
    const nome = `${n} ${n === 1 ? "rotina pausada" : "rotinas pausadas juntas"}`;
    const frase = `${quandoDoLote(g.em, hoje)}${bots > 1 ? ` · de ${bots} bots` : ""}. Reativar volta só ${n === 1 ? "esta" : "estas"}; as que você pausou antes ficam como estão.`;
    const lista = aberto
      ? `<ul class="ag-lote-lista" id="ag-lote-${esc(id)}">${g.rotinas.map((r) => `<li>${mascote(botDe(r))}<span class="ag-nome">${esc(titulo(r))}</span>${link("ativar-rotina", "Ativar", { id: r.rotina.id }, `Ativar a rotina ${tituloDaRotina(r.rotina.instrucao)}`)}</li>`).join("")}</ul>`
      : "";
    return `<div class="ag-lote"${i === 0 ? ' id="ajuste-rotinas-pausadas"' : ""} role="group" aria-label="${esc(nome)}">
      <div class="ag-lote-cab"><span class="ag-lote-ic" aria-hidden="true">${PAUSA}</span>
        <div class="ag-lote-txt"><b>${esc(nome)}</b><p>${esc(frase)}</p></div>
        ${pilula("reativar-lote", n === 1 ? "Reativar" : `Reativar as ${n}`, { id }, "ag-bt-pri ag-lote-reativar")}</div>
      <button type="button" class="ag-link ag-lote-ver" data-act="agenda-lote" data-id="${esc(id)}" aria-expanded="${aberto}" aria-controls="ag-lote-${esc(id)}">${aberto ? "Esconder" : "Ver quais"}</button>
      ${lista}
    </div>`;
  }).join("");
}

const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "Hoje às 09:36", "Ontem às 18:02", "seg 17 às 09:00". */
export function quandoDoLote(em: number, hoje: string): string {
  const dia = diaDe(em);
  const d = new Date(em);
  const rel = dia === hoje ? "Hoje" : dia === somarDias(hoje, -1) ? "Ontem" : `${SEMANA_CURTA[d.getDay()]} ${d.getDate()}`;
  return `${rel} às ${hora(em)}`;
}

/* ---------- Os filtros ---------- */

const VISOES: { id: VisaoRotinas; rotulo: string }[] = [{ id: "todas", rotulo: "Todas" }, { id: "ativas", rotulo: "Ativas" }, { id: "pausadas", rotulo: "Pausadas" }];

function renderFiltros(ctx: Ctx, lista: ListaRotinas): string {
  const visoes = VISOES.map((v) => `<button type="button" class="ag-visao" data-act="agenda-visao" data-visao="${v.id}" aria-pressed="${ctx.ui.visao === v.id}">${v.rotulo}<span class="ag-conta">${lista.conta[v.id]}</span></button>`).join("");
  const escolhido = ctx.ui.bots[0] ?? "";
  const opcoes = lista.bots.map((b) => `<option value="${esc(b.id)}"${b.id === escolhido ? " selected" : ""}>${esc(b.nome)}</option>`).join("");
  const bots = lista.bots.length < 2 && !escolhido ? "" : `<label class="ag-fbot"><span class="ag-sr">Filtrar por bot</span><select data-agenda-bot><option value="">Todos os bots</option>${opcoes}</select>${SETA_BAIXO}</label>`;
  const problema = ctx.ui.soProblema ? `<button type="button" class="ag-fprob" data-act="agenda-so-problema" aria-label="Tirar o filtro Só com problema">Só com problema <span aria-hidden="true">✕</span></button>` : "";
  return `<div class="ag-filtros"><div class="ag-visoes" role="group" aria-label="Mostrar">${visoes}</div>${problema}${bots}</div>`;
}

/* ---------- Os grupos ---------- */

function renderGrupos(ctx: Ctx, lista: ListaRotinas): string {
  const { precisa, proximas, pausadas } = lista;
  if (precisa.length + proximas.length + pausadas.length === 0) return renderFiltroVazio(ctx);
  const grupos: string[] = [];
  if (precisa.length) grupos.push(grupo("precisa", "Precisa de você", precisa.map((l) => linha(ctx, l, "precisa")).join("")));
  if (proximas.length) {
    const mostrar = ctx.ui.verTodas ? proximas : proximas.slice(0, MAX_PROXIMAS);
    const resto = proximas.length - mostrar.length;
    const mais = resto > 0
      ? `<li class="ag-mais"><span>Mais ${resto} ${resto === 1 ? "ativa" : "ativas"}</span>${link("agenda-ver-todas", "Ver todas")}</li>`
      : proximas.length > MAX_PROXIMAS ? `<li class="ag-mais"><span></span>${link("agenda-ver-todas", "Ver menos")}</li>` : "";
    grupos.push(grupo("proximas", "Próximas", mostrar.map((l) => linha(ctx, l, "proxima")).join("") + mais, ctx.celular ? "" : "Próxima vez"));
  }
  if (pausadas.length) grupos.push(grupoDasPausadas(ctx, pausadas));
  return grupos.join("");
}

function grupo(id: string, nome: string, linhas: string, direita = ""): string {
  return `<section class="ag-grupo" aria-labelledby="ag-g-${id}"><div class="ag-grupo-cab"><h3 id="ag-g-${id}">${esc(nome)}</h3>${direita ? `<span aria-hidden="true">${esc(direita)}</span>` : ""}</div><ul class="ag-cartao">${linhas}</ul></section>`;
}

/** Na visão Todas, as pausadas ficam num cartão recolhido; na visão Pausadas, abertas. */
function grupoDasPausadas(ctx: Ctx, todas: LinhaRotina[]): string {
  if (ctx.ui.visao === "pausadas") return grupo("pausadas", "Pausadas", todas.map((l) => linha(ctx, l, "pausada")).join(""));
  // As de uma pausa em lote já estão no bloco delas, no topo (blocosDosLotes); aqui, só as pausadas uma a uma.
  const pausadas = todas.filter((l) => !l.dto.rotina.pausaLote);
  if (pausadas.length === 0) return "";
  const linhas = pausadas.map((l) => linha(ctx, l, "pausada")).join("");
  const aberto = ctx.ui.pausadasAbertas;
  const nomes = [...new Set(pausadas.map(nomeDoBot))];
  const quem = nomes.length <= 3 ? juntar(nomes) : `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
  const n = pausadas.length;
  const cab = `<li class="ag-item"><button type="button" class="ag-linha ag-recolhido" data-act="agenda-pausadas" aria-expanded="${aberto}" aria-controls="ag-pausadas-lista">
    <span class="ag-masc ag-masc-ic" aria-hidden="true">${PAUSA}</span>
    <span class="ag-txt"><span class="ag-nome">${n} ${n === 1 ? "rotina pausada" : "rotinas pausadas"}</span><span class="ag-meta">${esc(`${quem}. ${n === 1 ? "Não roda" : "Não rodam"} até você ativar.`)}</span></span>
    <span class="ag-seta">${SETA_BAIXO}</span></button></li>`;
  return `<section class="ag-grupo" aria-labelledby="ag-g-pausadas"><div class="ag-grupo-cab"><h3 id="ag-g-pausadas">Pausadas</h3></div><ul class="ag-cartao" id="ag-pausadas-lista">${cab}${aberto ? linhas : ""}</ul></section>`;
}

const juntar = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

function renderFiltroVazio(ctx: Ctx): string {
  const bot = ctx.ui.bots[0] ? ctx.estado.frota?.agentes.find((a) => a.id === ctx.ui.bots[0])?.nome : undefined;
  const frase = ctx.ui.soProblema ? "Nenhuma rotina com problema." : ctx.ui.visao === "pausadas" ? "Nenhuma rotina pausada." : ctx.ui.visao === "ativas" ? "Nenhuma rotina ativa." : "Nenhuma rotina aqui.";
  return `<p class="ag-sem">${esc(bot ? `${frase.slice(0, -1)} de ${bot}.` : frase)} ${link("agenda-todos", "Ver todas")}</p>`;
}

/* ---------- A linha ---------- */

type Tipo = "precisa" | "proxima" | "pausada";

/** O que vai depois do nome do bot: "seg a sex 17:00 · falhou ontem: …". */
function metaDaLinha(ctx: Ctx, l: LinhaRotina, tipo: Tipo): { tom: Tom; texto: string } {
  const r = l.dto;
  const quando = minuscula(r.resumo);
  if (tipo === "precisa") {
    if (r.bloqueio) {
      const b = r.bloqueio;
      const falta = b.motivo === "sem_conexao" ? `falta conectar o ${b.app}` : `sem acesso ao ${b.app}`;
      return { tom: "erro", texto: `${nomeDoBot(l)} · ${quando} · parada ${desdeDaParada(b, ctx.agora)}: ${falta}` };
    }
    return { tom: "erro", texto: `${nomeDoBot(l)} · ${quando} · parada, esperando sua resposta` };
  }
  if (tipo === "pausada") {
    const volta = r.retomada ? `pausada até ${r.retomada.texto}` : "pausada";
    return { tom: "neutro", texto: `${nomeDoBot(l)} · ${quando} · ${volta}` };
  }
  const ultima = l.passagens[0];
  // A rotina de outra pessoa parada não vai para "Precisa de você" (só a dona resolve), mas o ponto diz que parou.
  if (r.bloqueio) return { tom: "erro", texto: `${nomeDoBot(l)} · ${quando} · parada: sem acesso ao ${r.bloqueio.app}` };
  return { tom: ultima?.tom ?? "neutro", texto: `${nomeDoBot(l)} · ${quando} · ${fraseDaUltima(ultima, ctx.agora)}` };
}

function colunaDaDireita(ctx: Ctx, l: LinhaRotina, tipo: Tipo): string {
  if (tipo !== "proxima") return "";
  if (ehWebhook(l.dto)) return '<span class="ag-prox"><small>quando chamarem</small></span>';
  const p = proximaVez(l.dto.proximaExecucao, ctx.agora, l.dto.rotina.fusoIana);
  return `<span class="ag-prox"><span class="ag-sr">Próxima vez: </span><b>${esc(p.hora)}</b><small>${esc(p.quando)}</small></span>`;
}

/** O botão ao lado da linha, fora do que abre: o que resolve a parada, ou Ativar na pausada. Só a dona. */
function acaoDaLinha(l: LinhaRotina, tipo: Tipo): string {
  if (!l.minha) return "";
  const r = l.dto;
  if (tipo === "precisa") {
    if (r.bloqueio) return botaoDaParada(r.bloqueio, "ag-bt ag-bt-pri");
    if (r.perguntaPendente) return `<button type="button" class="ag-bt ag-bt-pri" data-act="ver-pergunta-da-rotina" data-id="${esc(r.perguntaPendente.decisaoId)}" data-conversa="${esc(r.rotina.conversaId)}" data-agente="${esc(r.rotina.agenteId)}">${esc(rotuloVerEspera(r.perguntaPendente))}</button>`;
  }
  if (tipo === "pausada") return link("ativar-rotina", "Ativar", { id: r.rotina.id }, `Ativar a rotina ${titulo(r)}`);
  return "";
}

function linha(ctx: Ctx, l: LinhaRotina, tipo: Tipo): string {
  const r = l.dto.rotina;
  const aberta = ctx.ui.aberto === r.id;
  const det = `ag-det-${r.id}`;
  const meta = metaDaLinha(ctx, l, tipo);
  const abreNoLugar = !ctx.celular;
  const bt = `<button type="button" class="ag-linha" data-act="agenda-linha" data-id="${esc(r.id)}" aria-expanded="${aberta && abreNoLugar}"${abreNoLugar ? ` aria-controls="${det}"` : ' aria-haspopup="dialog"'}>
    ${mascote(l.bot)}
    <span class="ag-txt"><span class="ag-nome">${esc(titulo(l.dto))}</span><span class="ag-meta">${ponto(meta.tom)}<span class="ag-meta-txt">${esc(meta.texto)}</span></span></span>
    ${colunaDaDireita(ctx, l, tipo)}${tipo === "proxima" && !ctx.celular ? `<span class="ag-pontos" aria-hidden="true">${ICONE.pontos}</span>` : ""}
  </button>`;
  return `<li class="ag-item${aberta && abreNoLugar ? " ag-aberta" : ""} ag-${tipo}"><div class="ag-linha-caixa">${bt}${acaoDaLinha(l, tipo)}</div>${aberta && abreNoLugar ? `<div class="ag-det" id="${det}">${detalhe(ctx, l)}</div>` : ""}</li>`;
}

/* ---------- A rotina aberta (na linha, ou na folha do celular) ---------- */

function ondeRoda(r: RotinaDto): string | null {
  const o = r.ondeRoda;
  if (!o) return null;
  if (o.modo === "qualquer" && !o.dependeDoMac) return "Na primeira máquina sua que estiver ligada";
  const nome = o.maquina?.nome ?? "seu Mac";
  return o.dependeDoMac ? `${nome} · precisa estar ligado e com o nod aberto` : nome;
}

function dados(ctx: Ctx, r: RotinaDto): string {
  // PR #333 (achado 17): o resumo já pode trazer o fuso ("todo dia às 09:00 (America/Sao_Paulo)"); não repete.
  const fuso = ctx.estado.agenda.dto && r.rotina.fusoIana !== ctx.estado.agenda.dto.fuso && !r.resumo.includes(r.rotina.fusoIana) ? ` (fuso ${r.rotina.fusoIana})` : "";
  const linhas: [string, string][] = [["Quando", `${r.resumo}${fuso}`]];
  const onde = ondeRoda(r);
  if (onde) linhas.push(["Onde roda", onde]);
  linhas.push(["Antes de agir", r.rotina.exigeAprovacao ? "Pede sua aprovação" : "Faz sem perguntar"]);
  if (r.rotina.estado === "pausada") linhas.push(["Pausada", r.retomada ? `Volta sozinha ${r.retomada.texto}` : "Até você ativar"]);
  return `<dl class="ag-dados">${linhas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

function ultimasVezes(ctx: Ctx, l: LinhaRotina): string {
  const ps = l.passagens.slice(0, MAX_ULTIMAS);
  const itens = ps.length
    ? ps.map((p) => { const t = linhaDaPassagem(p, ctx.agora); return `<li>${ponto(p.tom)}<span class="ag-quando">${esc(t.quando)}</span><span>${esc(t.texto)}</span></li>`; }).join("")
    : '<li class="ag-mudo">Ainda não rodou.</li>';
  return `<div class="ag-ultimas"><h4>Últimas vezes</h4><ul>${itens}</ul></div>`;
}

type Acao = { act: string; rotulo: string; dados: Record<string, string>; pri?: boolean };

function acoesDaRotina(ctx: Ctx, l: LinhaRotina): Acao[] {
  // Revisão 1 do PR #595: rotina de outra pessoa (equipe) só se vê; pausar, ativar e testar são da dona.
  if (!l.minha) return [];
  const r = l.dto.rotina;
  const pausada = r.estado === "pausada";
  return [
    ...(ctx.estado.ocupado ? [] : [{ act: "executar-rotina", rotulo: "Testar agora", dados: { id: r.id, agente: r.agenteId } }]),
    { act: pausada ? "ativar-rotina" : "pausar-rotina", rotulo: pausada ? "Ativar" : "Pausar", dados: { id: r.id }, pri: pausada },
    { act: "abrir-conversa", rotulo: "Mudar pela conversa", dados: { conversa: r.conversaId, agente: r.agenteId } },
    // PR #333 (achado 4): excluir pela tela, com a confirmação do diálogo; antes só pela conversa com o bot.
    { act: "excluir-rotina", rotulo: "Excluir", dados: { id: r.id, titulo: titulo(l.dto) } },
  ];
}

/** NOD-412: "Pausar até amanhã" e "Pausar até segunda" (00:00 no fuso da rotina; segunda = a próxima, nunca hoje). */
export function datasDePausa(fusoIana: string, agora: number): { rotulo: string; ate: string }[] {
  let hoje: string;
  try { hoje = new Intl.DateTimeFormat("en-CA", { timeZone: fusoIana, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(agora)); } catch { return []; }
  const [y, m, d] = hoje.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const dia = (n: number) => new Date(base + n * 86_400_000).toISOString().slice(0, 10);
  const semana = new Date(base).getUTCDay();
  const ateSegunda = ((8 - semana) % 7) || 7;
  const datas = [{ rotulo: "Pausar até amanhã", ate: dia(1) }];
  if (ateSegunda > 1) datas.push({ rotulo: "Pausar até segunda", ate: dia(ateSegunda) });
  return datas;
}

/** NOD-412: pausar com volta marcada — amanhã, segunda ou uma data e hora (hora local da rotina). */
function pausarAte(ctx: Ctx, l: LinhaRotina): string {
  const r = l.dto.rotina;
  if (!l.minha || r.estado !== "ativa") return "";
  const datas = datasDePausa(r.fusoIana, ctx.agora);
  const min = datas[0]?.ate ?? "";
  const rapidas = datas.map((d) => link("pausar-rotina", d.rotulo.replace("Pausar até ", ""), { id: r.id, ate: d.ate }, d.rotulo)).join("");
  return `<p class="ag-pausar-ate"><span>Pausar até</span>${rapidas}<span class="ag-pausar-data"><input type="datetime-local" data-ate-rotina="${esc(r.id)}" min="${esc(min)}T00:00" aria-label="${esc(`Data e hora em que a rotina ${r.instrucao} volta sozinha (${r.fusoIana})`)}">${link("pausar-rotina-escolhida", "Pausar até…", { id: r.id })}</span></p>`;
}

function detalhe(ctx: Ctx, l: LinhaRotina): string {
  const r = l.dto;
  const parada = l.minha && r.bloqueio ? botaoDaParada(r.bloqueio, "ag-bt ag-bt-pri") : "";
  const acoes = acoesDaRotina(ctx, l).map((a) => pilula(a.act, a.rotulo, a.dados, a.pri && !parada ? "ag-bt-pri" : "")).join("");
  const alheia = l.minha ? "" : '<p class="ag-mudo">Rotina de outra pessoa da equipe: só ela muda.</p>';
  return `<p class="ag-frase">${esc(r.rotina.instrucao)}</p>${dados(ctx, r)}${ultimasVezes(ctx, l)}${alheia}${parada || acoes ? `<div class="ag-acoes">${parada}${acoes}</div>` : ""}${pausarAte(ctx, l)}`;
}

/* ---------- Celular ---------- */

function linhaPorId(lista: ListaRotinas, id: string | null): LinhaRotina | null {
  if (!id) return null;
  return [...lista.precisa, ...lista.proximas, ...lista.pausadas].find((l) => l.dto.rotina.id === id) ?? null;
}

/** A folha de baixo (toque) ou o menu (toque longo). Uma por vez; o véu fecha. */
function folhaDoCelular(ctx: Ctx, lista: ListaRotinas): string {
  if (!ctx.celular) return "";
  const veu = '<div class="ag-veu" data-act="agenda-fechar" aria-hidden="true"></div>';
  const item = (a: Acao) => `<button type="button" class="ag-folha-item" data-act="${esc(a.act)}"${dadosHtml(a.dados)}>${esc(a.rotulo)}</button>`;
  const menu = linhaPorId(lista, ctx.ui.menu);
  if (menu) {
    const itens = acoesDaRotina(ctx, menu).map((a) => item(a).replace('class="ag-folha-item"', 'role="menuitem" class="ag-folha-item"')).join("");
    return `${veu}<div class="ag-folha ag-menu" role="menu" aria-label="${esc(`Ações da rotina ${titulo(menu.dto)}`)}">${itens}</div>`;
  }
  const l = linhaPorId(lista, ctx.ui.aberto);
  if (!l) return "";
  const r = l.dto;
  const escolher = pausarAte(ctx, l);
  const parada = l.minha && r.bloqueio ? `<div class="ag-folha-parada">${botaoDaParada(r.bloqueio, "ag-bt ag-bt-pri")}</div>` : "";
  return `${veu}<div class="ag-folha" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(titulo(r))}">
    <div class="ag-fcab">${mascote(l.bot)}<div><h3>${esc(titulo(r))}</h3><p class="ag-fquando">${esc(`${nomeDoBot(l)} · ${minuscula(r.resumo)}`)}</p></div></div>
    <div class="ag-folha-corpo"><p class="ag-frase">${esc(r.rotina.instrucao)}</p>${dados(ctx, r)}${ultimasVezes(ctx, l)}</div>
    ${parada}${acoesDaRotina(ctx, l).map(item).join("")}${escolher ? `<div class="ag-folha-pausar">${escolher}</div>` : ""}
  </div>`;
}

/* ---------- Carregando, erro, vazio ---------- */

function renderCarregando(celular: boolean): string {
  const linha = '<div class="ag-esq-linha" aria-hidden="true"><span class="ag-esq redondo"></span><span class="ag-esq" style="width:46%"></span><span class="ag-esq" style="width:40px;margin-left:auto"></span></div>';
  return `<div class="ag-carregando${celular ? " ag-cel-pad" : ""}" role="status" aria-label="Carregando as rotinas">${linha.repeat(5)}</div>`;
}

function renderErro(celular: boolean): string {
  return `<div class="ag-erro${celular ? " ag-cel-pad" : ""}" role="alert"><p><b>Não deu para carregar as rotinas.</b> Elas continuam rodando.</p>${link("agenda-tentar", "Tentar de novo")}</div>`;
}

function renderVazio(celular: boolean): string {
  return `<div class="ag-vazio${celular ? " ag-cel-pad" : ""}"><p class="ag-vazio-tit">Nenhuma rotina ainda</p><p>Peça na conversa de um bot, do seu jeito: «todo dia útil às 8, me mande os PRs abertos». Ele propõe e você confirma.</p>${pilula("navegar", "Nova rotina", { tela: "nova-rotina" })}</div>`;
}

/** O valor curto de Rotinas na lista do celular: as falhas de ontem e de hoje ("1 falha"), ou nada. */
export function valorDaAgenda(estado: Estado): string {
  const dto = estado.agenda.dto;
  if (!dto) {
    // QA do PR #595 (B6): sem a lista lida (ela só lê ao abrir), as paradas de GET rotinas já dizem algo.
    const paradas = estado.rotinas.filter((r) => r.bloqueio !== null && r.rotina.ownerId === estado.sessao?.pessoaId).length;
    return paradas === 0 ? "" : paradas === 1 ? "1 parada" : `${paradas} paradas`;
  }
  const hoje = diaDe(estado.agora);
  const ontem = somarDias(hoje, -1);
  const n = dto.itens.filter((i) => (i.dia === hoje || i.dia === ontem) && itemComProblema(i)).length;
  return n === 0 ? "" : n === 1 ? "1 falha" : `${n} falhas`;
}

/**
 * QA r235: o destino do foco quando a rotina `id` sai da lista pelo Excluir da tela — a linha da rotina seguinte, senão a
 * da anterior, senão o "Nova rotina" (no vazio, o da caixa "Nenhuma rotina ainda"). Um seletor para `focoPendente`.
 */
export function destinoAoExcluirRotina(raiz: { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null }> }, id: string): string {
  const ids = Array.from(raiz.querySelectorAll('#espaco [data-act="agenda-linha"][data-id]'), (el) => el.getAttribute("data-id") ?? "").filter((x, i, todos) => x && todos.indexOf(x) === i);
  const i = ids.indexOf(id);
  const vizinho = i < 0 ? undefined : ids[i + 1] ?? ids[i - 1];
  // Um seletor só: `querySelector` com vírgula pega o primeiro na ordem do documento (o "Nova rotina" do cabeçalho).
  return vizinho ? `#espaco [data-act="agenda-linha"][data-id="${cssId(vizinho)}"]` : '#espaco [data-act="navegar"][data-tela="nova-rotina"]';
}

/** O id (uuid) dentro de aspas num seletor de atributo; fora de navegador não há `CSS.escape`. */
function cssId(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { EstadoTarefa } from "../../src/contracts/tarefa.ts";
import type { EstadoTrabalho, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { ConversaEstado, Estado } from "../estado/reducer.ts";
import { seletoresDoFoco } from "../lib/foco-do-bloco.ts";
import { esc, hora } from "../lib/render.ts";
import { aberto, emEspera, passoDaFrente, tempoDe, tituloCurto, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { ROTULO_DO_OBJETIVO } from "./tarefa-detalhada.ts";
import { ANEL_FILA, ANEL_RODANDO, DISCO_FALHOU, DISCO_FEITA, PONTO_PRECISA, QUADRADO_PARADA } from "./icones-da-tarefa.ts";

/**
 * O progresso mora na fala que abriu as frentes (definido em 2026-10-18, chat limpo, PR 7; plano, Parte 4 · 4b; protótipo
 * "4 · Progresso na fala + pílula que se alarga", com a fala à vista). As linhas "Começou N frentes" e "N frentes
 * terminaram" saíram do chat no PR 2 (são `anexo`); o que o bot está fazendo nelas volta para dentro da fala dele:
 *
 * - **onde**: embaixo do texto da fala do bot do mesmo turno que gravou `frentes_abertas` (a última do turno à vista, a
 *   mesma que `linhaDepoisDaFala` acha); a frente da rede entra embaixo da linha dela, "Seguiu numa tarefa para o chat
 *   ficar livre" (ADR-187, linhas-do-chat.ts). Sem a abertura na janela, ou sem a fala à vista (a rotina que
 *   abriu frentes, o pedido de um colega), não há bloco — a pílula do PR 8 cobre esse caso;
 * - **o quê** (ADR-187 §5, lote B passo 6, 2026-11-18; Paper 1c, 1d e P1): o cartão vivo. Com várias tarefas, o topo
 *   ("2 tarefas · 1 pronta" e o tempo à direita), a barra com um segmento por tarefa e uma linha por tarefa (o ícone do
 *   estado, o título, o estado em poucas palavras e "Ver"; a que precisa de você, a pergunta em azul e "Responder"). Acima
 *   de cinco, as linhas viram chips ("✓ #812", "#831 na fila") e "Ver detalhes ›", e a que precisa de você ganha a linha
 *   realçada. Com uma tarefa só, o cartão é a própria linha (o título, o passo e o tempo embaixo, e "Ver");
 * - **de onde**: o estado de cada frente sai de `trabalhosConhecidos`; a que já saiu da lista (terminou noutro dia, ou a
 *   lista não chegou), de `frentes_terminadas` (anexo, na janela). Sem nenhum dos dois, "sem notícia" — nunca "pronta".
 *
 * Desempenho (ADR-061): o histórico é lembrado pelo que lê (web/lib/lembrar.ts) e não pode ler o ao vivo nem o relógio,
 * senão seria refeito a cada pedaço de texto. Por isso ele só deixa um lugar vazio (`marcadorDoProgresso`) dentro da fala.
 * Na tela, o bloco é desenhado dentro desse lugar e só ele é trocado quando uma frente anda (`criarProgressoNaTela`, de
 * main.ts): a fala não é regravada, a seleção de texto nela e o ⋯ aberto ficam, e o caminho "histórico mudou" de
 * `regravarTimeline` não roda (QA do PR 398, 2026-10-18: antes a fala inteira era regravada a cada passo de qualquer frente
 * do lote — medido com `scripts/carga-tela medir … frentes`). `comProgressoNaFala` faz o mesmo numa string, para
 * `renderHistoricoDaTimeline`. Sem abertura na janela, nada é percorrido.
 */

/** Os estados de uma frente no bloco, na ordem em que a barra e a lista os mostram. */
export const ESTADOS_NA_FALA = ["pronta", "rodando", "precisa", "esperando", "parada", "falhou", "sem_noticia"] as const;
export type EstadoNaFala = (typeof ESTADOS_NA_FALA)[number];

export type FrenteNaFala = {
  trabalhoId: string;
  titulo: string;
  estado: EstadoNaFala;
  /** O último passo (rodando, esperando ou precisando de você). */
  passo: string | null;
  /** Há quanto tempo roda ("12 min"), para as abertas que já começaram. */
  tempo: string | null;
  /** Quando terminou (pronta, parada ou falhou), se se sabe. */
  terminouEm: number | null;
  /** Desde quando anda (as que já começaram): o tempo do topo do cartão é o da mais antiga. */
  inicio?: number | null;
  /** Esperando sem ter começado ("#831 na fila", Paper P1). */
  naFila?: boolean;
  /** ADR-192 (emenda 5): o estado do objetivo, quando há Tarefa ligada — o fim diz "Entregue" ou "Resolvida", não "pronta". */
  objetivo?: EstadoTarefa;
};

/**
 * A abertura de frentes: `frentes_abertas`, ou `trabalho_aberto` da rede (a conversa que virou frente sozinha) e, desde a
 * emenda 5 do ADR-192, o da pessoa (o "+ Nova tarefa"): os dois trazem a própria linha com o lugar do cartão (`rede`).
 */
type Abertura = { id: string; turnoId: string | null; rede: boolean; frentes: readonly { trabalhoId: string; titulo: string }[] };

function aberturaDe(m: Mensagem): Abertura | null {
  const p = m.payload;
  if (p?.kind === "frentes_abertas" && p.frentes.length > 0) return { id: m.id, turnoId: m.turnoId, rede: p.origem === "rede", frentes: p.frentes };
  if (p?.kind === "trabalho_aberto" && (p.origem === "rede" || (p.origem === "pessoa" && m.trabalhoId === p.trabalhoId))) return { id: m.id, turnoId: m.turnoId, rede: true, frentes: [{ trabalhoId: p.trabalhoId, titulo: p.titulo }] };
  return null;
}

/**
 * Onde cada bloco entra: id da mensagem-âncora → ids das aberturas (um turno pode abrir mais de um lote). `visivel` diz se a
 * mensagem aparece como fala ou balão na tela (quem chama sabe pelos planos da timeline).
 */
export function ancorasDoProgresso(mensagens: readonly Mensagem[], visivel: (m: Mensagem) => boolean): Map<string, string[]> {
  const ancoras = new Map<string, string[]>();
  mensagens.forEach((m, i) => {
    const a = aberturaDe(m);
    if (!a) return;
    let alvo: Mensagem | undefined;
    // A rede nunca procura no turno: as falas dele são da frente, e a resposta final (ou a pergunta) dela entra no chat
    // como balão "da task …" do mesmo turno — o bloco pularia do balão da pessoa para ela (revisão do PR 398).
    if (a.turnoId && !a.rede) {
      for (let j = i + 1; j < mensagens.length; j++) {
        const x = mensagens[j];
        if (x && x.turnoId === a.turnoId && x.kind === "texto" && x.autoria.autor_tipo === "agente" && visivel(x)) alvo = x;
      }
    }
    // A frente da rede não procura âncora: a linha dela ("Seguiu numa tarefa…", linhas-do-chat.ts) já traz o lugar do
    // bloco, do lado do bot (ADR-187, 2026-11-17). Antes o bloco ia no balão da pessoa que pediu.
    if (alvo) ancoras.set(alvo.id, [...(ancoras.get(alvo.id) ?? []), a.id]);
  });
  return ancoras;
}

/**
 * O lugar que o histórico deixa na fala; o bloco é desenhado dentro dele, fora da lembrança. `display: contents`
 * (interface.css): vazio, não aparece; cheio, a seção fica no balão como se o lugar não existisse.
 */
export function marcadorDoProgresso(aberturaId: string): string {
  return `<div class="progresso-lugar" data-progresso="${esc(aberturaId)}"></div>`;
}

const ESTADO_DO_FIM: Partial<Record<EstadoTrabalho, EstadoNaFala>> = { terminado: "pronta", parado: "parada", falhou: "falhou" };

function estadoDoTrabalho(t: TrabalhoDto): EstadoNaFala {
  const fim = ESTADO_DO_FIM[t.estado];
  if (fim) return fim;
  if (t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso") return "precisa";
  if (t.estado === "na_fila" || emEspera(t)) return "esperando";
  return "rodando";
}

/**
 * Cada frente da abertura com o estado de agora. A lista (`trabalhosConhecidos`) é a mais nova, salvo quando ela ainda diz
 * "aberta" de uma frente que `frentes_terminadas` já deu por terminada (a lista de `GET trabalhos` chega antes da releitura)
 * — e a frente não foi reaberta (a lista da conversa, lida com as mensagens, ainda a tem aberta).
 */
export function frentesNaFala(abertura: Pick<Abertura, "frentes">, mensagens: readonly Mensagem[], estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, conversaId: string): FrenteNaFala[] {
  const ids = new Set(abertura.frentes.map((f) => f.trabalhoId));
  const terminadas = new Map<string, { estado: EstadoTrabalho; titulo: string; em: number }>();
  for (const m of mensagens) {
    if (m.payload?.kind !== "frentes_terminadas") continue;
    for (const f of m.payload.frentes) if (ids.has(f.trabalhoId)) terminadas.set(f.trabalhoId, { estado: f.estado, titulo: f.titulo, em: m.criadoEm });
  }
  const todos = trabalhosConhecidos(estado, conversaId);
  // A frente reaberta (a pessoa escreveu na tela da task, uma decisão, um turno novo: `sincronizarTrabalho` com `reabrir`)
  // roda de novo, e o lote já fechado não grava outro `frentes_terminadas`. A lista que veio JUNTO das mensagens (a da
  // conversa, lida na mesma resposta) dizendo "aberta" ao lado do fim é a reabertura, não a lista atrasada: vale ela
  // (revisão do PR 398; antes a frente reaberta ficava "pronta" com ✓ para sempre).
  const abertasNaConversa = new Set((estado.conversas[conversaId]?.trabalhos ?? []).filter(aberto).map((t) => t.id));
  const frentes = abertura.frentes.map((f): FrenteNaFala => {
    const t = todos.find((x) => x.id === f.trabalhoId);
    const fim = terminadas.get(f.trabalhoId);
    if (t && !(fim && aberto(t) && !abertasNaConversa.has(t.id))) {
      const e = estadoDoTrabalho(t);
      const vivo = e === "rodando" || e === "precisa" || e === "esperando";
      // Paper 15: a pronta mostra o último passo dela ("Corrigiu 2 testes · CI verde") embaixo do título.
      const anda = vivo && t.estado !== "na_fila";
      return { trabalhoId: t.id, titulo: t.titulo, estado: e, passo: vivo ? passoDaFrente(estado, t, todos) : e === "pronta" ? (t.ultimoPasso ?? null) : null, tempo: anda ? tempoDe(t, estado.agora) : null, terminouEm: vivo ? null : t.terminadoEm, ...(anda ? { inicio: t.iniciadoEm ?? t.criadoEm } : {}), ...(t.estado === "na_fila" ? { naFila: true } : {}), ...(t.tarefa ? { objetivo: t.tarefa.estado } : {}) };
    }
    if (fim) return { trabalhoId: f.trabalhoId, titulo: fim.titulo || f.titulo, estado: ESTADO_DO_FIM[fim.estado] ?? "sem_noticia", passo: null, tempo: null, terminouEm: fim.em };
    return { trabalhoId: f.trabalhoId, titulo: f.titulo, estado: "sem_noticia", passo: null, tempo: null, terminouEm: null };
  });
  // A barra enche da esquerda: prontas (pela hora), as que andam, e por fim as que pararam, falharam ou não se sabe.
  const ordem = (e: EstadoNaFala): number => ESTADOS_NA_FALA.indexOf(e);
  return frentes.map((f, i) => ({ f, i })).sort((a, b) => ordem(a.f.estado) - ordem(b.f.estado) || (a.f.terminouEm ?? 0) - (b.f.terminouEm ?? 0) || a.i - b.i).map((x) => x.f);
}

/**
 * Paper 15 (ADR-167): o nome curto da tarefa, o pedaço antes do primeiro " · " ("PR #491 · Passagem por coluna" → "PR #491").
 * O cartão vivo o usa nos chips e na linha realçada de quem precisa de você (Paper P1: "#812", "PR #821 · Posso…?").
 */
export function nomeNoResumo(titulo: string): string {
  const curto = tituloCurto(titulo);
  const i = curto.indexOf(" · ");
  return i > 0 ? curto.slice(0, i) : curto;
}

const contagem = (n: number, um: string, varios: string): string => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

/**
 * O topo do cartão (Paper 1c: "2 tarefas · 1 pronta"; Paper 4d: "· 1 precisa de você"): quantas são, quantas ficaram prontas
 * e o que pede atenção. Sem nenhuma pronta, só a conta ("2 tarefas"): o "0 prontas" lia como problema. `comPrecisa` sai
 * quando a pergunta já tem a linha realçada embaixo (Paper P1: "12 tarefas · 3 prontas").
 */
export function resumoDoProgresso(frentes: readonly FrenteNaFala[], comPrecisa = true): string {
  const de = (e: EstadoNaFala): number => frentes.filter((f) => f.estado === e).length;
  const partes = [frentes.length === 1 ? "1 tarefa" : `${frentes.length} tarefas`];
  if (de("pronta")) partes.push(contagem(de("pronta"), "pronta", "prontas"));
  if (comPrecisa && de("precisa")) partes.push(contagem(de("precisa"), "precisa de você", "precisam de você"));
  if (de("parada")) partes.push(contagem(de("parada"), "parada", "paradas"));
  if (de("falhou")) partes.push(contagem(de("falhou"), "não terminou", "não terminaram"));
  // A tarefa sem notícia (terminou noutro dia, antes do fecho do lote) é dita: sem ela a conta não fecha (revisão do PR 398).
  if (de("sem_noticia")) partes.push(`${de("sem_noticia")} sem notícia`);
  return partes.join(" · ");
}

/**
 * A ordem da barra e das linhas (Paper P1: as prontas em preto, a que precisa de você em azul, as que rodam e por fim as da
 * fila): o que terminou à esquerda, o que ainda anda à direita. As linhas seguem a mesma ordem (Paper 1c e 4d).
 */
const ORDEM_NO_CARTAO: readonly EstadoNaFala[] = ["pronta", "falhou", "parada", "sem_noticia", "precisa", "rodando", "esperando"];

/** definido em 2026-11-18 (ADR-187 §5, Paper P1): acima de cinco tarefas, as linhas viram chips. */
export const CHIPS_ACIMA = 5;

const ROTULO: Record<EstadoNaFala, string> = { pronta: "pronta", rodando: "rodando", precisa: "precisa de você", esperando: "esperando", parada: "parada", falhou: "não terminou", sem_noticia: "sem notícia" };
/** O ✓ solto (menus, abas de tarefa, tela Tarefas); o cartão vivo usa o ✓ no disco (`DISCO_FEITA`). */
export const IC_OK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const ICONE: Record<EstadoNaFala, string> = { pronta: DISCO_FEITA, rodando: ANEL_RODANDO, precisa: PONTO_PRECISA, esperando: ANEL_FILA, parada: QUADRADO_PARADA, falhou: DISCO_FALHOU, sem_noticia: ANEL_FILA };

function icone(e: EstadoNaFala): string {
  return `<span class="tv-ic" aria-hidden="true">${ICONE[e]}</span>`;
}

/**
 * Onde a linha aparece: `cartao` (uma de várias no cartão vivo, Paper 1c), `uma` (o cartão de uma tarefa só, Paper 1d: o
 * passo leva o tempo) e `lista` (a lista aberta da aba, Paper 4d/OR4: o estado curto à direita, sem "Ver").
 */
export type ModoDaLinha = "cartao" | "uma" | "lista";

/** O estado em poucas palavras: o último passo quando há; senão o rótulo, com a hora para a que terminou. */
function textoDoEstado(f: FrenteNaFala, modo: ModoDaLinha): string {
  if (modo === "lista" && (f.estado === "pronta" || f.estado === "precisa")) return ROTULO[f.estado];
  const fim = f.terminouEm && (f.estado === "pronta" || f.estado === "parada" || f.estado === "falhou") ? ` às ${hora(f.terminouEm)}` : "";
  // ADR-192 (emenda 5): com Tarefa, o fim é do objetivo — "Entregue às 16:13" (espera a avaliação) ou "Resolvida".
  const doObjetivo = f.objetivo && f.objetivo !== "em_andamento" && f.objetivo !== "nao_iniciada" && f.estado === "pronta" ? ROTULO_DO_OBJETIVO[f.objetivo] : null;
  if (doObjetivo) return f.objetivo === "entregue" ? `${doObjetivo}${fim}` : doObjetivo;
  const base = f.passo ?? (f.naFila ? "na fila" : `${ROTULO[f.estado]}${fim}`);
  return modo === "uma" && f.tempo ? `${base} · ${f.tempo}` : base;
}

/**
 * Uma linha de tarefa (ADR-187 §5, lote B passo 6): o ícone do estado, o título, o estado em poucas palavras e, no cartão,
 * "Ver" (ou "Responder", na que precisa de você). A linha inteira é um botão que abre a tarefa em tela cheia, na aba dela
 * (Paper 4d: '"Ver" (ou a linha inteira)'). O mesmo desenho no cartão vivo e na lista aberta da aba.
 */
export function linhaDaTarefa(f: FrenteNaFala, modo: ModoDaLinha): string {
  const curto = tituloCurto(f.titulo);
  const estado = textoDoEstado(f, modo);
  const sr = estado === ROTULO[f.estado] ? "" : `<span class="sr-only"> (${ROTULO[f.estado]})</span>`;
  const ver = modo === "lista" ? "" : `<span class="tv-ver">${f.estado === "precisa" ? "Responder" : "Ver"}</span>`;
  return `<li class="tv-item"><button type="button" class="tv-linha" data-act="abrir-trabalho" data-id="${esc(f.trabalhoId)}" data-estado="${f.estado}"${curto === f.titulo ? "" : ` title="${esc(f.titulo)}"`}>${icone(f.estado)}<span class="tv-texto"><span class="tv-titulo">${esc(curto)}</span>${sr}<span class="tv-estado">${esc(estado)}</span></span>${ver}</button></li>`;
}

/** Paper P1: a que precisa de você, acima dos chips, realçada em azul ("PR #821 · Posso rodar a migração…?" e "Responder"). */
function linhaQuePede(f: FrenteNaFala): string {
  const texto = f.passo ? `${nomeNoResumo(f.titulo)} · ${f.passo}` : nomeNoResumo(f.titulo);
  return `<li class="tv-item"><button type="button" class="tv-linha tv-pede" data-act="abrir-trabalho" data-id="${esc(f.trabalhoId)}" data-estado="precisa" title="${esc(f.titulo)}">${icone("precisa")}<span class="tv-texto"><span class="tv-titulo">${esc(texto)}</span><span class="sr-only"> (precisa de você)</span></span><span class="tv-ver">Responder</span></button></li>`;
}

/** Paper P1: o chip ("✓ #812", "◌ #815", "#831 na fila"); o título inteiro e o estado no nome acessível. */
function chip(f: FrenteNaFala): string {
  const nome = `${nomeNoResumo(f.titulo)}${f.naFila ? " na fila" : ""}`;
  return `<li class="tv-item"><button type="button" class="tv-chip" data-act="abrir-trabalho" data-id="${esc(f.trabalhoId)}" data-estado="${f.estado}" title="${esc(f.titulo)}" aria-label="${esc(`${tituloCurto(f.titulo)}: ${ROTULO[f.estado]}`)}">${icone(f.estado)}${esc(nome)}</button></li>`;
}

/** O tempo à direita do topo: o da tarefa que anda há mais tempo; sem nenhuma andando, a hora em que a última terminou. */
function tempoDoCartao(frentes: readonly FrenteNaFala[]): string {
  const vivas = frentes.filter((f) => f.estado === "rodando" || f.estado === "precisa" || f.estado === "esperando");
  if (vivas.length) {
    const [antiga] = vivas.filter((f) => f.tempo && f.inicio != null).sort((a, b) => (a.inicio ?? 0) - (b.inicio ?? 0));
    return antiga?.tempo ?? "";
  }
  const fim = Math.max(0, ...frentes.map((f) => f.terminouEm ?? 0));
  return fim ? hora(fim) : "";
}

/**
 * O bloco de uma abertura: o cartão vivo. `chave` é o id da abertura e `agenteId` o bot da conversa (ficam para quem desenha:
 * a pílula conta a abertura do detalhe no tipo `frentes` da telemetria, ADR-099). `memoria` é o ponto do Mac (PR 8).
 */
export function htmlProgresso(frentes: readonly FrenteNaFala[], p: { chave: string; agenteId: string; memoria?: MemoriaNoProgresso | null }): string {
  const [unica] = frentes;
  if (!unica) return "";
  // PR 8: `data-frentes` diz à rolagem de quais frentes este bloco fala (Ver na conversa da pílula).
  const ids = esc(frentes.map((f) => f.trabalhoId).join(" "));
  const memoria = p.memoria ? `<span class="progresso-memoria ${p.memoria.nivel}" role="img" aria-label="${esc(p.memoria.texto)}" title="${esc(p.memoria.texto)}"></span>` : "";
  // Paper 1d: uma tarefa só é uma linha num cartão, sem topo nem barra.
  if (frentes.length === 1) return `<section class="progresso progresso-uma" data-frentes="${ids}" aria-label="${esc(`Tarefa ${tituloCurto(unica.titulo)}: ${ROTULO[unica.estado]}`)}"><ul class="tv-linhas">${linhaDaTarefa(unica, "uma")}</ul>${memoria}</section>`;
  const ordenadas = [...frentes].sort((a, b) => ORDEM_NO_CARTAO.indexOf(a.estado) - ORDEM_NO_CARTAO.indexOf(b.estado));
  const chips = frentes.length > CHIPS_ACIMA;
  const resumo = resumoDoProgresso(frentes, !chips);
  const tempo = tempoDoCartao(frentes);
  const topo = `<div class="tv-topo"><b class="tv-resumo">${esc(resumo)}</b>${memoria}${tempo ? `<span class="tv-tempo">${esc(tempo)}</span>` : ""}</div>`;
  const barra = `<div class="tv-barra" aria-hidden="true">${ordenadas.map((f) => `<span class="tv-seg" data-estado="${f.estado}"></span>`).join("")}</div>`;
  let corpo: string;
  if (chips) {
    const pedem = ordenadas.filter((f) => f.estado === "precisa");
    // "Ver detalhes ›" abre a lista aberta da aba (a mesma ação da aba: `pilula`, que conta a abertura na telemetria).
    const mais = `<li class="tv-item"><button type="button" class="tv-mais" data-act="pilula">Ver detalhes<span aria-hidden="true">›</span></button></li>`;
    corpo = `${pedem.length ? `<ul class="tv-pedem">${pedem.map(linhaQuePede).join("")}</ul>` : ""}<ul class="tv-chips">${ordenadas.filter((f) => f.estado !== "precisa").map(chip).join("")}${mais}</ul>`;
  } else corpo = `<ul class="tv-linhas">${ordenadas.map((f) => linhaDaTarefa(f, "cartao")).join("")}</ul>`;
  return `<section class="progresso" data-frentes="${ids}" aria-label="${esc(`Tarefas: ${resumo}`)}">${topo}${barra}${corpo}</section>`;
}

/** As aberturas da janela por id, uma vez por lista de mensagens (a tela pede a cada quadro). */
const aberturasPorJanela = new WeakMap<readonly Mensagem[], Map<string, Abertura>>();

function aberturasDe(mensagens: readonly Mensagem[]): Map<string, Abertura> {
  let porId = aberturasPorJanela.get(mensagens);
  if (!porId) {
    porId = new Map();
    for (const m of mensagens) {
      const a = aberturaDe(m);
      if (a) porId.set(a.id, a);
    }
    aberturasPorJanela.set(mensagens, porId);
  }
  return porId;
}

/**
 * O ponto da memória do Mac no bloco (PR 8; ADR-114, decisão tomada 5): ao lado do número, com a frase no `title` e no nome
 * acessível; o texto só na pílula alargada e na Atividade. Amarela e vermelha são ponto, nunca faixa nem texto âmbar.
 */
export type MemoriaNoProgresso = { texto: string; nivel: "amarela" | "vermelha" };

/** O bloco da abertura `aberturaId` com o estado de agora; "" se ela não está na janela. */
export function blocoDaAbertura(aberturaId: string, c: ConversaEstado, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, memoria: MemoriaNoProgresso | null = null): string {
  const a = aberturasDe(c.mensagens).get(aberturaId);
  if (!a) return "";
  const frentes = frentesNaFala(a, c.mensagens, estado, c.conversa.id);
  // O ponto da memória só no bloco que ainda anda: o lote que terminou não tem o que o Mac apertado segure.
  const anda = frentes.some((f) => f.estado === "rodando" || f.estado === "precisa" || f.estado === "esperando");
  return htmlProgresso(frentes, { chave: a.id, agenteId: c.conversa.agenteId ?? "", memoria: anda ? memoria : null });
}

/**
 * Enche os lugares das falas com o bloco, numa string (`renderHistoricoDaTimeline`). Sem abertura na janela devolve os mesmos
 * blocos (a mesma referência); só o bloco da fala com lugar muda de objeto. `memoria` é o ponto do Mac (PR 8).
 */
export function comProgressoNaFala<B extends { chave: string; html: string }>(blocos: B[], c: ConversaEstado, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, memoria: MemoriaNoProgresso | null = null): B[] {
  const aberturas = aberturasDe(c.mensagens);
  if (aberturas.size === 0) return blocos;
  let mudou = false;
  const saida = blocos.map((b) => {
    if (!b.html.includes("data-progresso=")) return b;
    let html = b.html;
    for (const id of aberturas.keys()) {
      const lugar = marcadorDoProgresso(id);
      if (!html.includes(lugar)) continue;
      // A troca por função: com uma string, "$&", "$'" e "$`" de um título (escapado pelo HTML, não pelo replace) colariam
      // pedaços da fala no lugar do bloco (revisão do PR 398).
      const cheio = `${lugar.slice(0, -"</div>".length)}${blocoDaAbertura(id, c, estado, memoria)}</div>`;
      html = html.replace(lugar, () => cheio);
    }
    if (html === b.html) return b;
    mudou = true;
    return { ...b, html };
  });
  return mudou ? saida : blocos;
}

/** O que `criarProgressoNaTela` usa de um elemento (o teste passa um falso, sem navegador). */
export type LugarNaTela = {
  dataset: { progresso?: string };
  innerHTML: string;
  isConnected: boolean;
  contains(outro: unknown): boolean;
  querySelector(seletor: string): { focus?: (o?: { preventScroll?: boolean }) => void } | null;
};

/**
 * O progresso na tela (QA do PR 398): os lugares são procurados só quando o histórico é regravado (`achar`, nunca a cada
 * quadro — ADR-061) e, a cada desenho, só o lugar cujo bloco mudou é trocado (`desenhar`), guardando o foco (a linha ou o
 * chip de uma tarefa, como `regiaoPorBlocos` faz com o bloco refeito). Devolve quantos trocou. Desde 2026-11-18 (lote B,
 * passo 6) o cartão não abre nem fecha: não há lista aberta a guardar.
 */
export function criarProgressoNaTela(ativo: () => unknown = () => (globalThis as { document?: { activeElement: unknown } }).document?.activeElement ?? null): {
  achar(raiz: { querySelectorAll(seletor: string): Iterable<LugarNaTela> } | null): void;
  desenhar(c: ConversaEstado | null, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, memoria?: MemoriaNoProgresso | null): number;
} {
  let lugares: LugarNaTela[] = [];
  const desenhado = new WeakMap<LugarNaTela, string>();
  return {
    achar(raiz) {
      lugares = raiz ? [...raiz.querySelectorAll("[data-progresso]")] : [];
    },
    desenhar(c, estado, memoria = null) {
      if (!c || lugares.length === 0) return 0;
      let trocados = 0;
      for (const lugar of lugares) {
        if (!lugar.isConnected) continue;
        const html = blocoDaAbertura(lugar.dataset.progresso ?? "", c, estado, memoria);
        if (desenhado.get(lugar) === html) continue;
        const foco = ativo() as { dataset?: { act?: string; id?: string } } | null;
        const focado = foco && lugar.contains(foco) ? foco : null;
        lugar.innerHTML = html;
        desenhado.set(lugar, html);
        trocados++;
        if (focado) {
          for (const seletor of seletoresDoFoco(focado.dataset ?? {})) {
            const alvo = lugar.querySelector(seletor);
            if (alvo?.focus) {
              alvo.focus({ preventScroll: true });
              break;
            }
          }
        }
      }
      return trocados;
    },
  };
}

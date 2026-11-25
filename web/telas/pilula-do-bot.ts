import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { DonoDto } from "../../src/contracts/dono.ts";
import type { Estado } from "../estado/reducer.ts";
import { donoDoBot, esperaNaTela, linhaDoDono, quemPediu, textoDaFila, textoDasEsperas, type EsperaNaTela } from "../lib/dono.ts";
import { acaoLocal, comAcaoLocal, htmlDasAcoes } from "../lib/esperas-de-colega.ts";
import { pilulaEscondida, type ProgressoNaTela } from "../lib/pilula.ts";
import { esc, hora } from "../lib/render.ts";
import { aberto, emEspera, esperandoMaquina, maquinasDe, tituloCurto, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { avisoDaMaquina } from "../lib/aviso-da-maquina.ts";
import { memoriaDoMac } from "./linha-do-dono.ts";
import { conversaLimpa } from "./linhas-do-chat.ts";
import { ANEL_RODANDO, PONTO_PRECISA } from "./icones-da-tarefa.ts";
import { frentesNaFala, linhaDaTarefa, type FrenteNaFala, type MemoriaNoProgresso } from "./progresso-na-fala.ts";
import { agente, renderFaixaTrabalhos } from "./trabalhos.ts";

/**
 * A pílula do bot acima do campo (definido em 2026-10-18, chat limpo, PR 8; plano, Parte 4 · 4c; protótipo
 * D4BE2-pilula-alarga, escolha do Marlon "4B+4E"): no lugar da linha do dono (ADR-099 item 10, emendado). Fechada, uma
 * pílula clean, "● 5 frentes de hero  3 de 5 prontas"; o clique a alarga no lugar com as frentes (rodando primeiro, com o
 * último passo e o tempo; depois as prontas com a hora), as esperas e a fila, e no pé "Ver na conversa ↑" e "Parar".
 *
 * - **Some quando a fala com o progresso está à vista** (`pilulaEscondida`) e volta quando ela sai; espera e fila não têm
 *   fala-âncora e a seguram à vista;
 * - **o texto fechado prioriza as frentes**: um lote, o título dele ("5 frentes de hero", o `tituloDoLote` do PR 5 quando o
 *   servidor o manda, senão "N frentes"); vários, "2 lotes"; sem frentes, a espera ("◌ Esperando a CI do #845 · 38 min") ou
 *   a fila ("1 pedido na fila"). "Esperando você" saiu: a pergunta tem o cartão e a pílula "Nina perguntou algo" (#389);
 * - **a memória do Mac** é um ponto ao lado da pílula, com a frase no `title` e no nome acessível, e a frase inteira só
 *   dentro da alargada (decisão tomada 5: nada de faixa nem texto âmbar).
 *
 * Aqui só os dados e o HTML (testáveis sem navegador); o desenho com o painel animado mora em web/lib/pilula-na-tela.ts.
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/** Um grupo da pílula: um lote de frentes (ou a frente/task solta), com as frentes no estado de agora. */
export type GrupoDaPilula = { chave: string; titulo: string; ids: string[]; frentes: FrenteNaFala[]; prontas: number; total: number };

export type Pilula = {
  agenteId: string;
  nome: string;
  /** O ponto da pílula: vivo (alguma frente roda), vazado (só espera) ou o da fila. */
  sinal: "vivo" | "espera" | "fila";
  texto: string;
  resto: string[];
  grupos: GrupoDaPilula[];
  esperas: EsperaNaTela[];
  fila: { quem: string; desde: number }[];
  /** ADR-187 (4t): o aviso da máquina das tarefas; `curto` é o texto do selo ao lado da aba. */
  memoria: (MemoriaNoProgresso & { alvo: string; curto?: string }) | null;
  /** NOD-377: o resto fechado diz "sem resposta há 26h" (em cinza). */
  vencida?: boolean;
  /** As frentes abertas que o "Parar" da pílula para. */
  abertas: TrabalhoDto[];
  /** Paper 15 (rodada 2): as esperas de frentes que não estão em nenhum lote (as do lote aparecem no bloco da fala). */
  esperasForaDoLote?: number;
  /** Paper 15c: a cor do bot (`c-orange`), para o ponto do cabeçalho aberto. */
  cor?: string;
  /** Paper 15c: as frentes do lote que estão em Esperando (saem da lista do lote para não aparecerem duas vezes). */
  emEspera?: string[];
};

/** O título do lote: o do servidor (PR 5, `tituloDoLote`; null sem lote), o da frente quando é uma só, ou "N frentes". */
function tituloDoGrupo(ts: readonly Pick<TrabalhoDto, "titulo" | "tituloDoLote">[]): string {
  const doServidor = ts.map((t) => t.tituloDoLote?.trim()).find(Boolean);
  // O modelo dá o assunto ("frentes de hero", 2 a 5 palavras, PR 5); a pílula põe a conta na frente, como no protótipo
  // D4BE2 ("5 frentes de hero"). Título que já começa com um número fica como veio.
  if (doServidor) return /^\d/.test(doServidor) ? doServidor : /^(frentes|tarefas)\b/i.test(doServidor) ? `${ts.length} ${doServidor.replace(/^frentes\b/i, "tarefas")}` : `${ts.length} tarefas · ${doServidor}`;
  const [unica] = ts;
  return ts.length === 1 && unica ? tituloCurto(unica.titulo) : `${ts.length} tarefas`;
}

/**
 * Na lista aberta da aba (Paper 4d, 2026-11-18; antes Paper 15c): as que precisam de você em cima, depois as que rodam e as
 * que esperam (cada grupo na ordem em que abriram), as prontas da mais nova para a mais velha, e por fim as que pararam.
 */
function ordemNaPilula(frentes: readonly FrenteNaFala[], ordemAbertura: readonly string[]): FrenteNaFala[] {
  const peso = (f: FrenteNaFala): number => (f.estado === "precisa" ? 0 : f.estado === "rodando" ? 1 : f.estado === "esperando" ? 2 : f.estado === "pronta" ? 3 : 4);
  return [...frentes].sort((a, b) => peso(a) - peso(b) || (peso(a) <= 2 ? ordemAbertura.indexOf(a.trabalhoId) - ordemAbertura.indexOf(b.trabalhoId) : (b.terminouEm ?? 0) - (a.terminouEm ?? 0)));
}

/**
 * Os grupos do bot: as frentes que a tela conhece, por lote (a task solta é um grupo de uma), só os que ainda têm frente
 * aberta. O estado de cada frente é o mesmo do bloco na fala (`frentesNaFala`): a pílula e a fala nunca discordam.
 */
function gruposDoBot(estado: Estado, agenteId: string, conversaId: string | null | undefined): { grupos: GrupoDaPilula[]; abertas: TrabalhoDto[] } {
  const doBot = trabalhosConhecidos(estado, conversaId).filter((t) => t.agenteId === agenteId).sort((a, b) => a.criadoEm - b.criadoEm);
  const porGrupo = new Map<string, TrabalhoDto[]>();
  for (const t of doBot) {
    const chave = t.loteId ? `lote:${t.loteId}` : `t:${t.id}`;
    porGrupo.set(chave, [...(porGrupo.get(chave) ?? []), t]);
  }
  const mensagens = (conversaId ? estado.conversas[conversaId]?.mensagens : undefined) ?? [];
  const grupos: GrupoDaPilula[] = [];
  for (const [chave, ts] of porGrupo) {
    if (!ts.some(aberto)) continue;
    const ids = ts.map((t) => t.id);
    const frentes = ordemNaPilula(frentesNaFala({ frentes: ts.map((t) => ({ trabalhoId: t.id, titulo: t.titulo })) }, mensagens, estado, conversaId ?? ""), ids);
    // O lote sabe quantas frentes teve (`lote.frentes`): a que terminou noutro dia sai da lista, mas conta no "de 5".
    const total = Math.max(ts.length, ...ts.map((t) => t.lote?.frentes ?? 0));
    grupos.push({ chave, titulo: tituloDoGrupo(ts), ids, frentes, prontas: frentes.filter((f) => f.estado === "pronta").length, total });
  }
  return { grupos, abertas: doBot.filter((t) => aberto(t) && grupos.some((g) => g.ids.includes(t.id))) };
}

const ROTULO_UMA: Record<FrenteNaFala["estado"], string> = { pronta: "pronta", rodando: "rodando", precisa: "precisa de você", esperando: "esperando", parada: "parada", falhou: "não terminou", sem_noticia: "sem notícia" };

/** "3 de 5 prontas"; a frente sozinha diz o que está fazendo ("ajustando o contraste"), como o bloco de uma na fala. */
function estadoDoGrupo(g: GrupoDaPilula): string {
  const [f] = g.frentes;
  // Parada à espera da pessoa, o estado ganha do último passo (que esconderia o "precisa de você"; revisão do PR 400).
  if (g.total === 1 && f) return f.estado === "precisa" ? ROTULO_UMA.precisa : f.passo ?? ROTULO_UMA[f.estado];
  return `${g.prontas} de ${g.total} prontas`;
}

/** A frente conta como espera no dono: tem espera dela (comando, volta, colega) ou a máquina do turno vivo está sem contato. */
function esperaNoDono(dono: NonNullable<ReturnType<typeof donoDoBot>>, trabalhoId: string, todos: readonly TrabalhoDto[]): boolean {
  if (dono.esperas.some((x) => x.trabalhoId === trabalhoId)) return true;
  const t = todos.find((x) => x.id === trabalhoId);
  return Boolean(t && t.estado === "rodando" && t.turnoVivoId && esperandoMaquina(t));
}

/**
 * A pílula do bot, ou null quando não há nada a dizer (o bot livre, ou só "Esperando você", que tem o cartão). Exige o dono
 * do servidor (ADR-099, I10): sem ele, quem chama desenha a faixa de antes.
 */
/**
 * Chat (polimento, medido em 13/11 com o Claude): a mensagem que a pessoa acabou de mandar nesta conversa fica ~1 s na
 * fila do dono antes de o bot começar, e a pílula dizia "1 pedido na fila" acima do campo nesse meio — o protótipo C1/C2b
 * não tem nada ali (o balão já está na conversa e o indicador entra quando o bot começa), e a pílula entrando e saindo
 * mexia a altura da conversa duas vezes. Saem da conta os pedidos que são turnos desta conversa; os de colega, de rotina
 * e de outras conversas continuam.
 */
function semPedidosDaConversa(dono: DonoDto, estado: Estado, conversaId: string | null | undefined): DonoDto {
  const daConversa = (p: DonoDto["fila"][number]): boolean => {
    const t = estado.turnosVivos[p.turnoId];
    return !!t && !!conversaId && t.conversaId === conversaId && !t.trabalhoId;
  };
  const fila = dono.fila.filter((p) => !daConversa(p));
  const tirados = dono.fila.length - fila.length;
  return tirados === 0 ? dono : { ...dono, fila, estado: { ...dono.estado, fila: Math.max(0, dono.estado.fila - tirados) } };
}

export function pilulaDoBot(estado: Estado, agenteId: string): Pilula | null {
  const bot: Agente | undefined = agente(estado, agenteId);
  const doDono = donoDoBot(estado, agenteId, bot?.conversaId);
  if (!doDono) return null;
  const doServidor = semPedidosDaConversa(doDono, estado, bot?.conversaId);
  // NOD-377: o Cobrar e o Desistir que o servidor ainda não releu (a desistida some, a cobrada já diz "cobrado agora").
  const dono = { ...doServidor, esperas: doServidor.esperas.map((x) => comAcaoLocal(x)).filter((x): x is NonNullable<typeof x> => x !== null) };
  const nome = bot?.nome ?? "bot";
  const { grupos, abertas } = gruposDoBot(estado, agenteId, bot?.conversaId);
  const todos = trabalhosConhecidos(estado, bot?.conversaId);
  const tituloDe = (id: string | null): string | null => (id ? todos.find((t) => t.id === id)?.titulo ?? null : null);
  const esperas = dono.esperas.map((e) => esperaNaTela(e, estado.agora, tituloDe(e.trabalhoId)));
  const fila = dono.fila.map((p) => ({ quem: quemPediu(p), desde: p.desde }));
  const memoria = memoriaNaPilula(estado, agenteId, bot?.conversaId);
  const e = dono.estado;
  if (grupos.length > 0) {
    const [g] = grupos;
    const um = grupos.length === 1 && g;
    const prontas = grupos.reduce((s, x) => s + x.prontas, 0);
    const total = grupos.reduce((s, x) => s + x.total, 0);
    // ADR-187 §5 (protótipo P1, lote B passo 1): a aba conta as tarefas ("12 tarefas · 1 precisa de você · 3 prontas"); com
    // uma só, o nome curto dela e o que ela faz. Antes o texto era o título do lote ("5 frentes de hero") ou "2 lotes".
    const texto = total === 1 ? "1 tarefa" : `${total} tarefas`;
    // A frente parada à espera da pessoa (a pergunta dela mora na tela da frente, sem cartão nesta conversa) entra em
    // contagem, como no bloco da fala ("1 precisa de você"): a linha do dono a dizia com "Esperando você", e com a fala à
    // vista a pílula some (revisão do PR 400). A frente sozinha já diz o estado dela.
    const precisam = um && g.total === 1 ? 0 : grupos.reduce((s, x) => s + x.frentes.filter((f) => f.estado === "precisa").length, 0);
    // Achado do QA no #427: a frente sozinha que espera (a máquina sem contato, um comando, um colega) já diz a espera no
    // estado dela ("esperando VM-1 · sem contato"); a contagem do dono fica só com as outras, sem repetir o motivo.
    const sozinha = um && g.total === 1 ? g.frentes[0] : undefined;
    const jaDita = sozinha?.estado === "esperando" && esperaNoDono(dono, sozinha.trabalhoId, todos) ? 1 : 0;
    const outras = e.esperando - jaDita;
    const esperasNoResto = outras <= 0 ? "" : jaDita ? `${outras} esperando` : textoDasEsperas(e);
    const contagem = total === 1 && um ? [tituloCurto(g.titulo), estadoDoGrupo(g)] : [precisam ? (precisam === 1 ? "1 precisa de você" : `${precisam} precisam de você`) : "", prontas ? (prontas === 1 ? "1 pronta" : `${prontas} prontas`) : "", prontas === 0 && !precisam ? "rodando" : ""];
    const resto = [...contagem, esperasNoResto, e.fila > 0 ? textoDaFila(e, dono.fila.length) : ""].filter(Boolean);
    const vivo = grupos.some((x) => x.frentes.some((f) => f.estado === "rodando"));
    const doLote = new Set(grupos.flatMap((x) => x.ids));
    const esperasForaDoLote = dono.esperas.filter((x) => !x.trabalhoId || !doLote.has(x.trabalhoId)).length;
    const emEspera = dono.esperas.flatMap((x) => (x.trabalhoId && doLote.has(x.trabalhoId) ? [x.trabalhoId] : []));
    return { agenteId, nome, sinal: vivo ? "vivo" : "espera", texto, resto, grupos, esperas, fila, memoria, abertas, esperasForaDoLote, emEspera, ...(bot?.cor ? { cor: bot.cor } : {}) };
  }
  // Sem frentes: a espera ou a fila, pela prioridade da linha do dono (o "Esperando você" fica com o cartão da pergunta).
  const desistidas = doServidor.esperas.length - dono.esperas.length;
  const l = linhaDoDono({ ...dono, estado: { ...e, esperandoVoce: 0, esperando: Math.max(0, e.esperando - desistidas) } }, estado.agora);
  if (!l || l.sinal === "voce") return null;
  // NOD-377: a única espera, de colega vencida ou cobrada, troca o tempo por "sem resposta há 26h" / "cobrado agora".
  const [unica] = esperas;
  const resumo = esperas.length === 1 && l.sinal === "espera" ? unica?.colega?.resumo : undefined;
  const resto = resumo ? [resumo, ...l.extras.filter((x) => !/^(\d+ min|menos de 1 min|\d+h|\d+ d)$/.test(x))] : l.extras;
  return { agenteId, nome, sinal: l.sinal === "vivo" ? "vivo" : l.sinal, texto: l.texto, resto, grupos: [], esperas, fila, memoria, abertas: [], ...(resumo && unica?.colega?.vencida ? { vencida: true } : {}) };
}

/**
 * A memória do Mac como a pílula a mostra: só na conversa limpa e com trabalho aberto do bot (como o ponto do PR 2). A
 * memória em si só vem com trabalho do bot rodando no Mac (NOD-372, em memoriaDoMac); o disco cheio, com qualquer aberto.
 */
export function memoriaNaPilula(estado: Estado, agenteId: string, conversaId: string | null | undefined): (MemoriaNoProgresso & { alvo: string; curto?: string }) | null {
  const c = conversaId ? estado.conversas[conversaId] : undefined;
  if (!c?.mensagens || !conversaLimpa(c.mensagens)) return null;
  // ADR-187 (4t, escolhido em 2026-11-18): com as máquinas no DTO, o aviso é da máquina onde as tarefas deste bot rodam
  // (memória, processador ou disco), pelo nome dela, e o clique abre Máquinas nela. Servidor anterior: o aviso do Mac.
  const maquinas = maquinasDe(estado.trabalhos);
  if (maquinas) {
    // Como na NOD-372: conta a tarefa rodando de verdade (fora de espera de colega, comando ou volta) — e a que a própria
    // máquina segura (`esperaDoMac`: disco, memória, processador), que é justamente o que o aviso explica.
    const pesam = trabalhosConhecidos(estado, conversaId).filter((t) => t.agenteId === agenteId && ((t.estado === "rodando" && !emEspera(t)) || (aberto(t) && !!t.esperaDoMac)));
    const a = avisoDaMaquina(maquinas, pesam.map((t) => t.maquina));
    return a ? { texto: a.frase, curto: a.curto, nivel: a.nivel, alvo: `data-act="secao-espaco" data-secao="maquinas" data-maquina="${esc(a.maquinaId)}"` } : null;
  }
  const m = memoriaDoMac(estado, agenteId, conversaId);
  return m && m.abertos > 0 ? { texto: m.texto, nivel: m.nivel, alvo: m.alvo } : null;
}

// ---- o HTML --------------------------------------------------------------------------------------------------------

/** O id do painel: um só na tela (a pílula é da conversa à vista). */
export const ID_PAINEL = "pf-painel";

// ADR-187 §5 (protótipo P1, Paper "Aba das tarefas"): a seta de 10 px com o traço do protótipo; o anel de quem roda e o
// ponto de quem precisa da pessoa moram em icones-da-tarefa.ts desde 2026-11-18.
const SETA_CIMA = '<svg class="pf-seta" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.25 L5 3.75 L7.5 6.25"/></svg>';
const TRIANGULO = '<svg class="pf-selo-ic" width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.6 L12.9 12 H1.1 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M7 5.4 V8.2 M7 10.1 V10.2" stroke="var(--chat-superficie)" stroke-width="1.4" stroke-linecap="round"/></svg>';
const SETA_BAIXO = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const SETA_SOBE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

const PARAR = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>';

/**
 * ADR-190 (Paper 5c, 3): um lugar onde o bot está agora (o navegador dele), como a pílula o lista: "● Navegador da Ada ·
 * ao vivo". Clicar abre a aba do lugar (o modo abas, com ela à vista).
 */
export type LugarNaPilula = { agenteId: string; rotulo: string; estado: string; ponto: "vivo" | "precisa"; site: string };

const pontoDoLugar = (l: LugarNaPilula): string => `<span class="pf-ponto-lugar" data-ponto="${l.ponto}" aria-hidden="true"></span>`;

/** Os lugares na lista aberta da pílula (a seção "Lugares", antes das tarefas). */
function secaoDosLugares(lugares: readonly LugarNaPilula[]): string {
  if (!lugares.length) return "";
  const itens = lugares.map((l) => `<li class="tv-item"><button type="button" class="tv-linha pf-lugar-linha" data-act="navegador-abrir-aba" data-agente="${esc(l.agenteId)}" data-estado="${l.ponto}">${pontoDoLugar(l)}<span class="tv-texto"><span class="tv-titulo">${esc(l.rotulo)}</span><span class="tv-estado">${esc([l.site, l.estado].filter(Boolean).join(" · "))}</span></span></button></li>`).join("");
  return `<h3 class="pf-secao">Lugares</h3><ul class="pf-lista">${itens}</ul>`;
}

/**
 * Paper 5c (3): sem tarefas, a pílula do campo é o lugar — "● Navegador da Ada · ao vivo ⌃" — e o clique abre a aba
 * dele. Com a tarefa nova à mão, o "+" ao lado, como na aba que conta.
 */
export function htmlDaAbaDoLugar(lugares: readonly LugarNaPilula[], novaTarefa: NovaTarefaNaAba | null): string {
  const [l] = lugares;
  if (!l) return novaTarefa ? htmlDaAbaVazia(novaTarefa) : "";
  const mais = lugares.length > 1 ? ` · +${lugares.length - 1}` : "";
  return `<div class="pilula-frentes pf-vazia pf-com-lugar" data-estado="fechada"><div class="pf-fechada">`
    + `<button type="button" class="pf-botao pf-lugar" data-act="navegador-abrir-aba" data-agente="${esc(l.agenteId)}" aria-label="${esc(`Abrir ${l.rotulo}, ${l.estado}`)}">${pontoDoLugar(l)}<span class="pf-texto">${esc(l.rotulo)}</span><span class="pf-resto">· ${esc(l.estado)}${esc(mais)}</span>${SETA_CIMA}</button>`
    + `${novaTarefa ? htmlDoMais(novaTarefa) : ""}</div></div>`;
}

/** As partes que o desenho troca uma a uma (o botão e o painel ficam; só o miolo que mudou é regravado). */
export type PartesDaPilula = {
  /** Muda quando é outro bot: o esqueleto é refeito, sem animação. */
  chave: string;
  botao: string;
  /** ADR-187 §5 (Paper 4q, opção B): a segunda aba "+" à direita da que conta (nova tarefa); vazio = sem ela. Fixa no esqueleto. */
  mais?: string;
  memoria: string;
  rotulo: string;
  cab: string;
  corpo: string;
  pe: string;
  /** A chave da telemetria (tipo `frentes`, ADR-099), quando a pílula fala de frentes. */
  telemetria: string | null;
};

function ponto(sinal: Pilula["sinal"]): string {
  return `<span class="pf-ponto ${sinal}" aria-hidden="true"></span>`;
}

function itemDaEspera(v: EsperaNaTela, agenteId: string): string {
  const titulo = v.comando ? `<code class="pf-comando">${esc(v.titulo)}</code>` : `<span class="pf-item-titulo">${esc(v.titulo)}</span>`;
  const c = v.colega;
  const linhas = v.linhas.map((x, i) => `<span class="pf-sub${i === 0 && x.startsWith("última linha") ? " mono" : ""}${i === 0 && c?.vencida ? " p377-venc" : ""}">${esc(x)}</span>`).join("");
  // NOD-377 (protótipo aprovado): vencida ou cobrada, Cobrar/Desistir em texto embaixo, e o tempo à direita sai.
  const acoes = c?.acoes ? htmlDasAcoes({ agenteId, tarefaId: c.tarefaId, colega: c.nome, podeCobrar: c.podeCobrar, fase: acaoLocal.fase(c.tarefaId) }) : "";
  const fim = v.tempo ? `<span class="pf-item-fim">${esc(v.tempo)}</span>` : "";
  return `<li class="pf-item${acoes ? " p377-item" : ""}">${ponto("espera")}<span class="pf-item-corpo">${titulo}${linhas}${acoes}</span>${fim}</li>`;
}

/** Paper 15c: "As frentes do Dante usam 1,2 GB do seu Mac", quando a memória não está apertada (apertada, vale o aviso). */
function linhaDaMemoria(p: Pilula): string {
  const mb = p.abertas.reduce((s, t) => s + (t.memoriaMb ?? 0), 0);
  if (p.memoria || mb <= 0) return "";
  const qto = mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(mb)} MB`;
  return `<p class="pf-memoria-info">${CHIP}As tarefas do ${esc(p.nome)} usam ${qto} do seu Mac</p>`;
}
const CHIP = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6 1.8V4M10 1.8V4M6 12v2.2M10 12v2.2M1.8 6H4M1.8 10H4M12 6h2.2M12 10h2.2"/></svg>';

/**
 * A lista aberta da pílula (validação de 2026-11-18, Paper 9e/9f, jeito D: a pilha agrupada por urgência). As tarefas de
 * todos os lotes juntas, em seções: "Precisa de você" (com a pergunta), "Rodando · N" (com o passo), "Parada" e, no fim,
 * as prontas recolhidas numa linha ("✓ 3 prontas", que abre ali mesmo) — com 10 tarefas a lista cabe sem rolar. A linha
 * inteira abre a tarefa (`linhaDaTarefa`, modo `lista`). Depois, as esperas, a fila, o aviso da máquina e "+ Nova tarefa".
 */
function corpoDaPilula(p: Pilula, novaTarefa: NovaTarefaNaAba | null): string {
  const fora = new Set(p.emEspera ?? []);
  const todas = p.grupos.flatMap((g) => g.frentes).filter((f) => !fora.has(f.trabalhoId));
  const de = (...es: FrenteNaFala["estado"][]): FrenteNaFala[] => todas.filter((f) => es.includes(f.estado));
  const secao = (titulo: string, fs: readonly FrenteNaFala[], classe = ""): string =>
    fs.length ? `<h3 class="pf-secao${classe}">${esc(titulo)}</h3><ul class="pf-lista">${fs.map((f) => linhaDaTarefa(f, "lista")).join("")}</ul>` : "";
  const precisam = de("precisa");
  const rodando = de("rodando", "esperando", "sem_noticia");
  const paradas = de("parada", "falhou");
  const prontas = de("pronta");
  const feitas = prontas.length
    ? `<details class="pf-prontas"><summary>${IC_OK_PRONTAS}<span>${prontas.length === 1 ? "1 pronta" : `${prontas.length} prontas`}</span>${SETA_DIREITA}</summary><ul class="pf-lista">${prontas.map((f) => linhaDaTarefa(f, "lista")).join("")}</ul></details>`
    : "";
  const tarefas = `${secao("Precisa de você", precisam, " pf-secao-precisa")}${secao(rodando.length > 1 ? `Rodando · ${rodando.length}` : "Rodando", rodando)}${secao(paradas.length > 1 ? `Paradas · ${paradas.length}` : "Parada", paradas)}${feitas}`;
  const esperas = p.esperas.length ? `<h3 class="pf-secao">Esperando</h3><ul class="pf-lista">${p.esperas.map((v) => itemDaEspera(v, p.agenteId)).join("")}</ul>` : "";
  const fila = p.fila.length ? `<h3 class="pf-secao">Na fila</h3><ul class="pf-lista">${p.fila.map((x, i) => `<li class="pf-item"><span class="pf-ordem" aria-hidden="true">${i + 1}</span><span class="pf-item-corpo"><span class="pf-item-titulo">${esc(x.quem.charAt(0).toUpperCase() + x.quem.slice(1))}</span></span><span class="pf-item-fim">${esc(hora(x.desde))}</span></li>`).join("")}</ul>` : "";
  // A frase da memória só aqui dentro (decisão tomada 5); o ponto leva a Trabalhos, Este Mac ou Máquinas.
  const memoria = p.memoria ? `<button type="button" class="pf-memoria-linha ${p.memoria.nivel}" ${p.memoria.alvo}><span class="pf-memoria-ponto" aria-hidden="true"></span>${esc(p.memoria.texto)}</button>` : "";
  const nova = novaTarefa ? `<button type="button" class="pf-nova-linha" data-act="nova-tarefa" aria-keyshortcuts="${esc(novaTarefa.aria)}">+ Nova tarefa <kbd class="pf-nova-atalho">${esc(novaTarefa.atalho)}</kbd></button>` : "";
  return `${tarefas}${esperas}${fila}${memoria}${linhaDaMemoria(p)}${nova}`;
}
const IC_OK_PRONTAS = '<svg class="pf-prontas-ic" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="currentColor"/><path d="M3.5 6.2l1.6 1.6 3.4-3.4" fill="none" stroke="var(--chat-superficie)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SETA_DIREITA = '<svg class="pf-prontas-seta" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.75 2.5 L6.25 5 L3.75 7.5"/></svg>';

/**
 * As partes da pílula. `progresso` diz se a fala de algum grupo está na janela carregada: sem ela, "Ver na conversa" não
 * tem para onde levar e não aparece.
 */
export function partesDaPilula(p: Pilula, progresso: Pick<ProgressoNaTela, "naTimeline">, novaTarefa: NovaTarefaNaAba | null = null, lugares: readonly LugarNaPilula[] = []): PartesDaPilula {
  // P1: o resto começa com o separador ("12 tarefas · 1 precisa de você · 3 prontas"); com tarefas, o ícone diz o estado —
  // o ponto azul quando alguma precisa da pessoa, o anel quando alguma roda; sem tarefas (espera, fila), o ponto de antes.
  // Paper 5c (3): o lugar ativo entra no fim ("2 tarefas · rodando · Navegador da Ada ao vivo") e no topo da lista aberta.
  const comLugares = [...p.resto, ...lugares.map((l) => `${l.rotulo} ${l.estado}`)];
  const resto = comLugares.length ? `<span class="sr-only">, </span><span class="pf-resto${p.vencida ? " p377-resto" : ""}">· ${esc(comLugares.join(" · "))}</span>` : "";
  const precisa = p.grupos.some((g) => g.frentes.some((f) => f.estado === "precisa"));
  const icone = p.grupos.length && precisa ? PONTO_PRECISA : p.grupos.length && p.sinal === "vivo" ? ANEL_RODANDO : ponto(p.sinal);
  const botao = `${icone}<span class="pf-texto">${esc(p.texto)}</span>${resto}${SETA_CIMA}`;
  // ADR-187 (4t, opção A): o selo ao lado da aba diz o problema e a máquina; o ponto sem texto saiu. Sem `curto` (servidor
  // anterior), o texto do aviso do Mac.
  const memoria = p.memoria ? `<button type="button" class="pf-selo ${p.memoria.nivel}" ${p.memoria.alvo} title="${esc(p.memoria.texto)}" aria-label="${esc(p.memoria.texto)}">${TRIANGULO}<span>${esc(p.memoria.curto ?? p.memoria.texto)}</span></button>` : "";
  // Paper 15c: o ponto, o título forte e só "N de M prontas" em cinza (o resto está na lista logo abaixo); sem lote, tudo.
  const doCab = p.grupos.length ? p.resto.slice(0, 1) : p.resto;
  // O ponto na cor do bot (Paper: "ponto na cor do bot = bot trabalhando"); a classe só aceita o formato c-<nome>.
  const cor = p.cor && /^c-[a-z]+$/.test(p.cor) ? ` ${p.cor}` : "";
  // Paper 9f (validação de 2026-11-18): com tarefas, o topo da lista é "Tarefas abertas" e "Ver todas ›" (a tela Tarefas
  // deste bot); fechar é clicar fora, Esc ou a própria pílula. Sem tarefas (espera, fila), o topo de antes.
  const cab = p.grupos.length
    ? `<span class="pf-cab-titulo"><b>Tarefas abertas</b></span><button type="button" class="pf-ver-todas" data-act="abrir-tarefas" data-agente="${esc(p.agenteId)}">Ver todas${SETA_DIREITA}</button>`
    : `${ponto(p.sinal).replace('class="pf-ponto ', `class="pf-ponto pf-cab-ponto${cor} `)}<span class="pf-cab-titulo"><b>${esc(p.texto)}</b>${doCab.length ? `<span class="pf-cab-resto">${esc(doCab.join(" · "))}</span>` : ""}</span><button type="button" class="pf-fechar" data-act="pilula" data-recolher="1" aria-expanded="true" aria-controls="${ID_PAINEL}">${SETA_BAIXO}fechar</button>`;
  const naConversa = p.grupos.some((g) => g.ids.some((id) => progresso.naTimeline.has(id)));
  const pe = [
    naConversa ? `<button type="button" class="pf-ver" data-act="pilula-ver-na-conversa">Ver na conversa${SETA_SOBE}</button>` : "",
    p.abertas.length ? `<button type="button" class="pf-parar" data-act="pilula-parar">${PARAR}Parar</button>` : "",
  ].join("");
  const rotulo = p.grupos.length ? `Tarefas de ${p.nome}` : `O que ${p.nome} está esperando`;
  const mais = novaTarefa ? htmlDoMais(novaTarefa) : "";
  return { chave: mais ? `${p.agenteId}:mais` : p.agenteId, botao, ...(mais ? { mais } : {}), memoria, rotulo, cab, corpo: secaoDosLugares(lugares) + corpoDaPilula(p, novaTarefa), pe, telemetria: chaveDaTelemetria(p.grupos) };
}

/**
 * A chave da pílula na telemetria das linhas (tipo `frentes`). O servidor só aceita `[A-Za-z0-9:_-]{1,200}` e recusa o lote
 * inteiro quando uma chave não passa (`CHAVE_LINHA`, src/use-cases/telemetria-linhas.ts): os grupos juntos por vírgula
 * derrubavam, com dois lotes, todos os eventos do lote, e com cinco passavam de 200 caracteres (revisão do PR 400). Um grupo
 * fica legível ("frentes:pilula:lote:<id>"); vários viram a contagem e um resumo curto dos grupos, o mesmo para o mesmo
 * conjunto (a mostrada e a aberta da mesma pílula casam).
 */
function chaveDaTelemetria(grupos: readonly Pick<GrupoDaPilula, "chave">[]): string | null {
  const [unico] = grupos;
  if (!unico) return null;
  if (grupos.length === 1) return `frentes:pilula:${unico.chave}`;
  // FNV-1a de 32 bits dos grupos em ordem: curto, só letras e números.
  let h = 0x811c9dc5;
  for (const ch of grupos.map((g) => g.chave).sort().join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `frentes:pilula:${grupos.length}-grupos:${h.toString(36)}`;
}

/**
 * O esqueleto inteiro (o primeiro desenho, e o que os testes leem): a pílula é um `<button aria-expanded aria-controls>`;
 * alargada, um `role="region"` com nome. Escondida (a fala à vista), sai da árvore de acessibilidade e do Tab com `hidden`
 * — nunca só com opacidade, como no protótipo. O painel fechado também é `hidden`.
 */
export function htmlDaPilula(partes: PartesDaPilula, c: { aberta: boolean; escondida: boolean }): string {
  return `<div class="pilula-frentes" data-estado="${c.aberta ? "aberta" : "fechada"}"${c.escondida ? " hidden" : ""}>`
    + `<div class="pf-fechada"><button type="button" class="pf-botao" data-act="pilula" aria-expanded="${c.aberta}" aria-controls="${ID_PAINEL}">${partes.botao}</button>${partes.mais ?? ""}<span class="pf-memoria-lugar">${partes.memoria}</span></div>`
    + `<div class="pf-moldura"><section class="pf-painel" id="${ID_PAINEL}" role="region" aria-label="${esc(partes.rotulo)}"${c.aberta ? "" : " hidden"}><div class="pf-cab">${partes.cab}</div><div class="pf-miolo">${partes.corpo}</div><div class="pf-pe">${partes.pe}</div></section></div>`
    + `<button type="button" class="pf-fundo" data-act="pilula" data-recolher="1" tabindex="-1" aria-hidden="true"></button>`
    + `</div>`;
}

/** O bot só tem frente na fila: nenhuma rodando, parada à espera da pessoa ou com espera (comando, colega, volta). */
export function soNaFila(estado: Estado, agenteId: string, pilula: Pick<Pilula, "esperas">): boolean {
  if (pilula.esperas.length > 0) return false;
  const doBot = trabalhosConhecidos(estado, agente(estado, agenteId)?.conversaId).filter((t) => t.agenteId === agenteId);
  const abertos = doBot.filter((t) => t.estado === "na_fila" || t.estado === "rodando" || t.estado === "precisa_de_voce");
  return abertos.length > 0 && abertos.every((t) => t.estado === "na_fila");
}

/** O que a região acima do campo mostra na conversa do bot. */
export type PilulaNaConversa =
  | { tipo: "nada" }
  | { tipo: "legado"; html: string }
  /** ADR-187 §5 (Paper 4q, opção B): sem tarefas, a aba nunca some: "+ Nova tarefa ⌘N" (e a dica, uma vez por pessoa). */
  | { tipo: "vazia"; html: string }
  | { tipo: "pilula"; pilula: Pilula; partes: PartesDaPilula; escondida: boolean };

/**
 * ADR-187 §5 e §7 (lote B, passo 2, 2026-11-18): a pessoa pode abrir uma tarefa deste bot daqui. Quem chama decide (a
 * conversa do próprio bot, com IA e fora dos segundos em que o bot novo reflete); `atalho` é o texto da tecla no lugar
 * ("⌘N", "⌃N", "Alt+N") e `aria` o aria-keyshortcuts. A dica das tarefas (Paper 4q, C) saiu na validação de 2026-11-18:
 * poluía a conversa, e a aba se explica sozinha.
 */
export type NovaTarefaNaAba = { atalho: string; aria: string };

const MAIS_DA_ABA = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M6 2v8M2 6h8"/></svg>';

/** A segunda aba "+" ao lado da que conta (Paper 4q, opção B). */
function htmlDoMais(n: NovaTarefaNaAba): string {
  return `<button type="button" class="pf-mais" data-act="nova-tarefa" aria-label="Nova tarefa" title="Nova tarefa (${esc(n.atalho)})" aria-keyshortcuts="${esc(n.aria)}">${MAIS_DA_ABA}</button>`;
}

/** Sem tarefas (Paper 4q, opção B): a aba discreta "+ Nova tarefa ⌘N". */
export function htmlDaAbaVazia(n: NovaTarefaNaAba): string {
  return `<div class="pilula-frentes pf-vazia" data-estado="fechada"><div class="pf-fechada"><button type="button" class="pf-botao pf-nova" data-act="nova-tarefa" aria-keyshortcuts="${esc(n.aria)}"><span class="pf-nova-texto">+ Nova tarefa</span><kbd class="pf-nova-atalho" aria-hidden="true">${esc(n.atalho)}</kbd></button></div></div>`;
}

/**
 * A pílula da conversa com o progresso medido na tela. Sem o dono no servidor (anterior ao I10), a faixa de tasks de antes.
 * `novaTarefa` (ADR-187 §5): a aba "+ Nova tarefa" quando não há o que contar, e o "+" ao lado da aba que conta.
 */
export function pilulaNaConversa(estado: Estado, agenteId: string, progresso: ProgressoNaTela, novaTarefa: NovaTarefaNaAba | null = null, lugares: readonly LugarNaPilula[] = []): PilulaNaConversa {
  const bot = agente(estado, agenteId);
  // Paper 5c (3): sem tarefa a contar, o lugar ativo é a pílula; sem lugar, a aba "+ Nova tarefa" (ou nada).
  const vazia: PilulaNaConversa = lugares.length ? { tipo: "vazia", html: htmlDaAbaDoLugar(lugares, novaTarefa) } : novaTarefa ? { tipo: "vazia", html: htmlDaAbaVazia(novaTarefa) } : { tipo: "nada" };
  if (!donoDoBot(estado, agenteId, bot?.conversaId)) {
    if (soNaFila(estado, agenteId, { esperas: [] })) return lugares.length ? vazia : { tipo: "nada" };
    const html = renderFaixaTrabalhos(estado, agenteId);
    return html ? { tipo: "legado", html } : lugares.length ? vazia : { tipo: "nada" };
  }
  const pilula = pilulaDoBot(estado, agenteId);
  if (!pilula) return vazia;
  // Paper 05 (rodada 3 da casca, "igual ao Paper"): a frente só na fila, que ainda não começou, não ganha pílula acima do
  // campo — o painel do bot já diz "Na fila · começa já". A pílula volta quando ela começa (ou com espera de verdade).
  if (soNaFila(estado, agenteId, pilula)) return vazia;
  // Paper 15: a espera de uma frente do lote já está no bloco da fala; com ele à vista, só a espera de fora segura a pílula.
  const conteudo = { grupos: pilula.grupos, esperas: pilula.esperasForaDoLote ?? pilula.esperas.length, fila: pilula.fila.length };
  // A conversa aberta pela primeira vez nesta carga ainda não tem o histórico: a timeline está vazia, não há fala para medir,
  // e a pílula nascia à vista, contava "mostrada" e escorregava para fora quando as mensagens chegavam com a fala à vista (QA
  // do PR 400). Com frentes, ela espera escondida o histórico; espera e fila não têm fala-âncora e aparecem já.
  const cid = bot?.conversaId;
  const semHistorico = !!cid && estado.conversas[cid] === undefined;
  // Um lugar ativo segura a pílula à vista, como a espera e a fila: ele não tem fala-âncora (a linha de atividade é outra).
  const escondida = !lugares.length && (pilulaEscondida(conteudo, progresso) || (semHistorico && pilulaEscondida(conteudo, { naTimeline: new Set(), aVista: new Set(pilula.grupos.flatMap((g) => g.ids)) })));
  return { tipo: "pilula", pilula, partes: partesDaPilula(pilula, progresso, novaTarefa, lugares), escondida };
}

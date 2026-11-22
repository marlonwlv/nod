import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { PassoDoRun } from "../../src/contracts/quadro-comentarios.ts";
import type { AtividadeTarefa, EstadoTarefa, TarefaNoTrabalho } from "../../src/contracts/tarefa.ts";
import type { TrabalhoDetalheDto, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { AtividadeTurno } from "../lib/atividade.ts";
import { esc, hora } from "../lib/render.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { emEspera, situacaoDe } from "../lib/trabalhos.ts";

/**
 * Dentro da tarefa (ADR-187 §6, lote B, passo 4, definido em 2026-11-18; Paper 4k, 4l, 4m, 4n e 4s): a conversa detalhada
 * — o pedido num cartão, as falas e, entre elas, os passos com o que cada um fez ("Rodou um comando · npm test") — e o
 * campo da tarefa, que muda com o estado: rodando (recado + Parar no lugar do enviar, Esc para), precisa de você (a
 * pergunta e as opções na própria conversa), parada ("Continuar de onde parou" e "Encerrar a tarefa") e feita (a entrega
 * à vista). Tudo puro, em string; web/telas/trabalhos.ts e main.ts põem nas regiões.
 */

export type PassoDaTarefa = NonNullable<TrabalhoDetalheDto["passos"]>[number];

/** Paper 4k: os passos seguidos entre duas falas, abertos até este número; acima, os mais antigos recolhem em "mais N". */
export const PASSOS_A_VISTA = 6;

const ICONE_OK = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.2 L6 10 L11 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONE_FALHOU = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 3.5v4.2M7 10.2v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICONE_RODANDO = '<svg class="tk-gira" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--chat-spinner-trilho)" stroke-width="1.6"/><path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICONE_PRECISA = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M7 3.8V7.6M7 9.8v.1" stroke="var(--chat-superficie)" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Paper 4k: o cartão "Pedido · escrito por …" no começo da conversa da tarefa. */
export function htmlPedido(texto: string, escritoPor: string): string {
  return `<section class="tk-pedido" aria-label="Pedido"><div class="tk-pedido-rot">Pedido · escrito por ${esc(escritoPor)}</div><div class="tk-pedido-txt">${textoFormatado(texto, { chave: `pedido:${texto.length}` })}</div></section>`;
}

/**
 * A fala da pessoa que é o pedido da tarefa: a primeira da conversa, dela, de até 5 s depois da tarefa nascer (a tarefa
 * aberta pela tela grava a fala e cria a tarefa na mesma transação; a da rede promove o turno que a fala abriu, antes).
 * definido em 2026-11-18: 5 s de folga para o relógio entre a gravação da fala e a da tarefa.
 */
export function falaDoPedido(t: Pick<TrabalhoDto, "criadoEm">, mensagens: readonly Mensagem[]): Mensagem | null {
  const primeira = [...mensagens].sort((a, b) => a.criadoEm - b.criadoEm)[0];
  return primeira && primeira.autoria.autor_tipo === "pessoa" && primeira.kind === "texto" && primeira.criadoEm <= t.criadoEm + 5_000 ? primeira : null;
}

/** Um passo numa linha: o ✓ (ou o ! de quem falhou), o que fez e o resumo do argumento em cinza (Paper 4k). */
export function linhaDoPasso(p: Pick<PassoDoRun, "rotulo" | "resumo" | "falhou">): string {
  return `<div class="tk-passo${p.falhou ? " falhou" : ""}"><span class="tk-passo-ic">${p.falhou ? ICONE_FALHOU : ICONE_OK}</span><span class="tk-passo-rot">${esc(p.rotulo)}</span>${p.resumo ? `<span class="tk-passo-res">${esc(p.resumo)}</span>` : ""}${p.falhou ? '<span class="sr-only"> (falhou)</span>' : ""}</div>`;
}

/** Os passos seguidos: até PASSOS_A_VISTA abertos; acima disso, os últimos à vista e os antes num "mais N passos". */
export function htmlPassos(passos: readonly Pick<PassoDoRun, "rotulo" | "resumo" | "falhou">[]): string {
  if (passos.length === 0) return "";
  const corte = passos.length > PASSOS_A_VISTA ? passos.length - (PASSOS_A_VISTA - 2) : 0;
  const antes = corte ? `<details class="tk-passos-antes"><summary>mais ${corte} passos</summary>${passos.slice(0, corte).map(linhaDoPasso).join("")}</details>` : "";
  return `<div class="tk-passos" role="list" aria-label="Passos">${antes}${passos.slice(corte).map(linhaDoPasso).join("")}</div>`;
}

export type ItemDaConversa = { tipo: "fala"; m: Mensagem } | { tipo: "passos"; passos: PassoDaTarefa[] } | { tipo: "narracao"; chave: string; texto: string };

/** Texto comparável: sem marcação, espaço único, minúsculo (o resumo do passo de texto vem redigido e cortado em 160). */
const comparavel = (s: string): string => s.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * O passo de texto (o bloco que o bot escreveu antes de uma ferramenta, ADR-165) que já é uma fala da conversa: a fala do
 * mesmo turno que começa igual. Os outros são a narração do meio da volta (Paper 4k: "Vou começar pelo diff…").
 */
function textoJaFalado(p: PassoDaTarefa, falas: readonly Mensagem[]): boolean {
  const inicio = comparavel((p.resumo ?? "").replace(/…$/, "")).slice(0, 60);
  return inicio === "" || falas.some((m) => m.turnoId === p.turnoId && comparavel(m.texto).includes(inicio));
}

/** Os passos em itens: as ferramentas seguidas num bloco; o texto que ainda não é fala, como narração. */
export function itensDosPassos(passos: readonly PassoDaTarefa[], falas: readonly Mensagem[]): ItemDaConversa[] {
  const itens: ItemDaConversa[] = [];
  for (const p of passos) {
    if (p.tipo === "texto") {
      if (!textoJaFalado(p, falas)) itens.push({ tipo: "narracao", chave: `narracao:${p.seq}`, texto: p.resumo ?? "" });
      continue;
    }
    const ultimo = itens[itens.length - 1];
    if (ultimo?.tipo === "passos") ultimo.passos.push(p);
    else itens.push({ tipo: "passos", passos: [p] });
  }
  return itens;
}

/**
 * As falas e os passos na ordem em que aconteceram (Paper 4k): os passos seguidos entre duas falas viram um bloco e o texto
 * do meio da volta, uma narração. Os do turno vivo ficam de fora — o ao vivo os mostra, com o que chega pelos frames.
 */
export function conversaDaTarefa(mensagens: readonly Mensagem[], passos: readonly PassoDaTarefa[], turnoVivoId: string | null): ItemDaConversa[] {
  type Evento = { em: number; ordem: number } & ({ tipo: "fala"; m: Mensagem } | { tipo: "passo"; p: PassoDaTarefa });
  const eventos: Evento[] = [
    ...mensagens.map((m, i): Evento => ({ em: m.criadoEm, ordem: i, tipo: "fala", m })),
    ...passos.filter((p) => p.turnoId !== turnoVivoId).map((p): Evento => ({ em: p.em, ordem: p.seq, tipo: "passo", p })),
  ].sort((a, b) => a.em - b.em || (a.tipo === b.tipo ? a.ordem - b.ordem : a.tipo === "fala" ? 1 : -1));
  const itens: ItemDaConversa[] = [];
  let corrida: PassoDaTarefa[] = [];
  const fechar = (): void => { itens.push(...itensDosPassos(corrida, mensagens)); corrida = []; };
  for (const e of eventos) {
    if (e.tipo === "passo") { corrida.push(e.p); continue; }
    fechar();
    itens.push({ tipo: "fala", m: e.m });
  }
  fechar();
  return itens;
}

/** A narração do meio da volta (Paper 4k): o balão cinza do bot, sem avatar. */
export function htmlNarracao(texto: string, chave: string): string {
  return texto.trim() ? `<div class="tk-narracao"><div class="tk-narracao-balao">${textoFormatado(texto, { chave })}</div></div>` : "";
}

type PassoNaVolta = Pick<PassoDoRun, "rotulo" | "resumo" | "falhou">;
type AcaoDaVolta = AtividadeTurno["acoes"][number];
export type ItemDaVolta = { tipo: "narracao"; texto: string } | { tipo: "passos"; passos: PassoNaVolta[] };

/**
 * A volta que roda agora, pelo que chegou nos frames (web/lib/atividade.ts): cada etapa é uma narração seguida das
 * ferramentas que ela abriu, na ordem; a primeira etapa é só o rótulo quando a volta começou por uma ferramenta. As ações
 * já gravadas (o mesmo id do tool_use nos passos do detalhe) e a que roda agora (o "agora") ficam de fora.
 */
export function itensDaVolta(a: Pick<AtividadeTurno, "etapas" | "acoes">, gravadas: ReadonlySet<string> = new Set()): ItemDaVolta[] {
  const itens: ItemDaVolta[] = [];
  const acoes = a.acoes.filter((x) => !x.frentes);
  const feitas = (delas: readonly AcaoDaVolta[]): void => {
    const passos = delas.filter((x) => x.estado !== "rodando" && !(x.id && gravadas.has(x.id))).map((x) => ({ rotulo: x.rotulo, resumo: x.resumo ?? null, falhou: x.estado === "falhou" }));
    if (passos.length) itens.push({ tipo: "passos", passos });
  };
  let k = 0;
  a.etapas.forEach((etapa, i) => {
    const soRotulo = i === 0 && acoes[0] !== undefined && etapa.texto === acoes[0].rotulo;
    if (!soRotulo && etapa.texto.trim()) itens.push({ tipo: "narracao", texto: etapa.texto });
    feitas(acoes.slice(k, k + etapa.ferramentas));
    k += etapa.ferramentas;
  });
  // O que as etapas não contam (a fala do bot zera as etapas e as ações seguem: soSubagentes) vai no fim, na ordem.
  feitas(acoes.slice(k));
  return itens;
}

/** O "agora" (Paper 4k): o anel girando, o que roda em 500 e, embaixo, o argumento em mono. */
export function linhaDoAgora(texto: string, detalhe: string | null): string {
  return `<div class="tk-agora" role="status"><div class="tk-agora-linha"><span class="tk-passo-ic">${ICONE_RODANDO}</span><span class="tk-agora-txt">${esc(texto)}</span></div>${detalhe ? `<div class="tk-agora-detalhe">${esc(detalhe)}</div>` : ""}</div>`;
}

/**
 * Paper 4n: a pergunta aberta da tarefa, na própria conversa — "<bot> precisa de você", a pergunta e as opções (a primeira
 * cheia). Responder por um botão é o `responder-opcao` de sempre; a resposta livre vai pelo campo da tarefa.
 */
export function cartaoPrecisaDeVoce(m: Pick<Mensagem, "id" | "texto">, bot: string, decisaoId: string, opcoes: readonly string[]): string {
  const botoes = opcoes.map((o, i) => `<button type="button" class="tk-opcao${i === 0 ? " primeira" : ""}" data-act="responder-opcao" data-id="${esc(decisaoId)}" data-texto="${esc(o)}">${esc(o)}</button>`).join("");
  return `<section class="tk-precisa" data-mensagem="${esc(m.id)}" data-pergunta="${esc(decisaoId)}" role="group" aria-label="${esc(`${bot} precisa de você`)}"><div class="tk-precisa-rot"><span class="tk-precisa-ic">${ICONE_PRECISA}</span>${esc(bot)} precisa de você</div><div class="tk-precisa-txt">${textoFormatado(m.texto, { chave: `precisa:${m.id}` })}</div>${botoes ? `<div class="tk-opcoes">${botoes}</div>` : ""}</section>`;
}

/** A pergunta aberta da tarefa que espera a pessoa: a última fala de pergunta do bot, com a tarefa em "precisa de você". */
export function perguntaAberta(t: Pick<TrabalhoDto, "estado">, mensagens: readonly Mensagem[]): { m: Mensagem; decisaoId: string; opcoes: readonly string[] } | null {
  if (t.estado !== "precisa_de_voce" && t.estado !== "fechado_ocioso") return null;
  const ultima = [...mensagens].sort((a, b) => a.criadoEm - b.criadoEm).filter((m) => m.payload?.kind === "pedido_a_pessoa").at(-1);
  if (!ultima || ultima.payload?.kind !== "pedido_a_pessoa") return null;
  return { m: ultima, decisaoId: ultima.payload.decisaoId, opcoes: ultima.payload.opcoes ?? [] };
}

/**
 * A linha do fim (Paper 4l e 4m): "Você parou a tarefa · 15:43"; "Tarefa feita · 15:51 · o resultado também foi para a
 * conversa com <bot>" (a frente de um lote, que volta ao dono); "Não terminou · …" na que falhou.
 */
export function linhaDoFim(t: Pick<TrabalhoDto, "estado" | "terminadoEm" | "criadoEm" | "loteId"> & Partial<Pick<TrabalhoDto, "forma" | "tarefa">>, bot: string): string {
  const quando = hora(t.terminadoEm ?? t.criadoEm);
  // ADR-192 (etapa 3): com a Tarefa ligada, o fim do trabalho é a ENTREGA — a resolução é da pessoa ("Entregue" nunca
  // aparece como resolvida).
  if (t.estado === "terminado" && t.tarefa?.estado === "resolvida") return `<div class="tk-fim feita"><span class="tk-fim-ok" aria-hidden="true">${ICONE_OK}</span>Resolvida · ${esc(hora(t.tarefa.resolvidaEm ?? t.terminadoEm ?? t.criadoEm))}</div>`;
  if (t.estado === "terminado" && t.tarefa) return `<div class="tk-fim feita"><span class="tk-fim-ok" aria-hidden="true">${ICONE_OK}</span>Entregue · ${esc(quando)}${t.forma === "frente" && t.loteId ? ` · o resultado também foi para a conversa com ${esc(bot)}` : ""}</div>`;
  if (t.estado === "parado") return `<div class="tk-fim parada"><span class="tk-fim-quadrado" aria-hidden="true"></span>Você parou a tarefa · ${esc(quando)}</div>`;
  if (t.estado === "terminado") return `<div class="tk-fim feita"><span class="tk-fim-ok" aria-hidden="true">${ICONE_OK}</span>Tarefa feita · ${esc(quando)}${t.forma === "frente" && t.loteId ? ` · o resultado também foi para a conversa com ${esc(bot)}` : ""}</div>`;
  if (t.estado === "falhou") return `<div class="tk-fim falhou"><span class="tk-fim-ok" aria-hidden="true">${ICONE_FALHOU}</span>Não terminou · ${esc(quando)}</div>`;
  return "";
}

/**
 * A entrega da tarefa feita (Paper 4m; validação de 2026-11-18, observação (a): a tarefa aberta pela pessoa acabou
 * mostrando só "Listei as três curiosidades e devolvi o resumo." — o conteúdo foi no devolver_resumo, que só a conversa
 * via). O que a frente devolveu (`resumo`): o feito, o que falta e o branch/PR, em texto. Sai se a última fala do bot já
 * diz o mesmo texto. Arquivos da entrega são do lote C.
 */
export function htmlEntrega(t: Pick<TrabalhoDto, "estado" | "resumo" | "id">, ultimaFalaDoBot: string | null): string {
  const r = t.resumo;
  if (t.estado !== "terminado" || !r?.feito?.trim()) return "";
  if (ultimaFalaDoBot && ultimaFalaDoBot.trim() === r.feito.trim()) return "";
  const extras = [r.falta ? `<p class="tk-entrega-falta"><b>Falta:</b> ${esc(r.falta)}</p>` : "", r.pr ? `<p class="tk-entrega-ref">PR #${esc(String(r.pr))}${r.branch ? ` · ${esc(r.branch)}` : ""}</p>` : r.branch ? `<p class="tk-entrega-ref">${esc(r.branch)}${r.sha ? ` · ${esc(r.sha.slice(0, 7))}` : ""}</p>` : ""].join("");
  return `<section class="tk-entrega" aria-label="Entrega"><div class="tk-entrega-rot">Entrega</div><div class="tk-entrega-txt">${textoFormatado(r.feito, { chave: `entrega:${t.id}` })}</div>${extras}</section>`;
}

/** O que o campo da tarefa mostra em cada estado (Paper 4k, 4l, 4m e 4n). */
export type CampoDaTarefa = {
  placeholder: string;
  /** A linha embaixo do campo, à esquerda. */
  nota: string;
  /** À direita da nota ("Esc para parar"), só rodando. */
  dica: string;
  /** O Parar no lugar do enviar (e o Esc para): só com a tarefa trabalhando ou na fila. */
  parar: boolean;
  /** "Continuar de onde parou" e "Encerrar a tarefa" acima do campo. */
  saida: boolean;
  /** O anel azul do campo de quando a tarefa espera a pessoa. */
  precisa: boolean;
};

/** Sem tarefa carregada, o campo neutro de antes. */
const CAMPO_NEUTRO: CampoDaTarefa = { placeholder: "Escreva para esta tarefa…", nota: "", dica: "", parar: false, saida: false, precisa: false };

/**
 * O estado do campo da tarefa. `guardadas`: quantas falas da pessoa a tarefa não leu antes do Parar (ADR-185) — a nota
 * diz que são a primeira coisa que ela lê ao continuar.
 */
export function campoDaTarefa(t: TrabalhoDto | undefined, bot: string, guardadas = 0): CampoDaTarefa {
  if (!t) return CAMPO_NEUTRO;
  // ADR-192 (emenda 5): a Tarefa arquivada não recebe mensagem (o servidor recusa); o caminho é o Desarquivar acima.
  if (t.tarefa?.estado === "arquivada") return { placeholder: "Desarquive para continuar a tarefa", nota: "Arquivada · desarquive (acima) para continuar a conversa com " + bot + ".", dica: "", parar: false, saida: false, precisa: false };
  switch (t.estado) {
    case "rodando":
      return {
        placeholder: "Mande um recado para a tarefa…",
        nota: emEspera(t) ? `${capitalizar(situacaoDe(t))} · o recado entra quando ${bot} voltar` : `${bot} está trabalhando · o recado entra no meio do trabalho`,
        dica: "Esc para parar", parar: true, saida: false, precisa: false,
      };
    case "na_fila":
      return { placeholder: "Mande um recado para a tarefa…", nota: `Na fila · ${bot} começa logo; o recado vai junto`, dica: "Esc para parar", parar: true, saida: false, precisa: false };
    case "precisa_de_voce":
    case "fechado_ocioso":
      return { placeholder: `Sua resposta para ${bot}…`, nota: "Esperando você · nada rodando até você responder. Um botão acima ou uma resposta livre aqui.", dica: "", parar: false, saida: false, precisa: true };
    case "parado":
      return {
        placeholder: "Diga o que fazer agora…",
        nota: guardadas > 0
          ? `Parada · nada rodando. ${guardadas === 1 ? "Seu recado ficou guardado: é a primeira coisa" : `Seus ${guardadas} recados ficaram guardados: são a primeira coisa`} que ${bot} lê ao continuar.`
          : `Parada · nada rodando. Mandar uma mensagem continua a tarefa com ${bot}.`,
        dica: "", parar: false, saida: true, precisa: false,
      };
    case "falhou":
      return { placeholder: "Diga o que fazer agora…", nota: "Não terminou · mandar uma mensagem continua a tarefa, na mesma sessão e pasta.", dica: "", parar: false, saida: true, precisa: false };
    case "terminado":
      // ADR-192 (etapa 3): com a Tarefa ligada, o fim é a entrega; o campo é o Continuar.
      if (t.tarefa?.estado === "resolvida") return { placeholder: "Continuar tarefa…", nota: "Resolvida. Mandar uma mensagem reabre a tarefa, na mesma conversa.", dica: "", parar: false, saida: false, precisa: false };
      if (t.tarefa) return { placeholder: "Continuar tarefa…", nota: `Entregue · ${bot} terminou esta parte. Marque como resolvida ou continue a conversa.`, dica: "", parar: false, saida: false, precisa: false };
      return { placeholder: "Pedir mais alguma coisa nesta tarefa…", nota: "Feita. Mandar uma mensagem reabre a tarefa, na mesma sessão e pasta.", dica: "", parar: false, saida: false, precisa: false };
  }
}

/** ADR-192: o estado do objetivo, como a pessoa lê. */
export const ROTULO_DO_OBJETIVO: Record<EstadoTarefa, string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  entregue: "Entregue",
  resolvida: "Resolvida",
  arquivada: "Arquivada",
};

/** ADR-192: a atividade atual, ao lado do estado ("Entregue · precisa de você"). */
export const ROTULO_DA_ATIVIDADE: Record<AtividadeTarefa, string> = {
  trabalhando: "trabalhando",
  precisa_de_voce: "precisa de você",
  em_espera: "em espera",
  interrompida: "interrompida",
};

/** "Entregue · precisa de você", "Em andamento · trabalhando", "Resolvida", "Arquivada". */
export function rotuloDoObjetivo(t: Pick<TarefaNoTrabalho, "estado" | "atividade">): string {
  const estado = ROTULO_DO_OBJETIVO[t.estado];
  return t.atividade && t.estado !== "arquivada" ? `${estado} · ${ROTULO_DA_ATIVIDADE[t.atividade]}` : estado;
}

/** A Tarefa tem execução viva (o servidor exige a escolha entre parar e deixar terminar ao resolver ou arquivar). */
export function tarefaComExecucaoViva(t: Pick<TrabalhoDto, "estado" | "turnoVivoId">): boolean {
  return t.turnoVivoId !== null || t.estado === "rodando" || t.estado === "na_fila";
}

/**
 * ADR-192 (etapa 3): o objetivo da tarefa e as ações da pessoa, no fim da conversa da tarefa. Com execução viva, Resolver
 * e Arquivar viram dois botões cada (parar ou deixar terminar): a escolha é explícita, nunca inferida.
 */
export function htmlObjetivoDaTarefa(t: Pick<TrabalhoDto, "estado" | "turnoVivoId"> & Partial<Pick<TrabalhoDto, "tarefa">>): string {
  const o = t.tarefa;
  if (!o) return "";
  const vivo = tarefaComExecucaoViva(t);
  const bt = (act: string, rotulo: string, extra = "") => `<button type="button" class="tk-objetivo-bt" data-act="${act}" data-id="${esc(o.id)}" data-versao="${o.versao}"${extra}>${esc(rotulo)}</button>`;
  const acoes: string[] = [];
  if (o.estado === "arquivada") acoes.push(bt("tarefa-desarquivar", "Desarquivar"));
  else {
    if (o.estado === "resolvida") acoes.push(bt("tarefa-reabrir", "Reabrir"));
    else if (vivo) acoes.push(bt("tarefa-resolver", "Resolver e parar", ' data-turno-vivo="parar"'), bt("tarefa-resolver", "Resolver e deixar terminar", ' data-turno-vivo="manter"'));
    else acoes.push(bt("tarefa-resolver", "Marcar como resolvida"));
    acoes.push(vivo ? bt("tarefa-arquivar", "Arquivar e parar", ' data-turno-vivo="parar"') : bt("tarefa-arquivar", "Arquivar"));
  }
  // A linha do fim já diz "Entregue · 15:51" ou "Resolvida · 15:51": o rótulo aqui só quando ela não diz.
  const jaDito = t.estado === "terminado" && (o.estado === "entregue" || o.estado === "resolvida") && !o.atividade;
  return `<section class="tk-objetivo" aria-label="Objetivo da tarefa"><span class="tk-objetivo-estado" data-estado="${esc(o.estado)}">${jaDito ? "" : esc(rotuloDoObjetivo(o))}</span><div class="tk-objetivo-acoes" role="group" aria-label="Ações da tarefa">${acoes.join("")}</div></section>`;
}

/**
 * Paper 4l: as duas saídas da tarefa parada, acima do campo. ADR-192 (emenda 5): com Tarefa ligada, "Encerrar a tarefa"
 * sai — ele resolvia a Tarefa, o mesmo que o "Marcar como resolvida" do bloco do objetivo logo abaixo.
 */
export function htmlSaidaDaParada(id: string, comObjetivo = false): string {
  const encerrar = comObjetivo ? "" : `<button type="button" class="tk-saida-bt" data-act="encerrar-tarefa" data-id="${esc(id)}">Encerrar a tarefa</button>`;
  return `<div class="tk-saida" role="group" aria-label="A tarefa parou"><button type="button" class="tk-saida-bt" data-act="continuar-tarefa" data-id="${esc(id)}">Continuar de onde parou</button>${encerrar}</div>`;
}

/** O texto que o "Continuar de onde parou" manda à tarefa (é uma fala da pessoa: aparece na conversa dela). */
export const TEXTO_CONTINUAR = "Continue de onde parou.";

const capitalizar = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

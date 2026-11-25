import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { IdDesvio, PayloadDesvio } from "../contracts/desvio.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { MotivoRecomeco, Turno } from "../contracts/turno.ts";
import { cartaoDoDesvio, decidirRecuperacao, IA_SEM_NOME, linhaDaRecuperacao, type NomesDoDesvio } from "../domain/desvios-da-conversa.ts";
import { nomeDaIa as nomeCurto } from "../domain/espera-da-cota.ts";
import { harnessFixado } from "../domain/harness.ts";
import { iaDoModelo } from "../domain/ia-do-modelo.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { adiarFala } from "./adiar-fala.ts";
import { registrarRelato } from "./registrar-relato.ts";
import type { Deps } from "./tipos.ts";

/**
 * Lote B das Jornadas da IA (definido em 2026-11-22): o desvio de uma mensagem a um bot, na CONVERSA, executado pela
 * tabela única (src/domain/desvios-da-conversa.ts). O assentamento reconhece o desvio e chama aqui; aqui se decide se o
 * nod tenta de novo sozinho (na mesma conta, depois de uma espera, ou noutra IA) com uma linha discreta, ou para com o
 * cartão do motivo e dos botões. O fundo (rotina, task, colega) segue as regras dele (espera-no-fundo.ts).
 *
 * Os desvios de conta e de limite (2, 3, 4, 8) passam primeiro pelos caminhos da lista de contas (ADR-101/102), que trocam
 * de conta; este módulo cobre o que sobra deles e os desvios sem conta (1, 5, 9, 10, 11).
 */

/**
 * definido em 2026-11-22 (lote B): quanto a mensagem espera uma conta (login vencido, sem acesso) antes de tentar de novo
 * sozinha. O normal é ela sair antes, quando a pessoa entra de novo; 2 h é o teto para a resposta não chegar fora de hora.
 */
export const ESPERA_POR_UMA_CONTA_MS = 2 * 3_600_000;

/** O motivo de recomeço com que cada repetição na mesma conta nasce (conta as vezes por desvio; a web marca "recomeçou"). */
const RECOMECO_DO_DESVIO: Partial<Record<IdDesvio, MotivoRecomeco>> = {
  sessao_sumiu: "sessao_recusada",
  instavel: "instavel",
  erro_desconhecido: "erro_repetido",
  nod_atualizou: "nod_atualizou",
};

export type EntradaDesvioNaConversa = {
  desvio: IdDesvio;
  turno: Turno;
  executor: Executor;
  /** A IA que rodou o turno e a outra pronta para a pessoa (a ponte sabe), se houver. */
  harness: IdHarness | null;
  outraIa: IdHarness | null;
  /** As IAs prontas em cada máquina viva da pessoa (o "Rodar no <outra> desta vez" do cartão). */
  prontosPorMaquina?: Readonly<Record<string, readonly IdHarness[]>> | null;
  machineId: string;
  motivoInterrupcao: MotivoInterrupcao | null;
  motivoFalha: MotivoFalha | null;
  /** O texto do erro do fornecedor, já redigido pelo driver ("Ver o erro" no cartão). */
  erroCru?: string | null;
  autoria: Autoria;
  agora: number;
  custoUsd: number | null;
  /** O limite: a hora real em que passa (null = o fornecedor não disse) e quando a mensagem tenta de novo sozinha. */
  ate?: number | null;
  acordarEm?: number;
  /** Quem chama já emitiu o `turno_interrompido` e marcou as falas parciais (o caminho da lista de contas). */
  jaInterrompido?: boolean;
};

const nomeDaIa = (ia: IdHarness | null): string => (ia ? nomeCurto(ia) : IA_SEM_NOME);

/** null = este desvio não se trata aqui (não é conversa, ou é um desvio que outro caminho cobre): o aviso de sempre. */
export async function aposDesvioNaConversa(deps: Deps, p: EntradaDesvioNaConversa): Promise<RuntimeEvent[] | null> {
  const { turno, desvio, autoria, agora } = p;
  if (turno.origem !== "conversa" || turno.trabalhoId) return null;
  const recomeco = RECOMECO_DO_DESVIO[desvio] ?? null;
  // As repetições desta mensagem por este desvio; o próprio turno, se já é uma delas, conta mesmo sem a mensagem de origem.
  const repetidas = recomeco ? Math.max(await deps.repos.turnos.repeticoesDaMensagem(turno.mensagemOrigemId, recomeco), turno.motivoRecomeco === recomeco ? 1 : 0) : 0;
  const botFixo = harnessFixado(turno.harness, turno.modelo) !== null;
  // A outra IA: o botão "Responder com o <outra> desta vez" a oferece sempre (vale só para esta mensagem); a troca
  // AUTOMÁTICA, só com o bot no Automático (regra 5).
  const outraParaOBotao = p.outraIa && p.outraIa !== p.harness ? p.outraIa : null;
  const outraIa = !botFixo ? outraParaOBotao : null;
  const decisao = decidirRecuperacao(desvio, { tentativas: turno.reenvios, repetidasPorEste: repetidas, pararSolicitado: turno.pararSolicitadoEm !== null, proximaConta: false, outraIa: outraIa !== null });
  const nomes = await nomesDoDesvio(deps, { turno, harness: p.harness, outraIa: outraParaOBotao, machineId: p.machineId, prontosPorMaquina: p.prontosPorMaquina ?? null, botFixo });
  const events: RuntimeEvent[] = p.jaInterrompido ? [] : [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, desvio, decisao: decisao.tipo === "repetir" ? decisao.onde : decisao.forma, custo_usd: p.custoUsd } }),
  ];
  if (!p.jaInterrompido) await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const linhaOuCartao = async (payload: PayloadDesvio): Promise<string | null> => {
    const texto = payload.forma === "linha" ? payload.texto : `${payload.titulo}. ${payload.texto}`;
    const m = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto, payload, confianca: "confiavel" });
    if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: m.id, kind: "sistema" } }));
    return m?.id ?? null;
  };

  if (decisao.tipo === "repetir") {
    // A sessão sumida sai da conversa antes da repetição: o plano novo vai sem --resume, com o histórico (ADR-107).
    if (desvio === "sessao_sumiu") await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, null);
    const vez = repetidas + 1;
    await linhaOuCartao(linhaDaRecuperacao(desvio, decisao.onde, nomes, { agora, esperaMs: decisao.esperaMs, tentativa: vez }));
    const para = decisao.onde === "outra_ia" ? outraIa : null;
    const novo = await deps.repos.turnos.enfileirar({
      conversaId: turno.conversaId,
      agenteId: turno.agenteId,
      origem: "conversa",
      prazoEm: turno.prazoEm,
      profundidade: turno.profundidade,
      entradaTexto: turno.entradaTexto,
      mensagemOrigemId: turno.mensagemOrigemId,
      entradaAnexos: turno.entradaAnexos,
      entradaConfianca: turno.entradaConfianca,
      // Noutra IA: fixo nela, só nesta repetição (o bot não muda; NOD-268).
      modelo: para ? (iaDoModelo(turno.modelo) === para ? turno.modelo : "auto") : turno.modelo,
      harness: para ?? turno.harness,
      reenvios: turno.reenvios + 1,
      executor: p.executor,
      trabalhoId: null,
      contaminadoDe: turno.id,
      ...(decisao.esperaMs > 0 ? { acordarEm: agora + decisao.esperaMs } : {}),
    });
    if (novo && recomeco && decisao.onde === "mesma_conta") await deps.repos.turnos.registrarMotivoRecomeco(novo.id, recomeco);
    if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id, ...(decisao.esperaMs > 0 ? { acordar_em: agora + decisao.esperaMs } : {}) } }));
    log("info", "desvio_recuperado", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, desvio, onde: decisao.onde, espera_ms: decisao.esperaMs, reenvios: turno.reenvios + 1 });
    return events;
  }

  // A mensagem espera (regra 1): uma cópia dela fica na fila e sai sozinha assim que uma conta da IA ficar pronta
  // (contas-ia.ts acorda a espera) — ou, sem ninguém entrar, na hora marcada, quando o teto da mensagem decide de novo.
  let turnoEsperandoId: string | null = null;
  if (decisao.forma === "espera") {
    const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm: p.acordarEm ?? agora + ESPERA_POR_UMA_CONTA_MS, autoria, agora, texto: null, causa: desvio });
    // QA r227: a fala que já esperou (ou que a pessoa mandou parar) não espera de novo — sem cópia na fila, o cartão que
    // promete "a mensagem sai em seguida" mentiria (a pessoa entra e nada sai). Vale o aviso de sempre (contrato do adiarFala).
    if (!adiada) {
      log("aviso", "desvio_sem_espera", { turno_id: turno.id, desvio, reenvios: turno.reenvios });
      return null;
    }
    events.push(...adiada);
    turnoEsperandoId = adiada?.find((e) => e.kind === "turno_criado")?.turnoId ?? null;
  }
  // Parou: o cartão. O erro desconhecido que se repetiu vai sozinho para o time (regra 8), anexando só o cartão.
  const relatar = desvio === "erro_desconhecido" && repetidas > 0;
  const contaId = await deps.repos.turnos.contaDoTurno(turno.id).catch(() => null);
  const cartao = cartaoDoDesvio(desvio, nomes, { agora, ate: p.ate ?? null, turnoId: turno.id, turnoEsperandoId, mensagemId: turno.mensagemOrigemId ?? null, contaId, maquinaId: p.machineId, ia: p.harness, outraIaId: outraParaOBotao, relatado: relatar, erro: p.erroCru ?? null });
  const id = await linhaOuCartao(cartao);
  if (relatar && id) {
    const r = await registrarRelato(deps, { mensagemId: id, categoria: "travou_ou_parou", alcance: "mensagem", texto: "Relato automático do nod: o mesmo erro desconhecido duas vezes seguidas (lote B, desvio 10)." }).catch(() => null);
    if (r?.events?.length) events.push(...r.events);
  }
  log("aviso", "desvio_parou", { turno_id: turno.id, desvio, forma: decisao.forma, reenvios: turno.reenvios, relatado: relatar });
  return events;
}

async function nomesDoDesvio(deps: Deps, p: { turno: Turno; harness: IdHarness | null; outraIa: IdHarness | null; machineId: string; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>> | null; botFixo: boolean }): Promise<NomesDoDesvio> {
  const [agente, maquina] = await Promise.all([deps.repos.agentes.buscar(p.turno.agenteId), deps.repos.maquinaTokens.identificar(p.machineId).catch(() => null)]);
  // Outra máquina viva com a IA do turno pronta (no Automático, qualquer IA): o "Rodar no <outra> desta vez" do cartão.
  const outraId = Object.entries(p.prontosPorMaquina ?? {}).find(([id, ias]) => id !== p.machineId && ias.length > 0 && (!p.botFixo || !p.harness || ias.includes(p.harness)))?.[0] ?? null;
  const outra = outraId ? await deps.repos.maquinaTokens.identificar(outraId).catch(() => null) : null;
  const contaId = await deps.repos.turnos.contaDoTurno(p.turno.id).catch(() => null);
  const conta = contaId ? await deps.repos.contasIa.buscar(contaId).catch(() => null) : null;
  const ia = nomeDaIa(p.harness);
  return {
    bot: agente?.nome ?? "O bot",
    ia,
    conta: conta?.apelido ? `${ia} · ${conta.apelido}` : null,
    outraIa: p.outraIa ? nomeDaIa(p.outraIa) : null,
    maquina: maquina?.nome ?? null,
    outraMaquina: outraId && outra ? { id: outraId, nome: outra.nome } : null,
  };
}

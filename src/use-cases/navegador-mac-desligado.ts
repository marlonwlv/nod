import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PayloadNavegadorPergunta, RespostaMacDesligado } from "../contracts/navegador-do-bot.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { cartaoDaPergunta, horaNoFuso, macCostumaEstarDesligado, sujeitoDoBot, textoDaHora } from "../domain/navegador-lugar.ts";
import { autoriaPessoa, evento as eventoDoEscopo, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { entradaDoLugar, mudarLugarDoNavegador } from "./navegador-lugar.ts";
import type { Deps } from "./tipos.ts";

/**
 * Os cartões do Mac desligado na conversa do bot (ADR-190; Paper M2/J1, M3/K1, J0):
 * - a PERGUNTA "Às 3h seu Mac costuma estar desligado" vem uma vez por bot, enquanto a pessoa não respondeu: quando ela
 *   cria uma rotina para uma hora em que o Mac costuma estar desligado, ou quando uma rotina vai usar o navegador com o
 *   Mac desligado agora;
 * - o pedido pela conversa com o Mac desligado não fica mudo: "Seu Mac está desligado" com [Fazer agora] (continua sem o
 *   Mac e retoma o turno) e [Quando o Mac ligar] (o turno continua quando o app do Mac voltar a puxar o navegador).
 * Só para quem tem o app num computador (sem ele, o navegador já roda sempre fora do Mac) e com o navegador no servidor.
 */

type D = Pick<Deps, "repos" | "escopo" | "agora" | "services">;

/** Grava o cartão como linha `sistema` na conversa própria do bot. Sem conversa: nada. */
async function gravarCartao(d: D, agenteId: string, texto: string, payload: PayloadNavegadorPergunta): Promise<boolean> {
  const conversa = await d.repos.conversas.buscarPropriaDoAgente(agenteId);
  if (!conversa) return false;
  const autoria = autoriaAgente(agenteId, d.escopo.pessoaId);
  const m = await d.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "sistema", texto, payload, confianca: "confiavel" });
  if (m) await d.repos.events.gravarComOutbox([evento(d, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: conversa.id, turnoId: null })]);
  return m !== null;
}

/** A pergunta M2/J1, se ainda cabe: o bot da pessoa, com navegador, ela tem o app, não respondeu nem foi perguntada. */
async function perguntar(d: D, agenteId: string, hora: string, extra: { rotinaId: string | null; turnoId: string | null }): Promise<boolean> {
  if (d.services.navegadores?.disponivel() !== true) return false;
  const agente = await d.repos.agentes.buscar(agenteId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) return false;
  const { entrada, preferencias } = await entradaDoLugar(d, agenteId, []);
  if (!entrada.temApp || entrada.continuaSemMac || preferencias?.respondidoEm != null || preferencias?.perguntadoEm != null) return false;
  const c = cartaoDaPergunta(hora, entrada.nomeDoAparelho, sujeitoDoBot(agente.nome));
  const ok = await gravarCartao(d, agenteId, c.titulo, { kind: "navegador_pergunta", agenteId, pergunta: "continuar_sem_mac", hora, nomeDoAparelho: entrada.nomeDoAparelho, turnoId: extra.turnoId, rotinaId: extra.rotinaId, em: d.agora() });
  if (ok) await d.repos.navegadorPreferencias.gravar(agenteId, { perguntadoEm: d.agora() }, d.agora());
  return ok;
}

/** (a) A rotina nova de um bot com navegador roda numa hora em que o Mac costuma estar desligado: pergunta uma vez. */
export async function perguntarNaRotina(d: D, rotina: Pick<Rotina, "id" | "agenteId" | "proximaExecucao" | "fusoIana"> & { gatilho?: string | null }): Promise<boolean> {
  if (rotina.gatilho === "webhook") return false;
  const t = horaNoFuso(rotina.proximaExecucao, rotina.fusoIana);
  if (!macCostumaEstarDesligado(t.h)) return false;
  return perguntar(d, rotina.agenteId, textoDaHora(t), { rotinaId: rotina.id, turnoId: null });
}

/**
 * O navegador espera o Mac (interruptor desligado e Mac fora): o cartão certo para o tipo de turno e a instrução que o bot
 * lê no lugar da padrão. (b) Turno de rotina: a pergunta M2/J1 (se ainda cabe). Pedido pela conversa: K1. null = nada
 * novo (o bot lê a instrução de sempre).
 */
export async function cartaoDaEspera(d: D, plano: Pick<PlanoTurno, "agenteId" | "turnoId" | "modoTurno">): Promise<string | null> {
  if (plano.modoTurno === "rotina") {
    const t = horaNoFuso(d.agora());
    if (!(await perguntar(d, plano.agenteId, textoDaHora(t), { rotinaId: null, turnoId: plano.turnoId }))) return null;
    return "O navegador roda no Mac da pessoa, e ele está desligado agora. Nada foi executado. A conversa já mostra à pessoa a pergunta se você pode continuar com o Mac desligado: não repita a pergunta. Siga com o que dá sem o navegador; se não der, encerre o turno com uma frase curta dizendo o que ficou para depois.";
  }
  if (plano.modoTurno !== "conversa" || d.services.navegadores?.disponivel() !== true) return null;
  const agente = await d.repos.agentes.buscar(plano.agenteId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) return null;
  const { entrada } = await entradaDoLugar(d, plano.agenteId, []);
  if (!entrada.temApp) return null;
  const ok = await gravarCartao(d, plano.agenteId, `${entrada.nomeDoAparelho.charAt(0).toUpperCase()}${entrada.nomeDoAparelho.slice(1)} está desligado`, {
    kind: "navegador_pergunta", agenteId: plano.agenteId, pergunta: "mac_desligado", hora: textoDaHora(horaNoFuso(d.agora())), nomeDoAparelho: entrada.nomeDoAparelho, turnoId: plano.turnoId, rotinaId: null, em: d.agora(),
  });
  if (!ok) return null;
  return "O navegador roda no Mac da pessoa, e ele está desligado agora. Nada foi executado. A conversa já mostra à pessoa o cartão \"Seu Mac está desligado\" com [Fazer agora] e [Quando o Mac ligar]; o pedido continua sozinho quando ela escolher. Não repita o cartão nem explique de novo: encerre o turno sem fala, ou com uma frase bem curta se precisar dizer algo que o cartão não diz.";
}

/** A nota que abre o turno retomado (o pedido continua de onde parou). */
const NOTA_AGORA = "Nota do Nod: a pessoa deixou você continuar com o Mac desligado (\"Fazer agora\"). O navegador roda fora do Mac agora. Faça o que ela pediu na mensagem anterior; nada foi executado antes.";
const NOTA_AO_LIGAR = "Nota do Nod: o Mac da pessoa ligou (ela pediu \"Quando o Mac ligar\"). O navegador roda nele agora. Faça o que ela pediu; nada foi executado antes.";

async function retomar(d: D, turnoId: string, nota: string): Promise<{ turnoId: string | null; events: RuntimeEvent[] }> {
  const original = await d.repos.turnos.buscar(turnoId);
  if (!original || original.motivoInterrupcao === "parado_pela_pessoa") return { turnoId: null, events: [] };
  const conversa = await d.repos.conversas.buscarPropriaDoAgente(original.agenteId);
  if ((await d.repos.paradas.ativa(d.escopo.pessoaId, null)) !== false || (conversa && (await d.repos.paradas.ativa(d.escopo.pessoaId, conversa.id)) !== false)) return { turnoId: null, events: [] };
  const agora = d.agora();
  const { turno, nova } = await enfileirarRetomada(d, { original, prazoEm: agora + PRAZO_DECISAO_PADRAO_MS, entradaTexto: nota, reenvios: original.reenvios + 1 });
  return {
    turnoId: turno?.id ?? null,
    events: nova && turno ? [eventoDoEscopo(d.escopo, { kind: "turno_criado", autoria: autoriaPessoa(d.escopo), agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id } })] : [],
  };
}

/**
 * POST /agentes/:id/navegador/mac-desligado (K1, ação `navegador.mac_desligado`). "agora": o bot continua com o Mac
 * desligado (a linha "Agora a Ada continua com o Mac desligado · Desfazer") e o pedido continua já. "ao_ligar": o pedido
 * espera o app do Mac voltar a puxar o navegador (`retomarAoLigarOMac`).
 */
export async function responderMacDesligado(d: D, agenteId: string, turnoId: string, r: RespostaMacDesligado): Promise<{ turnoId: string | null; events: RuntimeEvent[] }> {
  const agente = await d.repos.agentes.buscar(agenteId);
  if (!agente || agente.ownerId !== d.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  const turno = await d.repos.turnos.buscar(turnoId);
  if (!turno || turno.agenteId !== agenteId) throw new ErroDeDominio("nao_encontrado");
  if (r === "ao_ligar") {
    await d.repos.navegadorPreferencias.gravar(agenteId, { retomarTurnoId: turnoId }, d.agora());
    return { turnoId: null, events: [] };
  }
  await mudarLugarDoNavegador(d, agenteId, { continuaSemMac: true });
  await d.repos.navegadorPreferencias.gravar(agenteId, { retomarTurnoId: null }, d.agora());
  return retomar(d, turnoId, NOTA_AGORA);
}

/**
 * O app do Mac (ou PC) da pessoa voltou a puxar o navegador: cada pedido que esperava ("Quando o Mac ligar") continua, uma
 * vez. Devolve os eventos (turno_criado) para quem compõe gravar.
 */
export async function retomarAoLigarOMac(d: D): Promise<RuntimeEvent[]> {
  const esperando = (await d.repos.navegadorPreferencias.daPessoa()).filter((p) => p.retomarTurnoId !== null);
  const events: RuntimeEvent[] = [];
  for (const p of esperando) {
    const turnoId = p.retomarTurnoId!;
    await d.repos.navegadorPreferencias.gravar(p.agenteId, { retomarTurnoId: null }, d.agora());
    events.push(...(await retomar(d, turnoId, NOTA_AO_LIGAR)).events);
  }
  return events;
}

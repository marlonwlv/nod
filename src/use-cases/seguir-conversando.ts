import type { PayloadPedidoDispensado } from "../contracts/cartao-encolhido.ts";
import type { Proposta } from "../contracts/conversa.ts";
import { TIPOS_DISPENSADOS_AO_SEGUIR, type Decisao, type TipoDecisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ehPedidoDoNavegador, fraseCurtaDoPedido, linhaDoPedidoDispensado } from "../domain/pedido-dispensado.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { depoisDeDispensar } from "./dispensar-decisao.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import { recusarRotinasDoCard } from "./recusar-proposta.ts";
import type { Deps } from "./tipos.ts";

/** O motivo gravado no payload `pedido_dispensado`: a pessoa seguiu conversando (ADR-191). */
export const MOTIVO_SEGUIU_CONVERSANDO = "seguiu_conversando" as const;

const DISPENSADOS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(TIPOS_DISPENSADOS_AO_SEGUIR);

export type PedidoDispensado = { decisaoId: string; tipo: TipoDecisao; mensagemId: string | null };

/**
 * A mensagem nova da pessoa fecha os pedidos ABERTOS da conversa criados antes dela (definido em 2026-11-20, ADR-191,
 * pedido do dono; referência: o app de referência marca "Dismissed" o cartão esquecido quando a pessoa manda mensagem nova).
 * Antes, o cartão que esperava um clique (o login do computador, "Conectar o Google Drive", uma proposta, o "Retomar")
 * ficava aberto até vencer, e o bot, sem saber que a pessoa seguiu, às vezes pedia de novo.
 *
 * Cada um fecha como 'dispensada' com `por` = quem mandou e `antes` = o estado de antes: a ADR-007 continua valendo — o
 * sistema nunca some com nada sozinho; quem dispensa é a pessoa, ao seguir, e o registro fica. O efeito é o do ×
 * (`depoisDeDispensar`: as gêmeas, a janela da rotina, o computador devolvido ao bot), sem a retomada da ajuda: a mensagem
 * já cria o turno dela. A proposta de mesmo id pendente é recusada junto (o cartão de perfil leva as rotinas dele). O card
 * de conexão (acesso sem decisão) sai como proposta recusada.
 *
 * Ficam de fora: as perguntas que se respondem com texto (a mensagem é a resposta, EMENDA 16; a web as manda pela rota de
 * responder), o gate da rotina, o CSV das decisões, a aprovação (ADR-184 já a substitui por regra, antes daqui), a espera de
 * uma tarefa do quadro (`tarefaId`), o pedido dirigido a outra pessoa (decisora ≠ quem mandou), a decisão em revisão e a
 * vencida (as listas só trazem pendente/reaberta), e o pedido de um turno ainda vivo — esse turno lê a mensagem nova na
 * sessão (ADR-185) e decide o que fazer com o próprio pedido.
 *
 * Para cada um, uma mensagem `sistema` com payload `pedido_dispensado`: a web desenha a linha cinza no lugar do cartão e o
 * histórico do modelo lê o texto dela (a linha fixa de linhaDoPedidoDispensado). Roda na transação do envio, depois de
 * gravar a mensagem da pessoa e ANTES do turno novo: `criado_em` é clock_timestamp(), então a linha entra no "desde a sua
 * última vez" (sessão retomada) ou no histórico do turno que a mensagem cria.
 */
export async function dispensarAoSeguirConversando(deps: Pick<Deps, "repos" | "escopo" | "agora" | "tx" | "aposCommit">, input: { conversaId: string; antesDe: number }): Promise<{ dispensados: PedidoDispensado[]; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const pessoa = deps.escopo.pessoaId;
  const [abertas, propostas, vivos] = await Promise.all([
    deps.repos.decisoes.pendentesDaConversa(input.conversaId),
    deps.repos.propostas.pendentesDaConversa(input.conversaId),
    deps.repos.turnos.vivosDaConversa(input.conversaId),
  ]);
  const turnosVivos = new Set(vivos.map((t) => t.id));
  const doTurnoVivo = (turnoId: string | null | undefined) => !!turnoId && turnosVivos.has(turnoId);
  const candidatas = abertas.filter((d) => DISPENSADOS.has(d.tipo) && d.ownerId === pessoa && d.decisorId === pessoa && d.tarefaId === undefined
    && (d.estado === "pendente" || d.estado === "reaberta") && Date.parse(d.criadoEm) <= input.antesDe && !doTurnoVivo(d.turnoId));
  const { ajudas, doNavegador } = await ajudasDoComputador(deps, candidatas);
  const events: RuntimeEvent[] = [];
  const dispensados: PedidoDispensado[] = [];
  const feitas = new Set<string>();

  for (const aberta of candidatas) {
    // 'pergunta' só é do escopo quando o balão diz que é a ajuda do computador (não se responde com texto).
    if (aberta.tipo === "pergunta" && !ajudas.has(aberta.id)) continue;
    if (aberta.estado !== "pendente" && aberta.estado !== "reaberta") continue;
    // QA r175: a proposta de mesmo id é travada ANTES da decisão e sem esperar — a ordem de quem decide o card (proposta →
    // decisão); se alguém a decide agora (outra aba, o Enter logo depois do clique), o pedido fica para esse clique.
    if (propostas.some((p) => p.id === aberta.id) && !(await deps.repos.propostas.travarSeLivre(aberta.id))) continue;
    const decisao = await deps.repos.decisoes.dispensarAoSeguir(aberta.id, { por: pessoa, agora, antes: aberta.estado });
    if (!decisao) continue;
    feitas.add(decisao.id);
    const proposta = propostas.find((p) => p.id === decisao.id) ?? null;
    if (proposta) await recusarAoSeguir(deps, proposta);
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria: autoriaPessoa(deps.escopo), agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, dispensada: true, motivo: MOTIVO_SEGUIU_CONVERSANDO } }));
    if (proposta) events.push(propostaRecusada(deps, proposta, agora));
    events.push(...(await depoisDeDispensar(deps, { decisao, semRetomada: true })).events);
    const conector = proposta?.payload.kind === "acesso" ? proposta.payload.conector : undefined;
    const recibo = await reciboDoDispensado(deps, { decisao, conector, conectar: false, ajuda: ajudas.has(decisao.id) });
    events.push(...recibo.events);
    dispensados.push({ decisaoId: decisao.id, tipo: decisao.tipo, mensagemId: recibo.mensagemId });
  }
  // O navegador do bot guarda o pedido na vista (memória do portão): depois do commit, ela solta o pedido e o controle.
  const doNavegadorFeitos = [...feitas].filter((id) => doNavegador.has(id));
  if (doNavegadorFeitos.length) deps.aposCommit?.({ tipo: "pedidos_dispensados", decisaoIds: doNavegadorFeitos });

  // O card de conexão ("Conectar o Google Drive para a Frida") é só a proposta: sem decisão, sai recusado.
  for (const p of propostas) {
    if (feitas.has(p.id) || p.payload.kind !== "acesso" || p.payload.conectar !== true || p.criadoEm > input.antesDe || doTurnoVivo(p.payload.turnoId)) continue;
    if (!(await deps.repos.propostas.travarSeLivre(p.id))) continue;
    const recusada = await deps.repos.propostas.decidir(p.id, "recusada");
    if (!recusada) continue;
    events.push(propostaRecusada(deps, recusada, agora));
    // O nome do app quando ele já está registrado; senão o slug (a web troca pelo nome do catálogo).
    const nome = (await deps.repos.conectores.buscarPorSlug(p.payload.conector))?.nome ?? p.payload.conector;
    const decisao: Pick<Decisao, "id" | "tipo" | "frase" | "conversaId" | "turnoId" | "agenteId"> = { id: p.id, tipo: "acesso", frase: `Conectar o ${nome}`, conversaId: p.conversaId, turnoId: p.payload.turnoId ?? null, agenteId: p.agenteId };
    const recibo = await reciboDoDispensado(deps, { decisao, conector: p.payload.conector, conectar: true, ajuda: false });
    events.push(...recibo.events);
    dispensados.push({ decisaoId: p.id, tipo: "acesso", mensagemId: recibo.mensagemId });
  }
  return { dispensados, events };
}

/**
 * As perguntas abertas que são o pedido de ajuda do computador (`ajudaDoComputador` no payload) ou um pedido do navegador
 * do bot (login, código, ajuda: reconhecidos pela fala, ehPedidoDoNavegador).
 */
async function ajudasDoComputador(deps: Pick<Deps, "repos">, decisoes: readonly Decisao[]): Promise<{ ajudas: ReadonlySet<string>; doNavegador: ReadonlySet<string> }> {
  const perguntas = decisoes.filter((d) => d.tipo === "pergunta" && d.turnoId !== null);
  if (perguntas.length === 0) return { ajudas: new Set(), doNavegador: new Set() };
  const baloes = (await deps.repos.mensagens.pedidosAPessoaDasDecisoes(perguntas.flatMap((d) => (d.turnoId ? [d.turnoId] : []))))
    .flatMap((m) => (m.payload?.kind === "pedido_a_pessoa" ? [{ decisaoId: m.payload.decisaoId, computador: m.payload.ajudaDoComputador === true, navegador: ehPedidoDoNavegador(m.texto) }] : []));
  const doNavegador = new Set(baloes.filter((b) => b.navegador).map((b) => b.decisaoId));
  return { ajudas: new Set(baloes.filter((b) => b.computador || b.navegador).map((b) => b.decisaoId)), doNavegador };
}

/**
 * A proposta de mesmo id sai recusada. O cartão de perfil leva as rotinas dele (recusarRotinasDoCard), mas a
 * reconfiguração (/configurar) segue aberta: a mensagem nova é a pessoa conversando sobre o perfil, e o bot propõe de novo.
 * A frase genérica de recusa ("proposta-recusada") não é gravada: o recibo é a linha do pedido dispensado.
 */
async function recusarAoSeguir(deps: Pick<Deps, "repos" | "escopo" | "agora">, proposta: Proposta): Promise<void> {
  if (proposta.estado !== "pendente") return;
  const recusada = await deps.repos.propostas.decidir(proposta.id, "recusada");
  if (recusada?.payload.kind === "perfil") await recusarRotinasDoCard(deps, recusada.payload);
}

/** A web relê as propostas da conversa com o mesmo evento da recusa pelo cartão (recusar-proposta.ts). */
function propostaRecusada(deps: Pick<Deps, "escopo">, proposta: Proposta, agora: number): RuntimeEvent {
  return evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: proposta.conversaId, dados: { agente_id: proposta.agenteId, acao: "proposta_recusada", proposta_id: proposta.id, kind: proposta.kind, motivo: MOTIVO_SEGUIU_CONVERSANDO } });
}

async function reciboDoDispensado(
  deps: Pick<Deps, "repos" | "escopo" | "agora">,
  p: { decisao: Pick<Decisao, "id" | "tipo" | "frase" | "conversaId" | "turnoId" | "agenteId">; conector: string | undefined; conectar: boolean; ajuda: boolean },
): Promise<{ mensagemId: string | null; events: RuntimeEvent[] }> {
  const frase = fraseCurtaDoPedido(p.decisao.frase);
  const payload: PayloadPedidoDispensado = {
    kind: "pedido_dispensado", decisaoId: p.decisao.id, tipo: p.decisao.tipo, frase, motivo: MOTIVO_SEGUIU_CONVERSANDO, turnoId: p.decisao.turnoId, agenteId: p.decisao.agenteId,
    ...(p.conector ? { conector: p.conector } : {}), ...(p.conectar ? { conectar: true as const } : {}), ...(p.ajuda ? { ajuda: true as const } : {}),
  };
  const autoria = autoriaDaPessoa(deps.escopo);
  const m = await deps.repos.mensagens.criar({ conversaId: p.decisao.conversaId, autoria, kind: "sistema", texto: linhaDoPedidoDispensado(frase), payload, confianca: "confiavel" });
  if (!m) return { mensagemId: null, events: [] };
  return { mensagemId: m.id, events: [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: p.decisao.conversaId, dados: { mensagem_id: m.id, kind: "sistema", decisao_id: p.decisao.id } })] };
}

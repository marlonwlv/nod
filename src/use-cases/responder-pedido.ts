import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ArgsResponderPedido, ErroResponderPedido, ResultadoResponderPedido } from "../contracts/ferramentas-responder-pedido.ts";
import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { evento } from "./autoria-evento.ts";
import { entregarRespostaDeclarada, type SaidaEntregaPeer } from "./entregar-resposta-peer.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { emSavepoint } from "./savepoint.ts";
import type { Deps } from "./tipos.ts";

/**
 * responder_pedido (definido em 2026-10-15, NOD-262, emenda à ADR-047): o bot fecha da conversa um pedido de colega que
 * a pessoa já resolveu com ele. Cercas:
 * 1. o turno que chama é do próprio bot e é a pessoa falando com ele (conversa ou sala) — rotina, task, ligação e o
 *    próprio pedido de colega ficam de fora (o turno do pedido responde ao assentar, como sempre);
 * 2. o pedido é um turno `delegacao` DESTE bot e ainda está na fila (`pendente`): o que já rodou ou está rodando
 *    responde sozinho, e a recusa não muda nada no banco;
 * 3. tirar da fila e entregar andam juntos (SAVEPOINT): se a entrega não sai (resultado já entregue), o pedido volta à
 *    fila como estava. Quem pediu excluído é a exceção — não há a quem entregar, e o pedido sai da fila mesmo assim.
 *    Quem pediu parado pela pessoa (NOD-256, F1.1) conta como entregue: a resposta fica como peer_ask, sem continuação.
 * A resposta vai pelo caminho de sempre (entregar: a peer_ask e a continuação de quem pediu). Se o turno que chama leu
 * conteúdo de fora (ADR-062), o pedido herda a marca e a continuação de quem pediu também.
 */

const RECUSA: Record<Exclude<ErroResponderPedido, "remetente_excluido">, string> = {
  fora_da_conversa: "responder_pedido só vale na conversa ou na sala com a pessoa. Nada mudou.",
  pedido_nao_encontrado: "Esse tarefa_id não é um pedido de colega para você. Use um da lista de pedidos pendentes. Nada mudou.",
  ja_em_andamento: "Esse pedido já começou a rodar ou já foi respondido: o turno dele responde sozinho. Nada mudou.",
  pedido_fechado: "Esse pedido já foi fechado sem resposta (a pessoa desistiu da espera, parou o bot ou o prazo venceu) e quem pediu já foi avisado: ele não volta para a sua fila. Se a resposta ainda importa, diga isso à pessoa ou mande a quem pediu com pedir_a_bot. Nada mudou.",
};

/**
 * QA r181: o pedido que a pessoa fechou (Desistir da espera, Parar) ou que venceu o prazo saiu da fila sem resposta e
 * quem pediu já foi avisado — não é "já em andamento", que leva o bot a dizer à pessoa que o turno do pedido ainda vai
 * responder. As quedas (máquina, motor) ficam como estavam: o varredor ainda pode retomar o pedido.
 */
const FECHOS_SEM_RESPOSTA = new Set(["parado_pela_pessoa", "vencido"]);
function fechadoSemResposta(t: { estado: string; motivoInterrupcao?: string | null }): boolean {
  return t.estado === "interrompido" && FECHOS_SEM_RESPOSTA.has(t.motivoInterrupcao ?? "");
}

const MODOS_COM_A_PESSOA = new Set(["conversa", "sala"]);

class EntregaNaoSaiu extends Error {
  readonly ignorado: string;
  constructor(ignorado: string) {
    super(ignorado);
    this.ignorado = ignorado;
  }
}

function recusa(erro: Exclude<ErroResponderPedido, "remetente_excluido">): SaidaCasoDeUso<ResultadoResponderPedido> {
  return { data: { ok: false, erro, instrucao: RECUSA[erro] } };
}

export async function responderPedido(deps: Deps, input: ContextoFerramenta & ArgsResponderPedido): Promise<SaidaCasoDeUso<ResultadoResponderPedido>> {
  const chamador = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? chamador?.origem ?? null;
  if (!chamador || chamador.agenteId !== input.agenteId || !modo || !MODOS_COM_A_PESSOA.has(modo)) return recusa("fora_da_conversa");
  const pedido = await deps.repos.turnos.buscar(input.tarefa_id);
  if (!pedido || pedido.origem !== "delegacao" || pedido.agenteId !== input.agenteId) return recusa("pedido_nao_encontrado");
  if (pedido.estado !== "pendente") return recusa(fechadoSemResposta(pedido) ? "pedido_fechado" : "ja_em_andamento");

  const agora = deps.agora();
  let entrega: { data: SaidaEntregaPeer; events?: RuntimeEvent[] };
  try {
    entrega = await emSavepoint(deps, async () => {
      const absorvido = await deps.repos.turnos.absorverDelegacao(pedido.id, chamador.id);
      if (!absorvido) {
        // Saiu da fila entre a leitura e o UPDATE (o Desistir, o Parar ou o prazo chegaram antes): relê para dizer qual.
        const agoraNoBanco = await deps.repos.turnos.buscar(pedido.id);
        throw new EntregaNaoSaiu(agoraNoBanco && fechadoSemResposta(agoraNoBanco) ? "pedido_fechado" : "ja_em_andamento");
      }
      // ADR-062: a resposta sai do turno que chama; se ele leu algo de fora, a marca segue para quem pediu (entregar lê
      // a marca da cadeia do pedido).
      if (chamador.entradaConfianca !== "confiavel" || input.plano?.confiancaEntrada === "nao_confiavel" || (await deps.repos.turnos.contaminado(chamador.id))) {
        await deps.repos.turnos.contaminar(absorvido.id, agora);
      }
      const r = await entregarRespostaDeclarada(deps, { tarefa: absorvido, texto: input.texto });
      // NOD-256 (F1.1): quem pediu parado pela pessoa recebe a resposta como peer_ask, sem retomada — a entrega saiu.
      if ("ignorado" in r.data && r.data.ignorado !== "remetente_excluido" && r.data.ignorado !== "quem_pediu_parado") throw new EntregaNaoSaiu(r.data.ignorado);
      return r;
    });
  } catch (e) {
    if (e instanceof EntregaNaoSaiu) return recusa(e.ignorado === "nao_e_tarefa_peer" ? "pedido_nao_encontrado" : e.ignorado === "pedido_fechado" ? "pedido_fechado" : "ja_em_andamento");
    throw e;
  }
  const autoria = autoriaDoAgente(deps.escopo, chamador.agenteId, { decididoPor: "regra:responder_pedido" });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: pedido.conversaId, turnoId: pedido.id, dados: { motivo: "absorvido", absorvido_por: chamador.id } }),
    ...(entrega.events ?? []),
  ];
  if ("ignorado" in entrega.data && entrega.data.ignorado === "quem_pediu_parado") {
    return { data: { ok: true, instrucao: "Resposta registrada na conversa de quem pediu; o pedido saiu da sua fila. Quem pediu está parado pela pessoa e não segue sozinho. Siga a conversa com a pessoa." }, events };
  }
  if ("ignorado" in entrega.data) {
    return { data: { ok: false, erro: "remetente_excluido", instrucao: "Quem pediu foi excluído: o pedido saiu da sua fila e a resposta não tem a quem ir. Diga isso à pessoa, se importar." }, events };
  }
  return { data: { ok: true, instrucao: "Resposta entregue a quem pediu; o pedido saiu da sua fila. Siga a conversa com a pessoa." }, events };
}

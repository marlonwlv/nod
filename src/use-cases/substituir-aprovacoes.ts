import type { RuntimeEvent } from "../contracts/evento.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";
import type { Deps } from "./tipos.ts";

/**
 * A aprovação que a mensagem nova substituiu (definido em 2026-11-16, item 10 dos acessos devolvidos, rodada 2). Fecha
 * por regra (ADR-042), sem ninguém decidir: não é "negado" — a pessoa não respondeu ao pedido, falou outra coisa.
 */
export const REGRA_APROVACAO_SUBSTITUIDA = "regra:aprovacao_substituida" as const;

/**
 * Mensagem da pessoa com aprovação aberta na conversa própria: como no app de referência ("Asked again below") e no
 * bot-hq ("a new message supersedes whatever is waiting for approval"), a fala nova tira os pedidos abertos do caminho.
 * Antes, a mensagem entrava no turno parado no pedido e o bot só a lia depois do clique: três mensagens sem resposta.
 * Cada aprovação aberta fecha por regra e os itens saem desmarcados (nada roda; o hook lê `substituida` e diz ao modelo
 * que a pessoa mandou outra mensagem, em interno.ts). Pedido igual na mesma cadeia volta ao cartão (recusadoNaCadeia).
 * Só aprovação: pergunta e acesso têm caminho próprio. Na transação do envio, depois do insert da mensagem.
 */
export async function substituirAprovacoesAbertas(deps: Pick<Deps, "repos" | "escopo" | "agora">, conversaId: string): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const abertas = (await deps.repos.decisoes.pendentesDaConversa(conversaId)).filter((d) => d.tipo === "aprovacao");
  for (const aberta of abertas) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(aberta.id, { regra: REGRA_APROVACAO_SUBSTITUIDA, regraVersao: 1, agora });
    if (!fechada) continue;
    // Ninguém retoma o pedido substituído: o turno vivo lê `substituida` no hook e segue pela mensagem nova; o turno já
    // encerrado não ganha retomada no assentamento (aContinuarDoTurno pula o que já tem continuação).
    await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
    for (const item of await deps.repos.itensAprovacao.listar(fechada.id)) {
      if (item.selecionado) await deps.repos.itensAprovacao.marcar(item.id, { selecionado: false, agora });
    }
    const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: REGRA_APROVACAO_SUBSTITUIDA };
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_APROVACAO_SUBSTITUIDA } }));
    // O recibo na conversa ("Sem resposta · <o pedido>", web/telas/cartao-encolhido.ts), no lugar do cartão aberto.
    const itens = await deps.repos.itensAprovacao.listar(fechada.id);
    const recibo = await deps.repos.mensagens.criar({
      conversaId: fechada.conversaId,
      turnoId: fechada.turnoId,
      autoria: autoriaDaPessoa(deps.escopo),
      kind: "resultado_aprovacao",
      texto: "O pedido ficou sem resposta: a pessoa mandou outra mensagem antes de responder. Nada rodou.",
      payload: { kind: "resultado_aprovacao", decisaoId: fechada.id, frase: fechada.frase, itens: itens.map((i) => ({ idx: i.idx, desfecho: "retirado_pela_pessoa" as const, texto: i.textoFinal })), substituida: true },
      confianca: "confiavel",
    });
    if (recibo) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { mensagem_id: recibo.id, kind: "resultado_aprovacao", decisao_id: fechada.id, executados: 0, total: itens.length } }));
    // A task do turno que pediu relê o estado (como decidir faz): ela saiu de "esperando você".
    events.push(...(await sincronizarDasDecisoes(deps, [fechada])));
  }
  return events;
}

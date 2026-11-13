import type { Agente } from "../contracts/agente.ts";
import type { Executor } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * A4 (definido em 2026-11-12): o turno de apresentação. O bot recém-criado fala primeiro: um turno da conversa própria dele,
 * sem fala da pessoa (sem `mensagemOrigemId`), com a instrução abaixo. Ele se apresenta em poucas frases e pergunta por
 * onde começar num cartão de opções (`pedir_a_pessoa` com `opcoes`), escritas a partir do perfil dele. A resposta da
 * pessoa retoma o fio como qualquer pergunta.
 *
 * Substitui a linha de boas-vindas fixa ("Oi! Eu sou… Pode escolher uma opção") quando a tela pede (`apresentar`); sem o
 * pedido, nada muda. Custa um turno de IA: só a criação pela tela pede.
 */
export const INSTRUCAO_APRESENTACAO = "[nod] Turno de apresentação: você acabou de ser criado e fala primeiro, antes de a pessoa escrever. Diga quem você é e como pode ajudar, em uma ou duas frases curtas, a partir do seu perfil. Depois pergunte por onde começar com pedir_a_pessoa (tipo pergunta), com 2 a 4 opções de primeiro trabalho que combinem com o seu perfil, escritas como a pessoa responderia. Não comece trabalho nenhum, não chame outras ferramentas e não invente o que ela quer. Sem pedir_a_pessoa disponível, faça a pergunta no texto, com as opções numa linha.";

export const apresentarBot: CasoDeUso<{ agente: Agente; conversaId: string; executor?: Executor; prazoMs?: number }, { turnoId: string }> = async (deps, input) => {
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: input.conversaId,
    agenteId: input.agente.id,
    origem: "conversa",
    prazoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
    profundidade: 0,
    entradaTexto: INSTRUCAO_APRESENTACAO,
    entradaConfianca: "confiavel",
    modelo: input.agente.modelo,
    harness: input.agente.harness,
    executor,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno de apresentação não criado" });
  const autoria = autoriaPessoa(deps.escopo, executor);
  return {
    data: { turnoId: turno.id },
    events: [evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: input.conversaId, turnoId: turno.id, dados: { origem: "conversa", agente_id: input.agente.id, apresentacao: true } })],
  };
};

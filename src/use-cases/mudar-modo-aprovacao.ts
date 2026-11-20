import type { Agente, ModoAprovacao } from "../contracts/agente.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { descricaoDoModo, ehModoAprovacao, ROTULO_MODO } from "../domain/modo-aprovacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * O que cada modo passa a fazer, dito na linha da conversa: a mesma frase do menu, começando em minúscula. O Automático
 * com o revisor ligado diz o revisor (PR 4 dos modos de aprovação).
 */
function efeito(modo: ModoAprovacao, revisor: boolean): string {
  const d = descricaoDoModo(modo, revisor);
  return d.charAt(0).toLowerCase() + d.slice(1);
}

/**
 * A dona troca o modo de aprovação do bot (ADR-059), pelo chip do campo. Só a dona: o repositório filtra por
 * owner_id e devolve null para bot de equipe de outra pessoa. A troca vira linha na conversa do bot — é a
 * autoridade sob a qual as próximas ações vão sair sem clique, e a trilha precisa dizer desde quando.
 * Vale na próxima ação: quem decide lê o modo atual do agente; o que já espera a pessoa continua esperando.
 *
 * definido em 2026-10-18 (Fase 4, PR 2; emenda da ADR-059): ligar "Ignorar todas as aprovações" exige
 * `confirmado: true`, o segundo clique do aviso dentro do menu. Sem ele, `entrada_invalida` (400): uma aba antiga,
 * outro cliente ou o Nod sem o card da pessoa não ligam o modo. Os outros dois modos não pedem.
 */
/**
 * QA-114 (2026-11-19): o teto do admin (ADR-166) corta o modo pedido. A linha e o recibo dizem o modo que vale, não só o
 * pedido: sem isto, "roda sem perguntar" ficava gravado num bot que segue pedindo tudo. null = o pedido vale inteiro.
 */
export function avisoDoTeto(pedido: ModoAprovacao, agente: Pick<Agente, "modoAprovacao" | "tetoModo">): string | null {
  const efetivo = agente.modoAprovacao ?? "manual";
  if (efetivo === pedido) return null;
  const limite = agente.tetoModo === "so_leitura" ? "só leitura" : ROTULO_MODO[efetivo];
  return `o admin do time limitou os bots a ${limite}; segue em ${ROTULO_MODO[efetivo]} enquanto o limite valer`;
}

export const mudarModoAprovacao: CasoDeUso<{ agenteId: string; modo: unknown; confirmado?: unknown }, { agente: Agente; mudou: boolean; aviso: string | null }> = async (deps, input) => {
  if (!ehModoAprovacao(input.modo)) throw new ErroDeDominio("entrada_invalida", { cause: "modo" });
  if (input.modo === "total" && input.confirmado !== true) throw new ErroDeDominio("entrada_invalida", { cause: "confirmado" });
  const existente = await deps.repos.agentes.buscar(input.agenteId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  if (existente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  // ADR-166: compara com o modo PEDIDO (o efetivo pode estar cortado pelo teto do admin).
  if ((existente.modoPedido ?? existente.modoAprovacao ?? "manual") === input.modo) return { data: { agente: existente, mudou: false, aviso: avisoDoTeto(input.modo, existente) } };
  const agente = await deps.repos.agentes.definirModoAprovacao(input.agenteId, input.modo);
  if (!agente) throw new ErroDeDominio("nao_permitido");

  const aviso = avisoDoTeto(input.modo, agente);
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, dados: { agente_id: agente.id, acao: "modo_aprovacao", modo: input.modo, nome: agente.nome } })];
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (conversa) {
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const linha = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      turnoId: null,
      autoria,
      kind: "sistema",
      assunto: "aprovacao.modo",
      texto: `${pessoa?.nome ?? "A pessoa"} mudou as aprovações de ${agente.nome} para ${ROTULO_MODO[input.modo]}${aviso ? `, mas ${aviso}: ${efeito(agente.modoAprovacao ?? "manual", deps.services.revisor?.config.ligado === true)}` : `: ${efeito(input.modo, deps.services.revisor?.config.ligado === true)}`}`,
      confianca: "confiavel",
    });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  }
  return { data: { agente, mudou: true, aviso }, events };
};

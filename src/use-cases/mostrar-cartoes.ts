import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { normalizarCartoes, textoDosCartoes } from "../domain/cartoes-ricos.ts";
import { autoriaAgente, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * mostrar_cartoes (ADR-173, respostas ricas): grava UMA fala `texto` do bot com o resumo e as linhas dos cartões (o que
 * lê quem não desenha cartão) e o payload `cartoes` limpo pelo domínio. A fala leva a confiança do turno: o turno que leu
 * conteúdo de fora grava `nao_confiavel`, como a fala final. Sem cerca de modo: é uma fala do bot na conversa do turno
 * dele, como qualquer outra; o que ela não pode é sair do turno (outro bot, outra conversa).
 */
export const mostrarCartoes: CasoNod<Deps, "mostrar_cartoes"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId) {
    return { data: { ok: false, erro: "fora_do_turno", instrucao: "mostrar_cartoes só vale na conversa deste turno. Nada foi mostrado." } };
  }
  const v = normalizarCartoes({ resumo: input.resumo, cartoes: input.cartoes });
  if (!v.ok) return { data: { ok: false, erro: "cartao_invalido", instrucao: v.motivo } };
  const contaminado = turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turno.id));
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const m = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto: textoDosCartoes(v.valor.resumo, v.valor.cartoes),
    payload: { kind: "cartoes", cartoes: v.valor.cartoes },
    confianca: contaminado ? "nao_confiavel" : "confiavel",
  });
  if (!m) return { data: { ok: false, erro: "fora_do_turno", instrucao: "A conversa não aceitou a fala agora. Nada foi mostrado." } };
  const events: RuntimeEvent[] = [evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto" }, { conversaId: turno.conversaId, turnoId: turno.id })];
  return { data: { ok: true, mensagem_id: m.id, cartoes: v.valor.cartoes.length }, events };
};

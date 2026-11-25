import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O que o bot lê ao voltar: a pessoa devolveu, ou o controle voltou sozinho depois de ela parar de mexer. */
export function notaDaDevolucao(automatico: boolean): string {
  return automatico
    ? "O controle do navegador voltou para você: a pessoa ficou alguns minutos sem mexer. Continue a tarefa de onde parou; leia a página antes de agir, porque ela pode ter mudado."
    : "A pessoa devolveu o navegador. Continue a tarefa de onde parou; leia a página antes de agir, porque ela pode ter mudado.";
}

/**
 * A pessoa assumiu o navegador à mão e o turno do bot esbarrou nele (definido em 2026-11-22, teste do dono; ADR-190):
 * quando ela devolve, ou o controle volta sozinho, o turno continua pela retomada de sempre (`enfileirarRetomada`), como
 * o login e a ajuda já faziam pelo pedido. Antes, sem pedido aberto, devolver não acordava ninguém e o bot prometia
 * "quando você devolver, eu sigo" sem seguir.
 *
 * Não retoma quando: o turno sumiu; a pessoa já mandou mensagem nova depois dele (o turno dessa mensagem faz o trabalho);
 * a pessoa parou o turno ou a conversa; a execução do bot está bloqueada.
 */
export const retomarAposDevolverNavegador: CasoDeUso<{ turnoId: string; automatico: boolean }, { turnoId: string | null }> = async (deps, input) => {
  const original = await deps.repos.turnos.buscar(input.turnoId);
  if (!original) return { data: { turnoId: null } };
  const depois = (await deps.repos.turnos.listarDaConversa(original.conversaId)).some((t) => t.origem === "conversa" && t.criadoEm > original.criadoEm);
  if (depois) return { data: { turnoId: null } };
  if (original.motivoInterrupcao === "parado_pela_pessoa") return { data: { turnoId: null } };
  if ((await deps.repos.paradas.ativa(deps.escopo.pessoaId, null)) !== false || (await deps.repos.paradas.ativa(deps.escopo.pessoaId, original.conversaId)) !== false) return { data: { turnoId: null } };
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return { data: { turnoId: null } };
  const agora = deps.agora();
  const { turno, nova } = await enfileirarRetomada(deps, { original, prazoEm: agora + PRAZO_DECISAO_PADRAO_MS, entradaTexto: notaDaDevolucao(input.automatico), reenvios: original.reenvios + 1 });
  return {
    data: { turnoId: turno?.id ?? null },
    events: nova && turno ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, navegador_devolvido: input.automatico ? "sozinho" : "pessoa" } })] : [],
  };
};

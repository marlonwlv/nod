import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { quandoDaRotina } from "../domain/rotina-texto.ts";
import { autoriaPessoa, evento, eventoDeRotina, exigir } from "./apoio-l7.ts";
import { invalidarCardDeRitmo } from "./ritmo-card.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * QA do rc.10 no Windows (PR #333, achado 4): o "Excluir" de Configurações › Rotinas (POST rotinas/:id/excluir). Antes só
 * dava para excluir pedindo ao bot na conversa (excluir_rotina, que propõe um card). Aqui é a própria pessoa, com a
 * confirmação na tela: aplica direto, com o mesmo efeito de `aplicarExclusaoRotina` — exclusão recuperável (ADR-034),
 * o endereço do webhook revogado, o card de ritmo aberto fechado e a linha "Rotina excluída" na conversa da rotina.
 * Idempotente: a já excluída volta sem efeito. Só a dona exclui (o repositório devolve null para quem não é). Um card
 * "Excluir rotina" ainda aberto na conversa se fecha sozinho quando a pessoa o decide (`atual.excluidoEm !== null`).
 */
export const excluirRotina: CasoDeUso<{ rotinaId: string }, { rotina: Rotina; jaExcluida: boolean }> = async (deps, input) => {
  const atual = exigir((await deps.repos.rotinas.buscarParaAtualizar(input.rotinaId)) ?? (await deps.repos.rotinas.buscar(input.rotinaId)), "nao_encontrado", "rotina");
  if (atual.excluidoEm !== null) return { data: { rotina: atual, jaExcluida: true } };
  const agora = deps.agora();
  const rotina = await deps.repos.rotinas.excluir(atual.id, agora);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona exclui a rotina" });
  await deps.repos.rotinaGatilhos.revogarDaRotina(rotina.id, agora);
  const ritmo = await invalidarCardDeRitmo(deps, rotina);
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria,
    kind: "sistema",
    texto: `Rotina excluída: ${quandoDaRotina(rotina)}. Nada mais será disparado por ela.`,
    payload: eventoDeRotina(rotina, "excluida"),
    confianca: "confiavel",
  });
  return { data: { rotina, jaExcluida: false }, events: [evento(deps, "rotina_excluida", autoria, { rotinaId: rotina.id }, { conversaId: rotina.conversaId }), ...ritmo] };
};

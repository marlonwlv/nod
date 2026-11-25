import { expect, it } from "vitest";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { aplicarAtualizacaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { atualizarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");
describeIntegracao("QA r141: atualizar_rotina repetida no supervisionado", () => {
  it("a mesma mudança pedida de novo com o card aberto devolve o mesmo card; outra mudança abre o próprio", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const a = rotinaValida();
      const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: a.cron, fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "mude para as 9h", entradaConfianca: "confiavel", modelo: "m" });
      const ctx = { ...contexto(agenteId, conversaId, turno?.id), rotina_id: data.rotina.id, cron: "0 9 * * 1-5" };
      const r1 = await atualizarRotinaPeloAgente(deps, ctx);
      const r2 = await atualizarRotinaPeloAgente(deps, ctx);
      if ("erro" in r1.data || "erro" in r2.data) throw new Error("erro inesperado");
      const pend = (await repos.decisoes.pendentesDaConversa(conversaId)).filter((d) => d.tipo === "rotina_atualizacao");
      expect(r2.data.proposta_id).toBe(r1.data.proposta_id);
      expect(pend).toHaveLength(1);
      // Outra mudança (outro horário) segue abrindo o próprio card.
      const r3 = await atualizarRotinaPeloAgente(deps, { ...ctx, cron: "0 10 * * 1-5" });
      if ("erro" in r3.data) throw new Error("erro inesperado");
      expect(r3.data.proposta_id).not.toBe(r1.data.proposta_id);
      await aplicarAtualizacaoRotina(deps, { propostaId: r1.data.proposta_id });
      const rotina = await repos.rotinas.buscar(data.rotina.id);
      expect(rotina?.cron).toBe("0 9 * * 1-5");
    });
  });
});

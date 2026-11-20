import { expect, it } from "vitest";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { aplicarExclusaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { excluirRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");
describeIntegracao("QA r102: excluir_rotina repetida no supervisionado", () => {
  it("pedir de novo com o card aberto devolve o mesmo card, sem segundo card da mesma exclusão", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const a = rotinaValida();
      const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: a.cron, fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "exclua", entradaConfianca: "confiavel", modelo: "m" });
      const ctx = { ...contexto(agenteId, conversaId, turno?.id), rotina_id: data.rotina.id };
      const r1 = await excluirRotinaPeloAgente(deps, ctx);
      const r2 = await excluirRotinaPeloAgente(deps, ctx);
      if ("erro" in r1.data || "erro" in r2.data) throw new Error("erro inesperado");
      const pend = (await repos.decisoes.pendentesDaConversa(conversaId)).filter((d) => d.tipo === "rotina_exclusao");
      await aplicarExclusaoRotina(deps, { propostaId: r1.data.proposta_id });
      const depois = (await repos.decisoes.pendentesDaConversa(conversaId)).filter((d) => d.tipo === "rotina_exclusao");
      expect(pend).toHaveLength(1);
      expect(r2.data.proposta_id).toBe(r1.data.proposta_id);
      expect(depois).toEqual([]);
    });
  });
});

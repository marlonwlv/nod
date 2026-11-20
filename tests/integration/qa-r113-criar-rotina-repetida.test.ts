import { expect, it } from "vitest";
import { ativarRotina } from "../../src/use-cases/ativar-rotina.ts";
import { criarRotina } from "../../src/use-cases/criar-rotina.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { planoDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

describeIntegracao("QA r113: criar_rotina repetida", () => {
  it("supervisionado: pedir de novo a mesma rotina com o card aberto devolve o mesmo card", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "todo dia útil às 8", entradaConfianca: "confiavel", modelo: "m" });
      const ctx = { ...contexto(agenteId, conversaId, turno?.id), ...rotinaValida() };
      const r1 = await criarRotina(deps, ctx);
      const r2 = await criarRotina(deps, ctx);
      if ("erro" in r1.data || "erro" in r2.data) throw new Error("erro inesperado");
      const pend = (await repos.decisoes.pendentesDaConversa(conversaId)).filter((d) => d.tipo === "rotina");
      await ativarRotina(deps, { propostaId: r1.data.proposta_id });
      await ativarRotina(deps, { propostaId: r2.data.proposta_id });
      const rotinas = await repos.rotinas.listar();
      const depois = (await repos.decisoes.pendentesDaConversa(conversaId)).filter((d) => d.tipo === "rotina");
      expect(r2.data.proposta_id).toBe(r1.data.proposta_id);
      expect(pend).toHaveLength(1);
      expect(rotinas).toHaveLength(1);
      expect(depois).toEqual([]);
      // Outra rotina (outro horário) continua abrindo o próprio card.
      const r3 = await criarRotina(deps, { ...ctx, cron: "0 9 * * 1-5" });
      if ("erro" in r3.data) throw new Error("erro inesperado");
      expect(r3.data.proposta_id).not.toBe(r1.data.proposta_id);
    });
  });

  it("automático: a mesma chamada repetida no turno não cria duas rotinas ativas", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      await mudarModoAprovacao(deps, { agenteId, modo: "automatico" });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "todo dia útil às 8", entradaConfianca: "confiavel", modelo: "m" });
      if (!turno) throw new Error("turno");
      const plano = planoDeTeste({ tenantId: TENANT_PADRAO, turnoId: turno.id, agenteId, conversaId, modoTurno: "conversa", confiancaEntrada: "confiavel" });
      const ctx = { ...contexto(agenteId, conversaId, turno.id), plano, ...rotinaValida() };
      const r1 = await criarRotina(deps, ctx);
      const r2 = await criarRotina(deps, ctx);
      const rotinas = await repos.rotinas.listar();
      const msgs = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema" && m.texto.startsWith("Rotina ativa"));
      if ("erro" in r1.data || "erro" in r2.data) throw new Error("erro inesperado");
      expect(r2.data).toMatchObject({ proposta_id: r1.data.proposta_id, aplicada: true });
      expect(rotinas).toHaveLength(1);
      expect(msgs).toHaveLength(1);
    });
  });
});

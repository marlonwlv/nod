import { expect, it } from "vitest";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-07T12:00:00-03:00");
const ROTINA = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "Resumo da manhã", fonte: "Gmail", entregavel: "mensagem nesta conversa", limites_aprovacao: "sem ações externas", politica_sem_dado: "dizer que não há novidade" };

describeIntegracao("QA r143: atualizar_perfil repetido com o card aberto", () => {
  it("o mesmo perfil com as mesmas rotinas devolve o mesmo card, sem rotinas a mais; outro perfil abre o próprio", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "vire minha revisora", entradaConfianca: "confiavel", modelo: "m" });
      if (!turno) throw new Error("turno");
      const ctx = { agenteId, conversaId, turnoId: turno.id, nome: "Revisora", titulo: "Revisa PRs", descricao: "Revisa os PRs do nod", rotinas: [ROTINA] };
      const r1 = await atualizarPerfil(deps, ctx);
      const r2 = await atualizarPerfil(deps, ctx);
      if ("erro" in r1.data || "erro" in r2.data) throw new Error("erro inesperado");
      expect(r2.data.proposta_id).toBe(r1.data.proposta_id);
      expect(r2.data.rotinas).toEqual(r1.data.rotinas);
      const pendentes = await repos.propostas.pendentesDaConversa(conversaId);
      expect(pendentes.filter((p) => p.payload.kind === "perfil")).toHaveLength(1);
      expect(pendentes.filter((p) => p.payload.kind === "rotina")).toHaveLength(1);

      // Outra descrição segue abrindo o próprio card; rotina diferente também.
      const r3 = await atualizarPerfil(deps, { ...ctx, descricao: "Revisa os PRs do nod e do site" });
      const r4 = await atualizarPerfil(deps, { ...ctx, rotinas: [{ ...ROTINA, cron: "0 9 * * 1-5" }] });
      if ("erro" in r3.data || "erro" in r4.data) throw new Error("erro inesperado");
      expect(new Set([r1.data.proposta_id, r3.data.proposta_id, r4.data.proposta_id]).size).toBe(3);

      // Confirmar o card devolvido às duas chamadas cria a rotina uma vez só.
      await confirmarProposta(deps, { propostaId: r1.data.proposta_id });
      expect(await repos.rotinas.contarDoAgente(agenteId)).toBe(1);
    });
  });
});

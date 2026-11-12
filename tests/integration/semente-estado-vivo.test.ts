import { expect, it } from "vitest";
import { sementeDoEstadoVivo } from "../../src/use-cases/semente-estado-vivo.ts";
import { depsSobreTrx, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Item 5 (2026-11-12): a semente do estado vivo lê do banco o turno despachando e a decisão aberta da pessoa. */
describeIntegracao("semente do estado vivo", () => {
  it("traz o turno despachando e a pergunta pendente (com criado_em e prazo); a decidida fica de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const deps = depsSobreTrx(trx, MARLON);
      const agora = deps.agora();
      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: agora + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "auto", executor: "catcher" });
      await trx`update turnos set estado = 'despachando', machine_id = gen_random_uuid(), lease_ate = now() + interval '1 minute' where id = ${turno!.id}`;
      const aberta = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: turno!.id, prazoDecisaoEm: agora + 3_600_000, frase: "Qual prazo?" });
      const decidida = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: turno!.id, prazoDecisaoEm: agora + 3_600_000, frase: "Pode?" });
      await repos.decisoes.decidir(decidida!.id, { por: MARLON.pessoaId, agora });
      const s = await sementeDoEstadoVivo(deps);
      expect(s.vivos).toContainEqual({ agenteId, turnoId: turno!.id, conversaId });
      const d = s.decisoes.filter((x) => x.agenteId === agenteId);
      expect(d).toEqual([{ decisaoId: aberta!.id, agenteId, tipo: "pergunta", desde: expect.any(Number), venceEm: expect.any(Number) }]);
      expect(Math.abs(d[0]!.venceEm! - (agora + 3_600_000))).toBeLessThan(2_000);
    });
  });
});

import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { registrarRelatoDoNod } from "../../src/use-cases/nod.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

async function nodComTurno(d: Deps, modo: ModoAprovacao = "manual") {
  const { nod } = (await executar(d, garantirNod, {})).data;
  await d.repos.agentes.definirModoAprovacao(nod.id, modo);
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!turno) throw new Error("turno");
  return { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId };
}

describeIntegracao("QA-123: registrar_relato repetido no mesmo turno", () => {
  it("a mesma chamada repetida (retry do bot) devolve o mesmo relato, sem duplicar", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const ctx = await nodComTurno(d);
      const args = { tipo: "bug" as const, titulo: "Anexar não abre no Safari", texto: "Tocar no clipe não faz nada.", categoria: "interface" as const };
      const r1 = await registrarRelatoDoNod(d, { ...ctx, ...args });
      const r2 = await registrarRelatoDoNod(d, { ...ctx, ...args });
      expect(r1.data.ok && r2.data.ok).toBe(true);
      const id1 = r1.data.ok ? r1.data.relato_id : "";
      expect(r2.data.ok ? r2.data.relato_id : "").toBe(id1);
      const doNod = (await d.repos.relatos.listar()).filter((r) => r.origem === "nod");
      expect(doNod).toHaveLength(1);
      expect(r2.events ?? []).toHaveLength(0);
    });
  });

  it("relato diferente no mesmo turno, ou o mesmo em outro turno, continua criando", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const ctx = await nodComTurno(d);
      const a = await registrarRelatoDoNod(d, { ...ctx, tipo: "bug", titulo: "A", texto: "a" });
      const b = await registrarRelatoDoNod(d, { ...ctx, tipo: "melhoria", titulo: "B", texto: "b" });
      const ctx2 = await nodComTurno(d);
      const c = await registrarRelatoDoNod(d, { ...ctx2, tipo: "bug", titulo: "A", texto: "a" });
      const ids = new Set([a, b, c].map((r) => (r.data.ok ? r.data.relato_id : "x")));
      expect(ids.size).toBe(3);
    });
  });
});

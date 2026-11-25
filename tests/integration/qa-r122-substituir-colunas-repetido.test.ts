import { expect, it } from "vitest";
import { decidirColunasDoQuadro } from "../../src/use-cases/colunas-do-quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** QA r122: o bot repetir o mesmo substituir_colunas (retry, chamada duplicada) com o card aberto não abre outro card. */
const DOCES = [
  { nome: "Pedido", grupo: "nao_iniciado" as const }, { nome: "Compras", grupo: "iniciado" as const }, { nome: "Pago", grupo: "feito" as const },
];

describeIntegracao("QA r122: substituir_colunas repetido", () => {
  it("a mesma troca pedida de novo com o card aberto devolve o mesmo card; outra troca abre o dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const doces = await agenteComConversa(trx, MARLON, { nome: `Doces ${Math.random().toString(36).slice(2, 7)}` });
      const turno = async () => {
        const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: doces.conversaId, agenteId: doces.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
        return { turnoId: t!.id, agenteId: doces.agenteId, conversaId: doces.conversaId };
      };
      await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: doces.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "M" }] });
      const pede = async (colunas = DOCES) => {
        const r = await executar(d, gerirQuadro, { ...(await turno()), acoes: [{ tipo: "substituir_colunas", colunas }] });
        if (!r.data.ok || !r.data.proposta_id) throw new Error(JSON.stringify(r.data));
        return r.data.proposta_id;
      };
      const p1 = await pede();
      const p2 = await pede();
      const pend = (await d.repos.decisoes.pendentesDaConversa(doces.conversaId)).filter((x) => x.tipo === "colunas_quadro");
      expect(p2).toBe(p1);
      expect(pend).toHaveLength(1);
      const p3 = await pede([...DOCES.slice(0, 2), { nome: "Entregue", grupo: "feito" as const }]);
      expect(p3).not.toBe(p1);
      // Decidido o primeiro, pedir de novo a mesma troca abre card novo (o antigo não vale mais).
      await executar(d, decidirColunasDoQuadro, { decisaoId: p1, recusar: true, executor: "catcher" });
      expect(await pede()).not.toBe(p1);
    });
  });
});

import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro, verQuadro } from "../../src/use-cases/quadro.ts";
import { quadrosDoBot } from "../../src/use-cases/quadros-do-bot.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const s = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${s}` });
  const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${s}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const criar = (anfitriaoId: string, nome?: string) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: null, prazo: null, ...(nome ? { nome } : {}) }] });
  return { ana: ana.agenteId, gil: gil.agenteId, deps, repos, criar };
}

/** ADR-181: sem `?quadro=` (a 1ª leitura do bot, junto com a lista do seletor, Q3) o servidor abre o último aberto. */
describeIntegracao("verQuadro sem ?quadro= abre o último aberto do bot (ADR-181)", () => {
  it("sem preferência abre o padrão; com a preferência, o último aberto; com ?quadro=, o pedido", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.criar(m.ana)).data).toMatchObject({ ok: true });
      expect((await m.criar(m.ana, "Site")).data).toMatchObject({ ok: true });
      const lista = await quadrosDoBot(m.deps, m.ana);
      const padrao = lista.quadros.find((q) => q.padrao)!;
      const site = lista.quadros.find((q) => q.nome === "Site")!;
      expect(padrao.id).not.toBe(site.id);

      expect((await verQuadro(m.deps, { agenteId: m.ana })).data.quadro?.id).toBe(padrao.id);

      await m.repos.preferencias.abrirQuadro(m.ana, site.id);
      expect((await quadrosDoBot(m.deps, m.ana)).aberto).toBe(site.id);
      expect((await verQuadro(m.deps, { agenteId: m.ana })).data.quadro?.id).toBe(site.id);
      // O pedido explícito continua mandando (ADA-14).
      expect((await verQuadro(m.deps, { agenteId: m.ana, quadro: padrao.id })).data.quadro?.id).toBe(padrao.id);
    });
  });

  it("a preferência que aponta um quadro que não é deste bot cai no padrão, como a lista", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.criar(m.ana)).data).toMatchObject({ ok: true });
      expect((await m.criar(m.gil)).data).toMatchObject({ ok: true });
      const doGil = (await quadrosDoBot(m.deps, m.gil)).quadros[0]!;
      const padraoDaAna = (await quadrosDoBot(m.deps, m.ana)).quadros.find((q) => q.padrao)!;
      await m.repos.preferencias.abrirQuadro(m.ana, doGil.id);
      expect((await quadrosDoBot(m.deps, m.ana)).aberto).toBe(padraoDaAna.id);
      expect((await verQuadro(m.deps, { agenteId: m.ana })).data.quadro?.id).toBe(padraoDaAna.id);
    });
  });
});

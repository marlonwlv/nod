import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { liberadosAgora } from "../../src/domain/seu-computador.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { ANA, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** ADR-197 (0187): os apps do computador da pessoa por bot, no Postgres, com a RLS separando as pessoas. */
const T0 = 1_795_000_000_000;
const NUMBERS = { plataforma: "darwin" as const, appId: "com.apple.iWork.Numbers", appNome: "Numbers" };

describeIntegracao("computador da pessoa: apps liberados (0187)", () => {
  it("desta vez vence, Sempre fica e não volta a desta vez; tirar um, de um bot e tudo; outra pessoa não vê nem libera", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      expect(await repos.seuComputadorApps.doBot(agenteId, "darwin")).toEqual([]);
      expect(await repos.seuComputadorApps.liberar({ agenteId, ...NUMBERS, ate: T0 + 1000 }, T0)).toBe(true);
      expect(liberadosAgora(await repos.seuComputadorApps.doBot(agenteId, "darwin"), T0 + 2000)).toEqual([]);
      expect(await repos.seuComputadorApps.liberar({ agenteId, ...NUMBERS, ate: null }, T0 + 1)).toBe(true);
      expect(await repos.seuComputadorApps.liberar({ agenteId, ...NUMBERS, ate: T0 + 5 }, T0 + 2)).toBe(true);
      expect(await repos.seuComputadorApps.doBot(agenteId, "darwin")).toMatchObject([{ id: NUMBERS.appId, nome: "Numbers", ate: null, plataforma: "darwin", agenteId }]);
      expect(await repos.seuComputadorApps.doBot(agenteId, "win32")).toEqual([]);
      await repos.seuComputadorApps.liberar({ agenteId, plataforma: "darwin", appId: "com.apple.Notes", appNome: "Notas", ate: null }, T0);
      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.seuComputadorApps.daPessoa()).toEqual([]);
      expect(await daAna.seuComputadorApps.liberar({ agenteId, ...NUMBERS, ate: null }, T0)).toBe(false);
      expect(await daAna.seuComputadorApps.tirar({})).toBe(0);
      await vincularEscopo(trx, MARLON);
      expect(await repos.seuComputadorApps.tirar({ agenteId, appId: "com.apple.Notes" })).toBe(1);
      expect((await repos.seuComputadorApps.daPessoa()).map((a) => a.nome)).toEqual(["Numbers"]);
      expect(await repos.seuComputadorApps.tirar({})).toBe(1);
      expect(await repos.seuComputadorApps.daPessoa()).toEqual([]);
    });
  });

  it("o CHECK recusa plataforma de fora e id curto", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      await expect(repos.seuComputadorApps.liberar({ agenteId, plataforma: "linux" as never, appId: "x.y.z", appNome: "X", ate: null }, T0)).rejects.toThrow();
    });
  });
});

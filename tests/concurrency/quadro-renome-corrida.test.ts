import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA-229 (r232): dois editar_quadro que dão o MESMO nome a dois quadros diferentes do mesmo bot, em duas transações
 * reais (a tela e o chat, ou dois bots no mesmo minuto). Cada lote trava só a linha do próprio quadro, então a conferência
 * "este bot já tem outro quadro com esse nome" de um não via o nome que o outro ainda não tinha gravado: o bot ficava com
 * dois "Site", e "Site" passava a ser ambíguo no chat. O segundo agora espera o primeiro e recusa.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const depsDe = (trx: Tx): Deps => depsSobre(trx, PESSOA).deps;
const renomear = (d: Deps, agenteId: string, quadroId: string, nome: string) =>
  aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", quadroDoBot: quadroId, ops: [{ tipo: "editar_quadro", nome }] });

/** Um bot com três quadros commitados: o padrão, "A" e "B". */
async function cenario(): Promise<{ agenteId: string; a: string; b: string }> {
  const agenteId = randomUUID();
  return escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    await d.repos.agentes.criar({ id: agenteId, nome: "Sites", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    for (const nome of [undefined, "A", "B"]) {
      const r = await aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: null, prazo: null, ...(nome ? { nome } : {}) }] });
      expect(r.data).toMatchObject({ ok: true });
    }
    const qs = await d.repos.quadros.vinculadosAo(agenteId);
    return { agenteId, a: qs.find((q) => q.nome === "A")!.id, b: qs.find((q) => q.nome === "B")!.id };
  });
}

describeIntegracao("dois renomes simultâneos para o mesmo nome no mesmo bot (QA-229)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("o segundo espera o primeiro e recusa: o bot não fica com dois quadros 'Site'", async () => {
    const c = await cenario();
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let renomeou!: () => void;
    const primeiroRenomeou = new Promise<void>((ok) => (renomeou = ok));
    const t1 = escopado(async (trx) => {
      const r = await renomear(depsDe(trx), c.agenteId, c.a, "Site");
      expect(r.data).toMatchObject({ ok: true });
      renomeou();
      await segura;
    });
    await primeiroRenomeou;
    const t2 = escopado((trx) => renomear(depsDe(trx), c.agenteId, c.b, "site"));
    // Dá tempo ao segundo de passar pela conferência (sem a trava ele termina aqui; com ela, espera o primeiro).
    await Promise.race([t2, new Promise((ok) => setTimeout(ok, 1_500))]);
    soltar();
    await t1;
    const r2 = await t2;
    expect(r2.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
    const nomes = await escopado(async (trx) => (await criarRepos(trx, PESSOA).quadros.vinculadosAo(c.agenteId)).map((q) => q.nome));
    expect(nomes.filter((n) => n?.toLowerCase() === "site")).toHaveLength(1);
    expect(nomes).toContain("B");
  });
});

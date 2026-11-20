import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const agenteId = randomUUID();

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, ESCOPO);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

describeIntegracao("lembrar idempotente sob corrida", () => {
  afterAll(async () => {
    await limparPessoaE2E(db, dbDono, ESCOPO, { agentes: [agenteId], conversas: [] });
  });

  it("duas transações com o mesmo conteúdo criam uma memória e uma entrada no diário", async () => {
    await escopado(async (trx) => {
      await criarRepos(trx, ESCOPO).agentes.criar({ id: agenteId, nome: "Memória", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    });
    const criar = () => escopado((trx) => criarRepos(trx, ESCOPO).memorias.criarSeAusente({ agenteId, tipo: "fato", texto: "o playbook fica na pasta do QA", origem: "agente" }));

    const [a, b] = await Promise.all([criar(), criar()]);

    expect(a?.memoria.id).toBe(b?.memoria.id);
    expect([a?.criada, b?.criada].sort()).toEqual([false, true]);
    const contagens = await escopado(async (trx) => {
      const [memorias] = await trx<{ n: number }[]>`select count(*)::int as n from agente_memorias where agente_id = ${agenteId}`;
      const [diario] = await trx<{ n: number }[]>`select count(*)::int as n from memoria_diario where agente_id = ${agenteId}`;
      return { memorias: memorias?.n, diario: diario?.n };
    });
    expect(contagens).toEqual({ memorias: 1, diario: 1 });
  });

  it("QA-126: dois Anotar da pessoa ao mesmo tempo criam uma memória e uma entrada no diário", async () => {
    const texto = "duplo clique no Anotar";
    const criar = () => escopado((trx) => criarRepos(trx, ESCOPO).memorias.criarSeAusente({ agenteId, tipo: "fato", texto, origem: "pessoa" }));

    const [a, b] = await Promise.all([criar(), criar()]);

    expect(a?.memoria.id).toBe(b?.memoria.id);
    expect(a?.memoria.origem).toBe("pessoa");
    expect([a?.criada, b?.criada].sort()).toEqual([false, true]);
    const n = await escopado(async (trx) => {
      const [m] = await trx<{ n: number }[]>`select count(*)::int as n from agente_memorias where agente_id = ${agenteId} and texto = ${texto}`;
      const [d] = await trx<{ n: number }[]>`select count(*)::int as n from memoria_diario where agente_id = ${agenteId} and depois_texto = ${texto} and autor = 'pessoa'`;
      return { memorias: m?.n, diario: d?.n };
    });
    expect(n).toEqual({ memorias: 1, diario: 1 });
  });
});

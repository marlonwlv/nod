import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA-117: `bots.duplicar` em transações reais e concorrentes (o Duplicar da tela e o `gerir_bots duplicar` do chat são o
 * mesmo executor). Duas cópias pedidas juntas não podem sair com o mesmo nome: o chat resolve bot por nome e a pasta
 * nativa sai do nome.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const agentes: string[] = [];
const conversas: string[] = [];

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

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: agentes.splice(0), conversas: conversas.splice(0) });
});

describeIntegracao("bots.duplicar sob pedidos concorrentes (QA-117)", () => {
  it("três Duplicar juntos do mesmo bot saem com nomes distintos", async () => {
    const bot = await escopado((trx) => agenteComConversa(trx, PESSOA, { nome: "Vera" }));
    agentes.push(bot.agenteId);
    conversas.push(bot.conversaId);
    const rs = await Promise.all([0, 1, 2].map(() => escopado((trx) => duplicarAgente(depsDe(trx), { agenteId: bot.agenteId, rotinasPausadas: true }))));
    for (const r of rs) {
      agentes.push(r.data.agente.id);
      conversas.push(r.data.conversa.id);
    }
    const nomes = rs.map((r) => r.data.agente.nome).sort();
    expect(nomes).toEqual(["Vera (cópia 2)", "Vera (cópia 3)", "Vera (cópia)"]);
  });
});

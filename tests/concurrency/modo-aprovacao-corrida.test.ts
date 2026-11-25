import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import type { Db, Escopo } from "../../src/shared/types.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const url = process.env.DATABASE_URL_TEST ?? "postgres://sem-banco";
const urlDono = (() => { const u = new URL(process.env.DATABASE_URL_DONO ?? "postgres://sem-banco"); u.pathname = new URL(url).pathname; return u.toString(); })();
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * QA r167 (2026-11-21), com conexões reais: duas trocas para o mesmo modo ao mesmo tempo (duplo clique no modo, duas
 * abas, a tela e o chat). A trava da linha do bot serializa as duas; a segunda vê o modo novo e volta `mudou: false`,
 * e a conversa do bot ganha uma linha só.
 */
describeIntegracao("trocar o modo de aprovação duas vezes ao mesmo tempo (QA r167)", () => {
  const dona: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const ids = { agentes: [] as string[], conversas: [] as string[] };
  let pool: Db;
  beforeAll(() => { pool = criarDb(url, { max: 4 }); });
  afterAll(async () => { const dono = criarDb(urlDono, { max: 1 }); try { await limparPessoaE2E(pool, dono, dona, ids); } finally { await dono.end({ timeout: 1 }); await pool.end({ timeout: 1 }); } });
  const naTx = <T>(fn: (d: Deps) => Promise<{ data: T; events?: unknown[] }>, segurarMs = 0): Promise<T> =>
    abrirTxEscopada(pool, dona)(async (trx) => {
      const d = depsSobreTrx(trx, dona);
      const r = await fn(d);
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events as never);
      if (segurarMs) await esperar(segurarMs);
      return r.data;
    });

  it("o duplo clique em Automático grava uma linha só e um mudou:true", { timeout: 30_000 }, async () => {
    const b = await abrirTxEscopada(pool, dona)((trx) => agenteComConversa(trx, dona, { nome: `R167 ${randomUUID().slice(0, 4)}` }));
    ids.agentes.push(b.agenteId); ids.conversas.push(b.conversaId);
    const r = await Promise.all([
      naTx((d) => mudarModoAprovacao(d, { agenteId: b.agenteId, modo: "automatico" }), 300),
      naTx((d) => mudarModoAprovacao(d, { agenteId: b.agenteId, modo: "automatico" }), 300),
    ]);
    const doModo = (await naTx(async (d) => ({ data: await d.repos.mensagens.listarDaConversa(b.conversaId) }))).filter((m) => /mudou as aprovações/.test(m.texto ?? ""));
    expect(r.filter((x) => x.mudou)).toHaveLength(1);
    expect(doModo).toHaveLength(1);
  });
});

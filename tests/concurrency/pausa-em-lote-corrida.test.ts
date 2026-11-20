import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { pausarTodasAsRotinas, reativarLoteDePausa } from "../../src/use-cases/pausa-em-lote.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA-115: dois "Pausar todas as rotinas" ao mesmo tempo (Enter duplo no ⌘K, ou o ⌘K e o chat juntos), em transações
 * reais. O lote que cada pedido DEVOLVE é o que o Desfazer do aviso e o reativar_lote_rotinas usam: ele tem que
 * reativar as rotinas que o pedido disse ter pausado. Linhas commitam; pessoa própria deste arquivo e limpeza por dona.
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

async function preparar(): Promise<string[]> {
  return escopado(async (trx) => {
    const bot = await agenteComConversa(trx, PESSOA, { nome: "Lia" });
    agentes.push(bot.agenteId);
    conversas.push(bot.conversaId);
    const repos = criarRepos(trx, PESSOA);
    const ids: string[] = [];
    for (const nome of ["r1", "r2", "r3"]) {
      const r = await repos.rotinas.criar({ agenteId: bot.agenteId, conversaId: bot.conversaId, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: nome, fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 3_600_000, estado: "ativa" });
      ids.push(r?.id ?? "");
    }
    return ids;
  });
}

async function alguemEsperandoLock(prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: agentes.splice(0), conversas: conversas.splice(0) });
});

describeIntegracao("dois Pausar todas ao mesmo tempo (QA-115)", () => {
  it("cada pedido devolve um lote que reativa o que ele disse ter pausado; nenhum devolve um lote vazio", async () => {
    const ids = await preparar();
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let marcou!: () => void;
    const marcado = new Promise<void>((ok) => (marcou = ok));
    const primeiro = escopado(async (trx) => {
      const d = depsDe(trx);
      const marcar = d.repos.rotinas.marcarLoteDePausa.bind(d.repos.rotinas);
      d.repos.rotinas.marcarLoteDePausa = async (...a) => { const n = await marcar(...a); marcou(); await segura; return n; };
      return pausarTodasAsRotinas(d, {});
    });
    await marcado;
    const segundo = escopado((trx) => pausarTodasAsRotinas(depsDe(trx), {}));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    const [r1, r2] = await Promise.all([primeiro, segundo]);
    // Juntos, os dois pausaram as três; uma rotina só pode estar no lote de quem a devolveu.
    expect([...r1.data.rotinaIds, ...r2.data.rotinaIds].sort()).toEqual([...ids].sort());
    for (const r of [r1, r2]) expect(r.data.rotinaIds.length > 0).toBe(r.data.lote !== null);
    // O Desfazer do aviso do PRIMEIRO pedido (o que o ⌘K mostrou) reativa as que ele pausou.
    const lote1 = r1.data.lote?.id ?? "";
    const volta = await escopado((trx) => reativarLoteDePausa(depsDe(trx), { loteId: lote1 }));
    expect(volta.data.reativadas.sort()).toEqual([...r1.data.rotinaIds].sort());
  });

  it("dois Desfazer do mesmo lote ao mesmo tempo: as rotinas voltam uma vez só, sem linha repetida na conversa", async () => {
    const ids = await preparar();
    const { data } = await escopado((trx) => pausarTodasAsRotinas(depsDe(trx), {}));
    const loteId = data.lote?.id ?? "";
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let limpou!: () => void;
    const limpo = new Promise<void>((ok) => (limpou = ok));
    const primeiro = escopado(async (trx) => {
      const d = depsDe(trx);
      const limpar = d.repos.rotinas.limparLoteDePausa.bind(d.repos.rotinas);
      d.repos.rotinas.limparLoteDePausa = async (...a) => { const n = await limpar(...a); limpou(); await segura; return n; };
      return reativarLoteDePausa(d, { loteId });
    });
    await limpo;
    const segundo = escopado((trx) => reativarLoteDePausa(depsDe(trx), { loteId }));
    expect(await alguemEsperandoLock()).toBe(true);
    soltar();
    const [r1, r2] = await Promise.all([primeiro, segundo]);
    expect(r1.data.reativadas.sort()).toEqual([...ids].sort());
    expect(r2.data.reativadas).toEqual([]);
    // Três linhas da pausa e três da volta; o segundo Desfazer não escreve "Rotina ativa" de novo.
    const linhas = await escopado((trx) => trx<{ n: number }[]>`select count(*)::int as n from mensagens where owner_id = ${PESSOA.pessoaId} and kind = 'sistema'`);
    expect(linhas[0]?.n).toBe(6);
  });
});

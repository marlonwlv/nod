import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { pausarRotina } from "../../src/use-cases/pausar-rotina.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA-120: pausar (ou reativar) a MESMA rotina duas vezes ao mesmo tempo — o botão da tela e o pausar_rotina do chat,
 * ou dois cliques — em transações reais. A segunda chamada tem que ver o estado já mudado e não escrever outra linha.
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

async function preparar(estado: "ativa" | "pausada"): Promise<string> {
  return escopado(async (trx) => {
    const bot = await agenteComConversa(trx, PESSOA, { nome: "Lia" });
    agentes.push(bot.agenteId);
    conversas.push(bot.conversaId);
    const r = await criarRepos(trx, PESSOA).rotinas.criar({ agenteId: bot.agenteId, conversaId: bot.conversaId, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "r", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: Date.now() + 3_600_000, estado });
    return r?.id ?? "";
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

const linhas = () => escopado((trx) => trx<{ texto: string }[]>`select texto from mensagens where owner_id = ${PESSOA.pessoaId} and kind = 'sistema'`);

async function corrida(rotinaId: string, estado: "ativa" | "pausada") {
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => (soltar = ok));
  let gravou!: () => void;
  const gravado = new Promise<void>((ok) => (gravou = ok));
  const primeiro = escopado(async (trx) => {
    const d = depsDe(trx);
    const atualizar = d.repos.rotinas.atualizarEstado.bind(d.repos.rotinas);
    d.repos.rotinas.atualizarEstado = async (...a) => { const r = await atualizar(...a); gravou(); await segura; return r; };
    return pausarRotina(d, { rotinaId, estado });
  });
  await gravado;
  const segundo = escopado((trx) => pausarRotina(depsDe(trx), { rotinaId, estado }));
  await alguemEsperandoLock(1_500);
  soltar();
  return Promise.all([primeiro, segundo]);
}

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: agentes.splice(0), conversas: conversas.splice(0) });
});

describeIntegracao("pausar/reativar a mesma rotina ao mesmo tempo (QA-120)", () => {
  it("duas pausas juntas: uma linha \"Rotina pausada\" só", async () => {
    const id = await preparar("ativa");
    await corrida(id, "pausada");
    const pausas = (await linhas()).filter((l) => l.texto.startsWith("Rotina pausada"));
    expect(pausas.length).toBe(1);
  });

  it("dois reativar juntos: uma linha \"Rotina ativa\" só", async () => {
    const id = await preparar("pausada");
    await corrida(id, "ativa");
    const voltas = (await linhas()).filter((l) => /ativa/i.test(l.texto));
    expect(voltas.length).toBe(1);
  });
});

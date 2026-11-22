import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { abrirTarefaDaPessoa } from "../../src/use-cases/coordenar-trabalhos.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre } from "../helpers/l5.ts";

/**
 * ADR-192 (definido em 2026-11-22): as corridas da Tarefa com duas conexões de verdade. Linhas COMMITADAS de uma pessoa
 * aleatória, apagadas por id no afterEach (a Thread e a trilha antes da Tarefa; a Tarefa antes do agente).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const depsDe = (trx: Tx) => depsSobre(criarRepos(trx, PESSOA), PESSOA, { trx });

async function bot(): Promise<{ agenteId: string; conversaId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Ada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "auto" });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  return { agenteId, conversaId };
}

afterEach(async () => {
  if (criados.agentes.length === 0) return;
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from lotes_de_frentes where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from anexos where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from mensagens where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from turnos where agente_id in ${trx(criados.agentes)}`;
    await trx`delete from trabalhos where agente_id in ${trx(criados.agentes)}`;
    await trx`delete from threads where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from tarefa_eventos where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from tarefas where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from paradas where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

describeIntegracao("Tarefa: corridas com duas conexões (ADR-192)", () => {
  it("dois pedidos de criação com a mesma chave ao mesmo tempo criam UMA Tarefa, uma Thread e um trabalho", async () => {
    const b = await bot();
    const chave = `clique-${randomUUID()}`;
    const pedir = () => escopado((trx) => abrirTarefaDaPessoa(depsDe(trx), { agenteId: b.agenteId, texto: "Compare os planos de hospedagem", chaveIdempotencia: chave }));
    const [a, c] = await Promise.all([pedir(), pedir()]);
    expect(a.data.tarefaId).toBeTruthy();
    expect(c.data.tarefaId).toBe(a.data.tarefaId);
    expect(c.data.trabalho.id).toBe(a.data.trabalho.id);
    const contagem = await escopado((trx) => trx<{ tarefas: number; threads: number; trabalhos: number }[]>`
      select (select count(*)::int from tarefas where owner_id = ${PESSOA.pessoaId}) as tarefas,
        (select count(*)::int from threads where owner_id = ${PESSOA.pessoaId}) as threads,
        (select count(*)::int from trabalhos where agente_id = ${b.agenteId}) as trabalhos`);
    expect(contagem[0]).toEqual({ tarefas: 1, threads: 1, trabalhos: 1 });
  });
});

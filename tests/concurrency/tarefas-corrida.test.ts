import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { abrirTarefaDaPessoa } from "../../src/use-cases/coordenar-trabalhos.ts";
import { arquivarTarefa, continuarTarefa, reabrirTarefa, resolverTarefa } from "../../src/use-cases/tarefas-acoes.ts";
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

  /** Uma Tarefa entregue (o primeiro turno concluído) e o id dela, commitados. */
  async function entregue(): Promise<{ tarefaId: string; trabalhoId: string }> {
    const b = await bot();
    const r = await escopado((trx) => abrirTarefaDaPessoa(depsDe(trx), { agenteId: b.agenteId, texto: "Levante os números" }));
    await escopado(async (trx) => {
      const d = depsDe(trx);
      await d.repos.turnos.assentar(r.data.turnoId, { estado: "concluido" });
      const { sincronizarTrabalho } = await import("../../src/use-cases/trabalhos.ts");
      await sincronizarTrabalho(d, r.data.trabalho.id);
    });
    return { tarefaId: r.data.tarefaId!, trabalhoId: r.data.trabalho.id };
  }

  const eventosDe = (tarefaId: string) => escopado((trx) => trx<{ tipo: string }[]>`select tipo from tarefa_eventos where tarefa_id = ${tarefaId} order by criado_em, id`);
  const estadoDe = (tarefaId: string) => escopado(async (trx) => (await trx<{ estado: string; versao: number }[]>`select estado, versao from tarefas where id = ${tarefaId}`)[0]!);

  it("dois cliques em Resolver ao mesmo tempo geram UMA resolução lógica (o segundo é idempotente)", async () => {
    const { tarefaId } = await entregue();
    const resolver = () => escopado((trx) => resolverTarefa(depsDe(trx), { tarefaId }));
    const [a, b] = await Promise.all([resolver(), resolver()]);
    expect([a.data.mudou, b.data.mudou].sort()).toEqual([false, true]);
    expect((await eventosDe(tarefaId)).filter((e) => e.tipo === "resolvida")).toHaveLength(1);
    expect((await estadoDe(tarefaId)).estado).toBe("resolvida");
  });

  it("dois Resolver com a mesma versão lida: um vence, o outro não muda nada (idempotente, sem segunda resolução)", async () => {
    const { tarefaId } = await entregue();
    const { versao } = await estadoDe(tarefaId);
    const resolver = () => escopado((trx) => resolverTarefa(depsDe(trx), { tarefaId, versao }));
    const r = await Promise.allSettled([resolver(), resolver()]);
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    expect((await eventosDe(tarefaId)).filter((e) => e.tipo === "resolvida")).toHaveLength(1);
  });

  it("Continuar concorrendo com Resolver não perde a mensagem nem resolve a execução nova por engano", async () => {
    const { tarefaId, trabalhoId } = await entregue();
    const [c, r] = await Promise.allSettled([
      escopado((trx) => continuarTarefa(depsDe(trx), { tarefaId, texto: "inclua o trimestre anterior" })),
      escopado((trx) => resolverTarefa(depsDe(trx), { tarefaId, turnoVivo: "manter" })),
    ]);
    expect(c.status).toBe("fulfilled");
    // A mensagem foi gravada e virou turno da Thread.
    const turnos = await escopado((trx) => trx<{ n: number }[]>`select count(*)::int as n from turnos where trabalho_id = ${trabalhoId} and thread_id is not null`);
    expect(turnos[0]!.n).toBe(2);
    const final = await estadoDe(tarefaId);
    const tipos = (await eventosDe(tarefaId)).map((e) => e.tipo);
    // Quem chegou por último decide, em ordem: Resolver depois do Continuar deixa resolvida (com o turno vivo mantido por
    // escolha explícita); Continuar depois do Resolver reabre (o evento `reaberta` registra). Nunca resolvida sem o evento.
    if (final.estado === "resolvida") expect(tipos.at(-1)).toBe("resolvida");
    else expect(final.estado).toBe("em_andamento");
    if (r.status === "rejected") expect(String(r.reason)).toContain("entrada_invalida");
  });

  it("Reabrir concorrendo com Arquivar termina num estado versionado previsível", async () => {
    const { tarefaId } = await entregue();
    await escopado((trx) => resolverTarefa(depsDe(trx), { tarefaId }));
    const antes = await estadoDe(tarefaId);
    await Promise.allSettled([
      escopado((trx) => reabrirTarefa(depsDe(trx), { tarefaId })),
      escopado((trx) => arquivarTarefa(depsDe(trx), { tarefaId })),
    ]);
    const final = await estadoDe(tarefaId);
    const tipos = (await eventosDe(tarefaId)).map((e) => e.tipo);
    // As duas aplicam em série (a linha trava): a versão sobe uma vez por evento que mudou o estado.
    expect(final.versao).toBe(antes.versao + tipos.slice(tipos.lastIndexOf("resolvida") + 1).length);
    expect(["arquivada", "em_andamento"]).toContain(final.estado);
    if (final.estado === "arquivada") expect(tipos.at(-1)).toBe("arquivada");
  });
});

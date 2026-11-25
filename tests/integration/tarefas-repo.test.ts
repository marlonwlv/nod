import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { transicaoDaTarefa } from "../../src/domain/tarefa.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-192, etapa 1 (definido em 2026-11-22): o schema de Tarefa, trilha e Thread (0180) e o repositório. Os gates da
 * etapa: RLS por pessoa, invariante 1 (Tarefa sem Thread primária não chega ao COMMIT), uma primária por Tarefa sem
 * travar o 1:N, versão para a corrida e os CHECKs que ligam carimbo a estado.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { repos } = depsSobre(trx, MARLON);
  const nova = async (titulo = "Landing nova", extra: { chaveIdempotencia?: string } = {}) => {
    const t = await repos.tarefas.criar({ agenteId: ada.agenteId, titulo, estado: "em_andamento", ...extra });
    if (!t) throw new Error("tarefa");
    const th = await repos.tarefas.criarThread({ tarefaId: t.id, conversaId: ada.conversaId });
    if (!th) throw new Error("thread");
    return { t, th };
  };
  return { ada, repos, nova };
}

/** Força agora a checagem adiada do invariante 1 (o withRollback nunca chega ao COMMIT). */
const conferirAgora = (trx: Trx) => trx`set constraints nod_tarefa_tem_thread_primaria immediate`;

describeIntegracao("tarefas: schema e repositório (ADR-192, etapa 1)", () => {
  it("Tarefa e Thread primária na mesma transação passam o invariante 1; a trilha guarda os eventos em ordem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { t, th } = await m.nova();
      expect(t).toMatchObject({ estado: "em_andamento", versao: 1, ownerId: PESSOA_MARLON, agenteId: m.ada.agenteId });
      expect(th).toMatchObject({ tarefaId: t.id, conversaId: m.ada.conversaId, tipo: "primaria", fechadaEm: null });
      await m.repos.tarefas.registrarEvento({ tarefaId: t.id, tipo: "criada", autorTipo: "pessoa", autorId: PESSOA_MARLON });
      await m.repos.tarefas.registrarEvento({ tarefaId: t.id, tipo: "thread_criada", autorTipo: "sistema", autorId: PESSOA_MARLON, dados: { thread_id: th.id } });
      await conferirAgora(trx);
      expect((await m.repos.tarefas.eventos(t.id)).map((e) => e.tipo)).toEqual(["criada", "thread_criada"]);
      expect(await m.repos.tarefas.threadPrimaria(t.id)).toMatchObject({ id: th.id });
    });
  });

  it("QA-193: eventos com o mesmo criado_em (o backfill) saem na ordem do ciclo de vida, não na do uuid", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const quando = Date.parse("2026-10-01T12:00:00Z");
      // 12 Tarefas, cada uma com a trilha gravada de trás para frente e o mesmo carimbo: o uuid sozinho acertaria 1 em 6.
      for (let i = 0; i < 12; i += 1) {
        const { t, th } = await m.nova(`Antiga ${i}`);
        await m.repos.tarefas.registrarEvento({ tarefaId: t.id, tipo: "entregue", autorTipo: "agente", autorId: m.ada.agenteId, criadoEm: quando });
        await m.repos.tarefas.registrarEvento({ tarefaId: t.id, tipo: "thread_criada", autorTipo: "sistema", autorId: PESSOA_MARLON, dados: { thread_id: th.id }, criadoEm: quando });
        await m.repos.tarefas.registrarEvento({ tarefaId: t.id, tipo: "criada", autorTipo: "sistema", autorId: PESSOA_MARLON, criadoEm: quando });
        expect((await m.repos.tarefas.eventos(t.id)).map((e) => e.tipo)).toEqual(["criada", "thread_criada", "entregue"]);
      }
    });
  });

  it("Tarefa sem Thread primária não passa da checagem adiada (nada órfão chega ao COMMIT)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.tarefas.criar({ agenteId: m.ada.agenteId, titulo: "Sem thread", estado: "nao_iniciada" });
      await expect(conferirAgora(trx)).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("uma Thread primária por Tarefa; uma secundária cabe (o schema já aceita 1:N)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { t } = await m.nova();
      expect(await m.repos.tarefas.criarThread({ tarefaId: t.id, conversaId: m.ada.conversaId })).toBeNull();
      const segunda = await m.repos.tarefas.criarThread({ tarefaId: t.id, conversaId: m.ada.conversaId, tipo: "secundaria" });
      expect(segunda).toMatchObject({ tipo: "secundaria" });
      expect(await m.repos.tarefas.threadsDaTarefa(t.id)).toHaveLength(2);
    });
  });

  it("a mesma chave de idempotência da mesma dona não cria outra Tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { t } = await m.nova("Primeira", { chaveIdempotencia: "clique-1" });
      expect(await m.repos.tarefas.criar({ agenteId: m.ada.agenteId, titulo: "Repetida", estado: "em_andamento", chaveIdempotencia: "clique-1" })).toBeNull();
      expect(await m.repos.tarefas.buscarPorChave("clique-1")).toMatchObject({ id: t.id, titulo: "Primeira" });
    });
  });

  it("aplicar só grava com a versão lida; a segunda escrita com a versão velha volta null", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { t } = await m.nova();
      const entrega = transicaoDaTarefa(t, "entregar", { tipo: "agente", id: m.ada.agenteId }, Date.now());
      if (!entrega.ok || !entrega.mudou) throw new Error("entregar");
      const gravada = await m.repos.tarefas.aplicar(t.id, entrega.linha, t.versao, Date.now());
      expect(gravada).toMatchObject({ estado: "entregue", versao: 2, entreguePorTipo: "agente", entreguePorId: m.ada.agenteId });
      expect(await m.repos.tarefas.aplicar(t.id, entrega.linha, t.versao, Date.now())).toBeNull();
      const resolver = transicaoDaTarefa(gravada!, "resolver", { tipo: "pessoa", id: PESSOA_MARLON }, Date.now());
      if (!resolver.ok || !resolver.mudou) throw new Error("resolver");
      expect(await m.repos.tarefas.aplicar(t.id, resolver.linha, gravada!.versao, Date.now())).toMatchObject({ estado: "resolvida", resolvidaPor: PESSOA_MARLON, versao: 3 });
    });
  });

  it("os CHECKs ligam carimbo a estado: resolvida sem quem resolveu e entregue sem entrega são recusadas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { t } = await m.nova();
      await expect(trx`savepoint a`.then(() => trx`update tarefas set estado = 'resolvida' where id = ${t.id}`)).rejects.toMatchObject({ code: "23514" });
      await trx`rollback to savepoint a`;
      await expect(trx`savepoint b`.then(() => trx`update tarefas set estado = 'entregue' where id = ${t.id}`)).rejects.toMatchObject({ code: "23514" });
      await trx`rollback to savepoint b`;
      await expect(trx`savepoint c`.then(() => trx`update tarefas set estado = 'arquivada' where id = ${t.id}`)).rejects.toMatchObject({ code: "23514" });
      await trx`rollback to savepoint c`;
    });
  });

  it("vínculos aditivos: o trabalho e o turno ligam à Tarefa/Thread; o trabalho acha a Tarefa dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { deps } = depsSobre(trx, MARLON);
      const { t, th } = await m.nova();
      const { criarTrabalho } = await import("../../src/use-cases/trabalhos.ts");
      const w = (await criarTrabalho(deps, { agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, titulo: "Landing nova", origem: "pessoa", forma: "frente" })).trabalho;
      const turno = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.ada.conversaId, agenteId: m.ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id });
      expect(await m.repos.tarefas.ligarTrabalho(w.id, t.id)).toBe(true);
      expect(await m.repos.tarefas.ligarTurno(turno!.id, th.id)).toBe(true);
      expect(await m.repos.tarefas.doTrabalho(w.id)).toMatchObject({ id: t.id });
      expect(await m.repos.tarefas.trabalhosDa(t.id)).toEqual([w.id]);
      expect((await m.repos.tarefas.vinculosDe([t.id])).get(t.id)).toEqual({ trabalhoId: w.id, cardId: null });
      // Um turno pertence a no máximo uma Thread.
      const outra = await m.nova("Outra");
      expect(await m.repos.tarefas.ligarTurno(turno!.id, outra.th.id)).toBe(false);
    });
  });

  it("RLS: a Tarefa, a trilha e a Thread da Ana não aparecem para o Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { t } = await m.nova();
      await m.repos.tarefas.registrarEvento({ tarefaId: t.id, tipo: "criada", autorTipo: "pessoa", autorId: PESSOA_MARLON });
      await vincularEscopo(trx, ANA);
      const { repos: daAna } = depsSobre(trx, ANA);
      expect(await daAna.tarefas.buscar(t.id)).toBeNull();
      expect(await daAna.tarefas.listar()).toEqual([]);
      const crus = await trx<{ n: number }[]>`select (select count(*)::int from tarefas where id = ${t.id}) + (select count(*)::int from threads where tarefa_id = ${t.id}) + (select count(*)::int from tarefa_eventos where tarefa_id = ${t.id}) as n`;
      expect(crus[0]!.n).toBe(0);
    });
  });

  it("listar esconde as arquivadas por padrão e filtra por bot e estado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.nova("A");
      const b = await m.nova("B");
      const arquivar = transicaoDaTarefa(b.t, "arquivar", { tipo: "pessoa", id: PESSOA_MARLON }, Date.now());
      if (!arquivar.ok || !arquivar.mudou) throw new Error("arquivar");
      await m.repos.tarefas.aplicar(b.t.id, arquivar.linha, b.t.versao, Date.now());
      const ids = (await m.repos.tarefas.listar({ agenteId: m.ada.agenteId })).map((x) => x.id);
      expect(ids).toEqual([a.t.id]);
      expect((await m.repos.tarefas.listar({ agenteId: m.ada.agenteId, comArquivadas: true })).map((x) => x.id).sort()).toEqual([a.t.id, b.t.id].sort());
      expect((await m.repos.tarefas.listar({ agenteId: m.ada.agenteId, estado: "arquivada" })).map((x) => x.id)).toEqual([b.t.id]);
    });
  });
});

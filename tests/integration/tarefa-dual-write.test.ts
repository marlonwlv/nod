import { expect, it } from "vitest";
import { abrirTarefaDaPessoa, mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { devolverResumo } from "../../src/use-cases/frentes.ts";
import { encerrarTrabalho, pararTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-192, etapa 2 (definido em 2026-11-22): "+ Nova tarefa" escreve a Tarefa e a Thread primária junto com o trabalho
 * runtime e o primeiro turno (dual-write), mantendo a resposta e os eventos legados. O trabalho segue sendo a fonte da
 * tela; a Tarefa acompanha: começou → em andamento; o bot entregou → entregue (com `falta` ou sem); só a pessoa resolve.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx, opcoes: { tarefaObjetivo?: boolean } = {}) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const base = depsSobre(trx, MARLON);
  const deps = opcoes.tarefaObjetivo === false ? { ...base.deps, tarefaObjetivo: false } : base.deps;
  const repos = base.repos;
  const abrir = (texto = "Levante os números do trimestre", chaveIdempotencia?: string) => abrirTarefaDaPessoa(deps, { agenteId: ada.agenteId, texto, ...(chaveIdempotencia ? { chaveIdempotencia } : {}) });
  const concluir = async (turnoId: string, trabalhoId: string) => {
    await repos.turnos.assentar(turnoId, { estado: "concluido" });
    return sincronizarTrabalho(deps, trabalhoId);
  };
  return { ada, deps, repos, abrir, concluir };
}

describeIntegracao("Tarefa com Thread: criação com dual-write (ADR-192, etapa 2)", () => {
  it("cria Tarefa em andamento + Thread primária + trabalho ligado + primeiro turno na Thread; a resposta legada segue igual", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      expect(r.data.trabalho).toMatchObject({ origem: "pessoa", forma: "frente", conversaId: m.ada.conversaId });
      expect(r.data.tarefaId).toBeTruthy();
      const tarefa = (await m.repos.tarefas.buscar(r.data.tarefaId!))!;
      expect(tarefa).toMatchObject({ estado: "em_andamento", agenteId: m.ada.agenteId, titulo: r.data.trabalho.titulo, versao: 1 });
      const thread = (await m.repos.tarefas.threadPrimaria(tarefa.id))!;
      expect(thread).toMatchObject({ id: r.data.threadId, conversaId: m.ada.conversaId, tipo: "primaria" });
      expect(await m.repos.tarefas.doTrabalho(r.data.trabalho.id)).toMatchObject({ id: tarefa.id });
      const turno = (await trx<{ thread_id: string | null; trabalho_id: string | null }[]>`select thread_id, trabalho_id from turnos where id = ${r.data.turnoId}`)[0]!;
      expect(turno).toEqual({ thread_id: thread.id, trabalho_id: r.data.trabalho.id });
      expect((await m.repos.tarefas.eventos(tarefa.id)).map((e) => [e.tipo, e.autorTipo])).toEqual([["criada", "pessoa"], ["thread_criada", "sistema"]]);
      const kinds = (r.events ?? []).map((e) => e.kind);
      expect(kinds).toEqual(expect.arrayContaining(["trabalho_mudou", "mensagem_criada", "turno_criado", "tarefa_mudou"]));
    });
  });

  it("o bot entrega com 'falta' e o turno conclui: o trabalho fica terminado e a Tarefa ENTREGUE, nunca resolvida", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      await devolverResumo(m.deps, { turnoId: r.data.turnoId, agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, feito: "Metade", falta: "esperar o fechamento" });
      const events = await m.concluir(r.data.turnoId, r.data.trabalho.id);
      expect((await m.repos.trabalhos.buscar(r.data.trabalho.id))?.estado).toBe("terminado");
      const tarefa = (await m.repos.tarefas.buscar(r.data.tarefaId!))!;
      expect(tarefa).toMatchObject({ estado: "entregue", entreguePorTipo: "agente", entreguePorId: m.ada.agenteId, resolvidaEm: null, resolvidaPor: null });
      const entregue = (await m.repos.tarefas.eventos(tarefa.id)).find((e) => e.tipo === "entregue");
      expect(entregue).toMatchObject({ autorTipo: "agente", autorId: m.ada.agenteId, turnoId: r.data.turnoId });
      expect(events.map((e) => e.kind)).toContain("tarefa_mudou");
    });
  });

  it("Continuar: a pessoa fala na Tarefa entregue — volta a em andamento e o turno novo cai na mesma Thread", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      await m.concluir(r.data.turnoId, r.data.trabalho.id);
      expect((await m.repos.tarefas.buscar(r.data.tarefaId!))?.estado).toBe("entregue");
      const segunda = await mensagemParaTrabalho(m.deps, { trabalhoId: r.data.trabalho.id, texto: "inclua o trimestre anterior" });
      expect((await m.repos.tarefas.buscar(r.data.tarefaId!))?.estado).toBe("em_andamento");
      const turno = (await trx<{ thread_id: string | null }[]>`select thread_id from turnos where id = ${segunda.data.mensagemTurnoId}`)[0]!;
      expect(turno.thread_id).toBe(r.data.threadId);
      expect((await m.repos.tarefas.eventos(r.data.tarefaId!)).map((e) => e.tipo)).toEqual(["criada", "thread_criada", "entregue", "reaberta"]);
      // Entrega de novo: a nova substitui a vigente na projeção; as duas ficam na trilha.
      await m.concluir(segunda.data.mensagemTurnoId, r.data.trabalho.id);
      expect((await m.repos.tarefas.buscar(r.data.tarefaId!))?.estado).toBe("entregue");
      expect((await m.repos.tarefas.eventos(r.data.tarefaId!)).filter((e) => e.tipo === "entregue")).toHaveLength(2);
    });
  });

  it("Parar e interrupção não mudam o objetivo; Encerrar (gesto da pessoa) resolve com autoria e hora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      const parado = await pararTrabalho(m.deps, { trabalhoId: r.data.trabalho.id });
      expect(parado.data.trabalho.estado).toBe("parado");
      expect((await m.repos.tarefas.buscar(r.data.tarefaId!))?.estado).toBe("em_andamento");
      const antes = Date.now();
      await encerrarTrabalho(m.deps, { trabalhoId: r.data.trabalho.id });
      const tarefa = (await m.repos.tarefas.buscar(r.data.tarefaId!))!;
      expect(tarefa).toMatchObject({ estado: "resolvida", resolvidaPor: PESSOA_MARLON });
      expect(tarefa.resolvidaEm).toBeGreaterThanOrEqual(antes - 1000);
    });
  });

  it("a falha do executor deixa o trabalho 'falhou' e a Tarefa em andamento (a atividade é que fica interrompida)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrir();
      await m.repos.turnos.interromper(r.data.turnoId, "executor_indisponivel");
      await sincronizarTrabalho(m.deps, r.data.trabalho.id);
      expect((await m.repos.trabalhos.buscar(r.data.trabalho.id))?.estado).toBe("falhou");
      expect((await m.repos.tarefas.buscar(r.data.tarefaId!))?.estado).toBe("em_andamento");
    });
  });

  it("a mesma chave de idempotência devolve a mesma tarefa e não cria outro trabalho", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.abrir("Primeira", "clique-123");
      const b = await m.abrir("Primeira", "clique-123");
      expect(b.data).toMatchObject({ tarefaId: a.data.tarefaId, turnoId: a.data.turnoId });
      expect(b.data.trabalho.id).toBe(a.data.trabalho.id);
      expect(b.events ?? []).toEqual([]);
      expect(await m.repos.trabalhos.abertosDoAgente(m.ada.agenteId)).toHaveLength(1);
    });
  });

  it("falha no meio da criação (anexo de fora) não deixa Tarefa, Thread nem trabalho", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`savepoint antes_da_tarefa`;
      await expect(abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Com anexo inexistente", anexos: ["00000000-0000-4000-8000-0000000000aa"] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await trx`rollback to savepoint antes_da_tarefa`;
      expect(await m.repos.tarefas.listar({ agenteId: m.ada.agenteId, comArquivadas: true })).toEqual([]);
      expect(await m.repos.trabalhos.abertosDoAgente(m.ada.agenteId)).toHaveLength(0);
    });
  });

  it("com a flag desligada (NOD_TAREFA_OBJETIVO=0) é o caminho de antes: nenhuma Tarefa, trabalho sem vínculo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { tarefaObjetivo: false });
      const r = await m.abrir();
      expect(r.data.tarefaId).toBeUndefined();
      expect(await m.repos.tarefas.doTrabalho(r.data.trabalho.id)).toBeNull();
      expect(await m.repos.tarefas.listar({ agenteId: m.ada.agenteId })).toEqual([]);
      // E o trabalho sem Tarefa segue o ciclo legado sem erro.
      await m.concluir(r.data.turnoId, r.data.trabalho.id);
      expect((await m.repos.trabalhos.buscar(r.data.trabalho.id))?.estado).toBe("terminado");
    });
  });
});

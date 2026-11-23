import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { REDE_MS } from "../../src/domain/trabalho.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { abrirTarefaDaPessoa, mensagemParaTrabalho, promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { arquivarTarefa, listarTarefas, resolverTarefa } from "../../src/use-cases/tarefas-acoes.ts";
import { pararTrabalho, sincronizarTrabalho, trabalhosParaDto } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-192, emenda 5 (definido em 2026-11-22, depois das jornadas de QA de ponta a ponta): a tarefa que o bot abre (frente,
 * rede de 2 min) ganha a Tarefa como a do "+ Nova tarefa"; a rota antiga da aba respeita a arquivada; o Parar aparece
 * como interrupção; resolver ou arquivar fecham a pergunta que sobrou.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx, opcoes: { tarefaObjetivo?: boolean } = {}) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const servicos = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const deps = opcoes.tarefaObjetivo === false ? { ...servicos, tarefaObjetivo: false } : servicos;
  const maquina = randomUUID();
  const turno = async (harness: IdHarness = "claude-cli") =>
    (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "levante os números do trimestre", entradaConfianca: "confiavel", modelo: "auto", harness, trabalhoId: null }))!;
  const ctx = (turnoId: string) => ({ turnoId, agenteId: base.agenteId, conversaId: base.conversaId });
  const threadDoTurno = async (turnoId: string) => (await trx<{ thread_id: string | null }[]>`select thread_id from turnos where id = ${turnoId}`)[0]?.thread_id ?? null;
  const despachar = async (turnoId: string, harness: IdHarness) => {
    await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    await emitirPlanoTurno(deps, { turnoId, machineId: maquina, executor: "local", harnesses: { [harness]: pronto } });
  };
  const abrirPelaTela = () => abrirTarefaDaPessoa(deps, { agenteId: base.agenteId, texto: "Escreva três ideias de nome" });
  return { ...base, deps, turno, ctx, threadDoTurno, despachar, abrirPelaTela };
}

describeIntegracao("Tarefa com Thread: emenda 5 do ADR-192 (achados das jornadas de QA)", () => {
  it("a frente que o bot abre ganha Tarefa em andamento + Thread primária, e o turno dela nasce na Thread", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono.id), frentes: [{ titulo: "Haicai sobre café", pedido: "Escreva um haicai." }, { titulo: "Nome da padaria", pedido: "Três nomes." }] });
      if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
      const tarefas = new Set<string>();
      for (const f of r.data.frentes) {
        const tarefa = (await m.repos.tarefas.doTrabalho(f.trabalho_id))!;
        expect(tarefa).toMatchObject({ estado: "em_andamento", agenteId: m.agenteId, titulo: f.titulo });
        tarefas.add(tarefa.id);
        const thread = (await m.repos.tarefas.threadPrimaria(tarefa.id))!;
        expect(thread.conversaId).toBe(m.conversaId);
        const [turno] = await m.repos.turnos.doTrabalho(f.trabalho_id);
        expect(await m.threadDoTurno(turno!.id)).toBe(thread.id);
        // A Tarefa nasceu pela decisão do bot: a trilha diz quem.
        expect((await m.repos.tarefas.eventos(tarefa.id)).map((e) => [e.tipo, e.autorTipo])).toEqual([["criada", "agente"], ["thread_criada", "sistema"]]);
        // A chave é a do backfill: ele nunca a duplica.
        expect(await m.repos.tarefas.buscarPorOrigem(`trabalho:${f.trabalho_id}`)).toMatchObject({ id: tarefa.id });
      }
      expect(tarefas.size).toBe(2);
      expect((r.events ?? []).filter((e) => e.kind === "tarefa_mudou")).toHaveLength(2);
    });
  });

  it("a frente que termina fica ENTREGUE (a mesma regra da tarefa aberta pela tela)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono.id), frentes: [{ titulo: "Haicai sobre café", pedido: "Escreva um haicai." }] });
      if (!r.data.ok) throw new Error("deveria abrir");
      const [f] = r.data.frentes;
      const [turno] = await m.repos.turnos.doTrabalho(f!.trabalho_id);
      await m.repos.turnos.assentar(turno!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, f!.trabalho_id);
      expect(await m.repos.tarefas.doTrabalho(f!.trabalho_id)).toMatchObject({ estado: "entregue", entreguePorTipo: "agente" });
    });
  });

  it("com a escrita desligada (NOD_TAREFA_OBJETIVO=0) a frente do bot nasce sem Tarefa, como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { tarefaObjetivo: false });
      const dono = await m.turno();
      const r = await abrirFrentes(m.deps, { ...m.ctx(dono.id), frentes: [{ titulo: "Haicai", pedido: "Escreva." }] });
      if (!r.data.ok) throw new Error("deveria abrir");
      expect(await m.repos.tarefas.doTrabalho(r.data.frentes[0]!.trabalho_id)).toBeNull();
    });
  });

  it("a conversa que a rede de 2 min promove ganha a Tarefa, e o turno promovido cai na Thread (trigger da 0181)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const vivo = await m.turno("codex-cli");
      await m.despachar(vivo.id, "codex-cli");
      const r = await promoverNaRede(m.deps, { turnoId: vivo.id, despachadoEm: Date.now() - REDE_MS, fezFerramenta: true, harness: "codex-cli", sessaoCli: null, sessaoExecutor: "local", maquinaBifurca: false, modo: "conversa" });
      const frente = r.data.trabalho!;
      const tarefa = (await m.repos.tarefas.doTrabalho(frente.id))!;
      expect(tarefa).toMatchObject({ estado: "em_andamento" });
      expect((await m.repos.tarefas.eventos(tarefa.id))[0]).toMatchObject({ tipo: "criada", autorTipo: "sistema" });
      expect(await m.threadDoTurno(vivo.id)).toBe((await m.repos.tarefas.threadPrimaria(tarefa.id))!.id);
    });
  });

  it("a rota antiga da aba recusa mensagem na Tarefa arquivada, e nada entra na fila", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrirPelaTela();
      await m.repos.turnos.assentar(r.data.turnoId, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, r.data.trabalho.id);
      await arquivarTarefa(m.deps, { tarefaId: r.data.tarefaId! });
      const antes = (await m.repos.turnos.doTrabalho(r.data.trabalho.id)).length;
      await expect(mensagemParaTrabalho(m.deps, { trabalhoId: r.data.trabalho.id, texto: "mais uma ideia" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(await m.repos.turnos.doTrabalho(r.data.trabalho.id)).toHaveLength(antes);
      expect((await m.repos.tarefas.buscar(r.data.tarefaId!))?.estado).toBe("arquivada");
    });
  });

  it("depois do Parar a atividade é 'interrompida' (lista e trabalho); resolvida, a interrupção some", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrirPelaTela();
      await pararTrabalho(m.deps, { trabalhoId: r.data.trabalho.id });
      const [lista] = (await listarTarefas(m.deps, {})).data.tarefas.filter((t) => t.id === r.data.tarefaId);
      expect(lista).toMatchObject({ estado: "em_andamento", atividade: "interrompida" });
      const [dto] = await trabalhosParaDto(m.deps, [(await m.repos.trabalhos.buscar(r.data.trabalho.id))!]);
      expect(dto?.tarefa).toMatchObject({ estado: "em_andamento", atividade: "interrompida" });
      await resolverTarefa(m.deps, { tarefaId: r.data.tarefaId! });
      const [depois] = (await listarTarefas(m.deps, {})).data.tarefas.filter((t) => t.id === r.data.tarefaId);
      expect(depois).toMatchObject({ estado: "resolvida", atividade: null });
    });
  });

  it("resolver com a pergunta do bot aberta fecha a pergunta por regra e o trabalho sai de 'precisa de você'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrirPelaTela();
      await m.repos.turnos.assentar(r.data.turnoId, { estado: "concluido" });
      const d = (await m.repos.decisoes.criar({ tipo: "aprovacao", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: r.data.turnoId, prazoDecisaoEm: Date.now() + 600_000, frase: "Você prefere café ou chá?" }))!;
      await sincronizarTrabalho(m.deps, r.data.trabalho.id);
      expect((await m.repos.trabalhos.buscar(r.data.trabalho.id))?.estado).toBe("precisa_de_voce");
      const res = await resolverTarefa(m.deps, { tarefaId: r.data.tarefaId! });
      expect(res.data.tarefa).toMatchObject({ estado: "resolvida", atividade: null });
      expect((await m.repos.decisoes.buscar(d.id))?.estado).not.toMatch(/pendente|reaberta/);
      expect(await m.repos.decisoes.abertasDoTrabalho(r.data.trabalho.id)).toHaveLength(0);
      expect((await m.repos.trabalhos.buscar(r.data.trabalho.id))?.estado).not.toBe("precisa_de_voce");
      expect((res.events ?? []).find((e) => e.kind === "decisao_decidida")?.dados).toMatchObject({ regra: "regra:tarefa_resolvida" });
    });
  });

  it("arquivar com 'deixar terminar' não fecha a pergunta do turno vivo (o bot pode precisar da resposta)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.abrirPelaTela();
      const d = (await m.repos.decisoes.criar({ tipo: "aprovacao", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: r.data.turnoId, prazoDecisaoEm: Date.now() + 600_000, frase: "Posso seguir?" }))!;
      await arquivarTarefa(m.deps, { tarefaId: r.data.tarefaId!, turnoVivo: "manter" });
      expect((await m.repos.decisoes.buscar(d.id))?.estado).toBe("pendente");
    });
  });
});

import { afterAll, beforeAll, expect, it } from "vitest";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasTarefas } from "../../src/adapters/http/rotas/tarefas.ts";
import type { TarefaDto } from "../../src/contracts/tarefa.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import type { TarefaDetalheDto } from "../../src/use-cases/tarefas-acoes.ts";
import { MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-192, etapa 3 (definido em 2026-11-22): as rotas da Tarefa. Cada chamada roda num savepoint da transação do teste
 * (nada é commitado). Contratos e erros: criar, listar (estado separado da atividade), detalhe com a Thread, Continuar,
 * Resolver com versão e com turno vivo, Reabrir, Arquivar/Desarquivar e Renomear.
 */
describeIntegracao("rotas /tarefas (ADR-192, etapa 3)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasTarefas(deps));
  });
  afterAll(() => servidor.close());

  async function noTeste(fn: (trx: Tx) => Promise<void>): Promise<void> {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        await fn(trx);
      } finally {
        trxAtual = null;
      }
    });
  }

  it("criar → listar → detalhar: a Tarefa nasce em andamento, com a Thread e o trabalho; a atividade vem à parte", async () => {
    await noTeste(async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const s = await servidor.entrar("marlon");
      const r = await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "Levante os números do trimestre" });
      expect(r.status).toBe(201);
      const criada = (await r.json()) as { ids: Record<string, string>; tarefa: TarefaDto; trabalhoId: string };
      expect(criada.tarefa).toMatchObject({ estado: "em_andamento", atividade: "trabalhando", agenteId: ada.agenteId, trabalhoId: criada.trabalhoId });
      expect(criada.ids).toMatchObject({ tarefa: criada.tarefa.id, trabalho: criada.trabalhoId });
      expect(criada.tarefa.threadId).toBeTruthy();

      const lista = (await (await servidor.chamar(s, "GET", `/tarefas?agenteId=${ada.agenteId}`)).json()) as { tarefas: TarefaDto[] };
      expect(lista.tarefas.map((t) => [t.id, t.estado, t.atividade])).toEqual([[criada.tarefa.id, "em_andamento", "trabalhando"]]);

      const det = (await (await servidor.chamar(s, "GET", `/tarefas/${criada.tarefa.id}`)).json()) as TarefaDetalheDto;
      expect(det.thread).toMatchObject({ id: criada.tarefa.threadId, tipo: "primaria" });
      expect(det.eventos.map((e) => e.tipo)).toEqual(["criada", "thread_criada"]);
      expect(det.detalhe?.mensagens.some((m) => m.texto === "Levante os números do trimestre")).toBe(true);
    });
  });

  it("Resolver com turno vivo exige a escolha; com 'manter' resolve e o turno segue; a versão velha perde com 409", async () => {
    await noTeste(async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const s = await servidor.entrar("marlon");
      const criada = (await (await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "Compare os planos" })).json()) as { tarefa: TarefaDto; turnoId: string };
      const semEscolha = await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, {});
      expect(semEscolha.status).toBe(400);
      const velha = await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, { versao: criada.tarefa.versao + 5, turnoVivo: "manter" });
      expect(velha.status).toBe(409);
      const ok = await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, { versao: criada.tarefa.versao, turnoVivo: "manter" });
      expect(ok.status).toBe(200);
      const corpo = (await ok.json()) as { tarefa: TarefaDto; mudou: boolean };
      expect(corpo).toMatchObject({ mudou: true, tarefa: { estado: "resolvida", atividade: "trabalhando" } });
      const turno = (await trx<{ estado: string }[]>`select estado from turnos where id = ${criada.turnoId}`)[0]!;
      expect(turno.estado).toBe("pendente");
      // Idempotente: o segundo clique não muda nada nem erra, mesmo com a versão de antes.
      const segundo = await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, { versao: criada.tarefa.versao, turnoVivo: "manter" });
      expect(segundo.status).toBe(200);
      expect(((await segundo.json()) as { mudou: boolean }).mudou).toBe(false);
    });
  });

  it("Resolver com 'parar' para o turno; Reabrir volta a em andamento; Arquivar esconde e Desarquivar devolve", async () => {
    await noTeste(async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const s = await servidor.entrar("marlon");
      const criada = (await (await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "Revise o contrato" })).json()) as { tarefa: TarefaDto; turnoId: string };
      const id = criada.tarefa.id;
      const resolvida = (await (await servidor.chamar(s, "POST", `/tarefas/${id}/resolver`, { turnoVivo: "parar" })).json()) as { tarefa: TarefaDto };
      // Emenda 5: na Tarefa resolvida a interrupção não é mostrada (atividadeNoObjetivo); o turno, sim, foi interrompido.
      expect(resolvida.tarefa).toMatchObject({ estado: "resolvida", atividade: null });
      expect((await trx<{ estado: string }[]>`select estado from turnos where id = ${criada.turnoId}`)[0]!.estado).toBe("interrompido");

      const reaberta = (await (await servidor.chamar(s, "POST", `/tarefas/${id}/reabrir`, {})).json()) as { tarefa: TarefaDto };
      expect(reaberta.tarefa.estado).toBe("em_andamento");

      const arquivada = await servidor.chamar(s, "POST", `/tarefas/${id}/arquivar`, {});
      expect(arquivada.status).toBe(200);
      expect(((await arquivada.json()) as { tarefa: TarefaDto }).tarefa.estado).toBe("arquivada");
      const padrao = (await (await servidor.chamar(s, "GET", `/tarefas?agenteId=${ada.agenteId}`)).json()) as { tarefas: TarefaDto[] };
      expect(padrao.tarefas).toEqual([]);
      const comArquivadas = (await (await servidor.chamar(s, "GET", `/tarefas?agenteId=${ada.agenteId}&arquivadas=1`)).json()) as { tarefas: TarefaDto[] };
      expect(comArquivadas.tarefas.map((t) => t.id)).toEqual([id]);
      // Continuar uma arquivada é recusado: desarquive antes.
      expect((await servidor.chamar(s, "POST", `/tarefas/${id}/mensagens`, { texto: "mais uma" })).status).toBe(409);
      const devolvida = (await (await servidor.chamar(s, "POST", `/tarefas/${id}/desarquivar`, {})).json()) as { tarefa: TarefaDto };
      expect(devolvida.tarefa.estado).toBe("em_andamento");

      const det = (await (await servidor.chamar(s, "GET", `/tarefas/${id}`)).json()) as TarefaDetalheDto;
      expect(det.eventos.map((e) => e.tipo)).toEqual(["criada", "thread_criada", "resolvida", "reaberta", "arquivada", "desarquivada"]);
      expect(det.eventos.find((e) => e.tipo === "resolvida")).toMatchObject({ autorTipo: "pessoa", autorId: MARLON.pessoaId });
    });
  });

  it("Continuar cria o próximo turno na mesma Thread; Renomear troca o título da Tarefa e do trabalho", async () => {
    await noTeste(async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const s = await servidor.entrar("marlon");
      const criada = (await (await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "Escreva a landing" })).json()) as { tarefa: TarefaDto; turnoId: string; trabalhoId: string };
      const r = await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/mensagens`, { texto: "em tom leve" });
      expect(r.status).toBe(201);
      const { turnoId } = (await r.json()) as { turnoId: string };
      expect(turnoId).not.toBe(criada.turnoId);
      expect((await trx<{ thread_id: string }[]>`select thread_id from turnos where id = ${turnoId}`)[0]!.thread_id).toBe(criada.tarefa.threadId);
      const renomeada = (await (await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/titulo`, { titulo: "Landing das escolas" })).json()) as { tarefa: TarefaDto };
      expect(renomeada.tarefa.titulo).toBe("Landing das escolas");
      expect((await trx<{ titulo: string }[]>`select titulo from trabalhos where id = ${criada.trabalhoId}`)[0]!.titulo).toBe("Landing das escolas");
    });
  });

  it("erros: id fora de uuid é 404; estado inválido no filtro é 400; versão malformada é 400; Tarefa de outra pessoa é 404", async () => {
    await noTeste(async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const s = await servidor.entrar("marlon");
      expect((await servidor.chamar(s, "GET", `/tarefas/nao-e-uuid`)).status).toBe(404);
      expect((await servidor.chamar(s, "GET", `/tarefas?estado=talvez`)).status).toBe(400);
      expect((await servidor.chamar(s, "GET", `/tarefas?agenteId=x`)).status).toBe(404);
      const criada = (await (await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "Uma tarefa" })).json()) as { tarefa: TarefaDto };
      expect((await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, { versao: "abc", turnoVivo: "manter" })).status).toBe(400);
      expect((await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, { turnoVivo: "talvez" })).status).toBe(400);
      expect((await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "  " })).status).toBe(400);
      const ana = await servidor.entrar("ana");
      expect((await servidor.chamar(ana, "GET", `/tarefas/${criada.tarefa.id}`)).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `/tarefas/${criada.tarefa.id}/resolver`, { turnoVivo: "manter" })).status).toBe(404);
    });
  });

  it("QA-197: Continuar a Tarefa de um bot excluído é 404 (como o chat), não 500; a Tarefa segue na lista e resolve", async () => {
    await noTeste(async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const s = await servidor.entrar("marlon");
      const criada = (await (await servidor.chamar(s, "POST", `/agentes/${ada.agenteId}/tarefas`, { texto: "Levante os números" })).json()) as { tarefa: TarefaDto };
      await criarRepos(trx, MARLON).agentes.excluir(ada.agenteId, Date.now());
      const nova = await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/mensagens`, { texto: "e aí?" });
      expect(nova.status).toBe(404);
      const lista = (await (await servidor.chamar(s, "GET", `/tarefas`)).json()) as { tarefas: TarefaDto[] };
      expect(lista.tarefas.map((t) => t.id)).toContain(criada.tarefa.id);
      expect((await servidor.chamar(s, "POST", `/tarefas/${criada.tarefa.id}/resolver`, {})).status).toBe(200);
    });
  });
});

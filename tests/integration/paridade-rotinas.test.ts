import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { criarRotasRotinas, type DepsRotasL7 } from "../../src/adapters/http/rotas/rotinas.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { executarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { criarRepos } from "../../src/repositories/index.ts";

/**
 * NOD-413 (ADR-135): o teste de contrato do `rotinas.executar`. O "Testar agora" da tela (POST /rotinas/:id/executar) e o
 * chat (executar_rotina propõe, a pessoa clica em "Rodar agora" no card, POST decisoes/:id/decidir) levam o mesmo começo
 * ao mesmo estado: um turno de rotina na conversa dela, a mesma agenda e a rotina com o horário intacto. "Agora não" não
 * roda nada. É o arquivo que o registro cita como `contrato` (src/domain/acoes/rotinas.ts).
 */
describeIntegracao("paridade tela × chat do rotinas.executar (NOD-413, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  const noSavepoint = <T,>(escopo: Escopo, fn: (sp: Tx) => Promise<T>): Promise<T> => {
    const trx = trxAtual;
    if (!trx) throw new Error("teste sem transação aberta");
    const caixa: { valor?: T } = {};
    return trx.savepoint(async (sp) => {
      await vincularEscopo(sp, escopo);
      caixa.valor = await fn(sp);
    }).then(() => caixa.valor as T);
  };
  const txPara = (escopo: Escopo): Transacao => (fn) => noSavepoint(escopo, fn);

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    const rotinas: DepsRotasL7 = { txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => Date.now() };
    const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T> => noSavepoint(escopo, (sp) => fn(depsSobre(sp, escopo).deps));
    servidor = await servidorDeTeste([
      ...criarRotasRotinas(rotinas),
      ...criarRotasDecisoes({ dentro, services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), prazoDecisaoMs: 60_000, executor: "catcher" }),
    ]);
  });
  afterAll(() => servidor.close());

  /** O mesmo começo dos dois lados: a Vera, em "Ignorar todas as aprovações", com uma rotina das 9h. */
  async function montar(trx: Tx) {
    const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera", modo: "total" });
    const { deps, repos } = depsSobre(trx, MARLON);
    const a = rotinaValida();
    const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: "0 9 * * *", fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "roda agora a rotina das 9h", entradaConfianca: "confiavel", modelo: "m" });
    return { deps, repos, ctx: contexto(agenteId, conversaId, turno?.id), rotina: data.rotina, sessao: await servidor.entrar("marlon") };
  }

  /** O estado que a tela e o chat têm de deixar igual (sem ids, que mudam de um lado para o outro). */
  async function estado(trx: Tx, m: Awaited<ReturnType<typeof montar>>) {
    const turnos = await trx<{ origem: string; estado: string }[]>`select origem, estado from turnos where conversa_id = ${m.rotina.conversaId} and origem <> 'conversa' order by criado_em`;
    const rotina = await m.repos.rotinas.buscar(m.rotina.id);
    const de = Date.now() - 86_400_000;
    const agenda = (await (await servidor.chamar(m.sessao, "GET", `rotinas/agenda?de=${de}&ate=${de + 3 * 86_400_000}&fuso=UTC`)).json()) as { itens: { tipo: string; rotinaId: string }[] };
    return {
      turnos,
      rotina: { estado: rotina?.estado, cron: rotina?.cron, proximaExecucao: rotina?.proximaExecucao },
      agenda: agenda.itens.filter((i) => i.rotinaId === m.rotina.id).map((i) => i.tipo),
    };
  }

  it("o registro aponta para este arquivo e o risco é pessoa_confirma", () => {
    const acao = REGISTRO_DE_ACOES.find((a) => a.id === "rotinas.executar");
    expect(acao).toMatchObject({ risco: "pessoa_confirma", cartaoNoChat: true, chat: { estado: "vivo", via: { ferramenta: "executar_rotina" }, contrato: "tests/integration/paridade-rotinas.test.ts" } });
  });

  it("Testar agora pela tela e Rodar agora pelo card do chat chegam ao mesmo estado", async () => {
    const tela = await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const r = await servidor.chamar(m.sessao, "POST", `rotinas/${m.rotina.id}/executar`, {});
      expect(r.status).toBe(200);
      const e = await estado(trx, m);
      trxAtual = null;
      return e;
    });
    const chat = await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const p = await executarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.rotina.id });
      if ("erro" in p.data) throw new Error(p.data.erro);
      // pessoa_confirma: nem "Ignorar todas as aprovações" roda sem o clique.
      expect(p.data).not.toHaveProperty("aplicada");
      expect((await estado(trx, m)).turnos).toEqual([]);
      const r = await servidor.chamar(m.sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, {});
      expect(r.status).toBe(200);
      expect((await m.repos.propostas.buscar(p.data.proposta_id))?.estado).toBe("confirmada");
      const e = await estado(trx, m);
      trxAtual = null;
      return e;
    });
    expect(tela.turnos).toHaveLength(1);
    expect(chat).toEqual(tela);
  });

  it("Agora não no card não roda nada e a rotina fica como estava", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const antes = await estado(trx, m);
      const p = await executarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.rotina.id });
      if ("erro" in p.data) throw new Error(p.data.erro);
      const r = await servidor.chamar(m.sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, { recusar: true });
      expect(r.status).toBe(200);
      expect((await m.repos.propostas.buscar(p.data.proposta_id))?.estado).toBe("recusada");
      expect(await estado(trx, m)).toEqual(antes);
      trxAtual = null;
    });
  });

  it("a rotina que mudou depois do card não roda (409) e o card sai recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const p = await executarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.rotina.id });
      if ("erro" in p.data) throw new Error(p.data.erro);
      await m.repos.rotinas.atualizar(m.rotina.id, { instrucao: "mudada pela tela enquanto o card esperava" });
      const r = await servidor.chamar(m.sessao, "POST", `decisoes/${p.data.proposta_id}/decidir`, {});
      expect(r.status).toBe(409);
      expect((await m.repos.propostas.buscar(p.data.proposta_id))?.estado).toBe("recusada");
      expect((await estado(trx, m)).turnos).toEqual([]);
      trxAtual = null;
    });
  });

  it("pedir de novo com o card aberto devolve o mesmo card; a rotina de outro bot não é deste", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const p1 = await executarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.rotina.id });
      const p2 = await executarRotinaPeloAgente(m.deps, { ...m.ctx, rotina_id: m.rotina.id });
      expect(p2.data).toEqual(p1.data);
      const outro = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const deOutro = await executarRotinaPeloAgente(m.deps, { ...contexto(outro.agenteId, outro.conversaId, undefined), rotina_id: m.rotina.id });
      expect(deOutro.data).toEqual({ erro: "nao_encontrado" });
      trxAtual = null;
    });
  });
});

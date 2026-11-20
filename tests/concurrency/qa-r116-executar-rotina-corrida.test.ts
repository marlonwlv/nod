import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { aplicarExecucaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { executarRotinaAgora } from "../../src/use-cases/executar-rotina-agora.ts";
import { executarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA-116: `rotinas.executar` em transações reais e concorrentes. O "Rodar agora" do card do chat e o "Testar agora" da
 * tela são o mesmo executor; um clique duplo, ou os dois botões ao mesmo tempo, não podem abrir duas execuções.
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

async function preparar(comCard: boolean) {
  return escopado(async (trx) => {
    const bot = await agenteComConversa(trx, PESSOA, { nome: "Vera" });
    agentes.push(bot.agenteId);
    conversas.push(bot.conversaId);
    const d = depsDe(trx);
    const a = rotinaValida();
    const { data } = await criarRotinaPelaPessoa(d, { agenteId: bot.agenteId, cron: "0 9 * * *", fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
    let propostaId = "";
    if (comCard) {
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "roda agora a rotina das 9h", entradaConfianca: "confiavel", modelo: "m" });
      const p = await executarRotinaPeloAgente(d, { ...contexto(bot.agenteId, bot.conversaId, turno?.id), rotina_id: data.rotina.id });
      if ("erro" in p.data) throw new Error(p.data.erro);
      propostaId = p.data.proposta_id;
    }
    return { rotinaId: data.rotina.id, conversaId: data.rotina.conversaId, propostaId };
  });
}

const turnosDaRotina = (conversaId: string) =>
  escopado((trx) => trx<{ id: string }[]>`select id from turnos where conversa_id = ${conversaId} and origem <> 'conversa'`);

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: agentes.splice(0), conversas: conversas.splice(0) });
});

describeIntegracao("rotinas.executar sob cliques concorrentes (QA-116)", () => {
  it("dois cliques em Rodar agora no mesmo card ao mesmo tempo abrem uma execução só", async () => {
    const m = await preparar(true);
    const [r1, r2] = await Promise.all([
      escopado((trx) => aplicarExecucaoRotina(depsDe(trx), { propostaId: m.propostaId, executor: "catcher" })),
      escopado((trx) => aplicarExecucaoRotina(depsDe(trx), { propostaId: m.propostaId, executor: "catcher" })),
    ]);
    expect([r1.data.jaAplicada, r2.data.jaAplicada].sort()).toEqual([false, true]);
    expect(await turnosDaRotina(m.conversaId)).toHaveLength(1);
  });

  it("dois Testar agora ao mesmo tempo abrem uma execução só", async () => {
    const m = await preparar(false);
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let leu!: () => void;
    const lido = new Promise<void>((ok) => (leu = ok));
    const primeiro = escopado(async (trx) => {
      const d = depsDe(trx);
      const ler = d.repos.rotinaJanelas.turnoAberto.bind(d.repos.rotinaJanelas);
      d.repos.rotinaJanelas.turnoAberto = async (...a) => { const r = await ler(...a); leu(); await segura; return r; };
      return executarRotinaAgora(d, { rotinaId: m.rotinaId, executor: "catcher" });
    });
    await lido;
    const segundo = escopado((trx) => executarRotinaAgora(depsDe(trx), { rotinaId: m.rotinaId, executor: "catcher" }));
    await new Promise((ok) => setTimeout(ok, 300));
    soltar();
    await Promise.allSettled([primeiro, segundo]);
    expect(await turnosDaRotina(m.conversaId)).toHaveLength(1);
  });

  it("Rodar agora do card e Testar agora da tela ao mesmo tempo: uma execução, e o card não roda mais uma", async () => {
    const m = await preparar(true);
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let leu!: () => void;
    const lido = new Promise<void>((ok) => (leu = ok));
    const card = escopado(async (trx) => {
      const d = depsDe(trx);
      const ler = d.repos.rotinaJanelas.turnoAberto.bind(d.repos.rotinaJanelas);
      d.repos.rotinaJanelas.turnoAberto = async (...a) => { const r = await ler(...a); leu(); await segura; return r; };
      return aplicarExecucaoRotina(d, { propostaId: m.propostaId, executor: "catcher" });
    });
    await lido;
    const tela = escopado((trx) => executarRotinaAgora(depsDe(trx), { rotinaId: m.rotinaId, executor: "catcher" }));
    await new Promise((ok) => setTimeout(ok, 300));
    soltar();
    await Promise.allSettled([card, tela]);
    expect(await turnosDaRotina(m.conversaId)).toHaveLength(1);
  });
});

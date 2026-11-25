import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirColunasDoQuadro } from "../../src/use-cases/colunas-do-quadro.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA r175 (2026-11-21), com conexões reais: a pessoa confirma o card de trocar as colunas e, no mesmo instante, manda uma
 * mensagem na conversa (duas abas, ou o Enter logo depois do clique). O Confirmar trava a PROPOSTA e só fecha a DECISÃO
 * depois de aplicar o lote; o "seguir conversando" (ADR-191) fechava a DECISÃO e depois recusava a PROPOSTA — ordem
 * inversa, e o Postgres matava uma das duas com deadlock (a mensagem ou o Confirmar voltava erro). Uma terceira transação
 * segura o quadro para abrir a janela de forma determinística, sem tocar no código do Confirmar.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const DOCES = [
  { nome: "Pedido", grupo: "nao_iniciado" as const }, { nome: "Compras", grupo: "iniciado" as const },
  { nome: "Entrega", grupo: "iniciado" as const }, { nome: "Pago", grupo: "feito" as const },
];

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`set local lock_timeout = '15s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const depsDe = (trx: Tx): Deps => depsSobre(trx, PESSOA).deps;

async function cenario(): Promise<{ agenteId: string; conversaId: string; propostaId: string; quadroId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  return escopado(async (trx) => {
    const d = depsDe(trx);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    await d.repos.agentes.criar({ id: agenteId, nome: "Doces", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await d.repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    const l = await aplicarLoteQuadro(d, { autor: { tipo: "pessoa" }, anfitriaoId: agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "A", status: "fazendo" }] });
    expect(l.data).toMatchObject({ ok: true });
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    const r = await gerirQuadro(d, { turnoId: t!.id, agenteId, conversaId, acoes: [{ tipo: "substituir_colunas", colunas: DOCES }] });
    if (!r.data.ok || !r.data.proposta_id) throw new Error(`sem card: ${JSON.stringify(r.data)}`);
    // O turno que pediu já terminou: o card espera a pessoa (o de turno vivo fica fora do ADR-191).
    await d.repos.turnos.assentar(t!.id, { estado: "concluido" });
    const q = await d.repos.quadros.doAgente(agenteId);
    return { agenteId, conversaId, propostaId: r.data.proposta_id, quadroId: q!.id };
  });
}

async function esperandoLock(n: number, prazoMs = 5_000): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
    if ((l?.n ?? 0) >= n) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

describeIntegracao("Confirmar o card e mandar mensagem ao mesmo tempo (QA r175, ADR-191)", () => {
  afterEach(async () => {
    await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
  });

  it("nenhuma das duas cai em deadlock: o Confirmar aplica e a mensagem entra", { timeout: 40_000 }, async () => {
    const c = await cenario();
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let travou!: () => void;
    const quadroTravado = new Promise<void>((ok) => (travou = ok));
    // 1) alguém segura o quadro (a janela entre travar a proposta e fechar a decisão no Confirmar)
    const t0 = escopado(async (trx) => {
      await trx`select id from quadros where id = ${c.quadroId} for update`;
      travou();
      await segura;
    });
    await quadroTravado;
    // 2) o Confirmar trava a proposta e espera o quadro
    const t1 = escopado((trx) => decidirColunasDoQuadro(depsDe(trx), { decisaoId: c.propostaId, recusar: false, executor: "catcher" })).then(() => "ok", (e: unknown) => String((e as Error).message ?? e));
    expect(await esperandoLock(1)).toBe(true);
    // 3) a mensagem nova da pessoa na mesma conversa
    const t2 = escopado((trx) => enviarMensagem(depsDe(trx), { conversaId: c.conversaId, texto: "valeu, e as encomendas?", inventario: PRONTO })).then(() => "ok", (e: unknown) => String((e as Error).message ?? e));
    // Na `main` a mensagem trava a decisão e fica esperando a proposta (2 em espera); com a correção ela não espera e entra.
    await Promise.race([esperandoLock(2, 2_000), t2]);
    soltar();
    await t0;
    const [r1, r2] = await Promise.all([t1, t2]);
    expect({ confirmar: r1, mensagem: r2 }).toEqual({ confirmar: "ok", mensagem: "ok" });
    const final = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const msgs = await repos.mensagens.listarDaConversa(c.conversaId);
      return {
        estado: (await repos.propostas.buscar(c.propostaId))?.estado,
        trocadas: msgs.filter((m) => m.texto.startsWith("Colunas trocadas")).length,
        dispensados: msgs.filter((m) => m.payload?.kind === "pedido_dispensado").length,
      };
    });
    // O clique veio primeiro: vale o Confirmar, e o pedido não vira "seguiu sem responder".
    expect(final).toEqual({ estado: "confirmada", trocadas: 1, dispensados: 0 });
  });
});

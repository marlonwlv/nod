import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { concederLote } from "../../src/use-cases/conceder.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA-121: "Permitir" um acesso (card ou chat) no mesmo instante em que o bot é excluído, em transações reais. O excluir
 * apaga as concessões do bot, mas a concessão que estava sendo gravada não via a exclusão e ficava no bot excluído — e
 * o Restaurar devolvia esse acesso, contra a ADR-034 (restaurar não devolve concessões).
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const agentes: string[] = [];
const conversas: string[] = [];
const cap = (nome: string): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint: true });

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

async function alguemEsperandoLock(prazoMs: number): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const [l] = await db<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
    if ((l?.n ?? 0) > 0) return true;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  return false;
}

afterEach(async () => {
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: agentes.splice(0), conversas: conversas.splice(0) });
});

describeIntegracao("conceder acesso enquanto o bot é excluído (QA-121)", () => {
  it("o bot excluído fica sem concessão, e o Restaurar não devolve o acesso", async () => {
    const { agenteId, conectorId } = await escopado(async (trx) => {
      const bot = await agenteComConversa(trx, PESSOA, { nome: "Vera R121" });
      agentes.push(bot.agenteId);
      conversas.push(bot.conversaId);
      const d = depsDe(trx);
      const criado = await d.repos.conectores.criar({ nome: "Fixture R121", slug: `r121-${bot.agenteId}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      const conector = await d.repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("ler"), cap("listar")], agora: Date.now() });
      return { agenteId: bot.agenteId, conectorId: conector?.id ?? "" };
    });

    // 1) "Permitir" começa: já leu o bot (vivo) e para antes de gravar a concessão.
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let leu!: () => void;
    const lido = new Promise<void>((ok) => (leu = ok));
    const conceder = escopado(async (trx) => {
      const d = depsDe(trx);
      const doAgente = d.repos.concessoes.doAgente.bind(d.repos.concessoes);
      d.repos.concessoes.doAgente = async (...a) => { const r = await doAgente(...a); leu(); await segura; return r; };
      return concederLote(d, { agenteId, conectorId, capacidades: ["ler", "listar"] });
    }).then(() => "ok" as const, (e: unknown) => (e as { codigo?: string }).codigo ?? String(e));
    await lido;

    // 2) A pessoa exclui o bot no mesmo instante (lixeira da tela ou bots.excluir pelo chat).
    const excluir = escopado((trx) => gerirAgente(depsDe(trx), { agenteId, acao: "excluir" }));
    await alguemEsperandoLock(1_500);
    soltar();
    const [desfecho] = await Promise.all([conceder, excluir]);
    // Com a trava, o Permitir termina antes e o excluir apaga o que ele gravou (ou, se o excluir vier antes, o Permitir é recusado).
    expect(["ok", "nao_encontrado"]).toContain(desfecho);

    const [bot] = await dbDono<{ excluido_em: Date | null }[]>`select excluido_em from agentes where id = ${agenteId}`;
    expect(bot?.excluido_em).not.toBeNull();
    const restantes = await escopado((trx) => trx<{ capacidade: string }[]>`select capacidade from concessoes where agente_id = ${agenteId}`);
    expect(restantes.map((c) => c.capacidade)).toEqual([]);

    // 3) Restaurar não devolve acesso (ADR-034).
    await escopado((trx) => gerirAgente(depsDe(trx), { agenteId, acao: "restaurar" }));
    const depois = await escopado((trx) => trx<{ n: number }[]>`select count(*)::int as n from concessoes where agente_id = ${agenteId}`);
    expect(depois[0]?.n).toBe(0);
  });

  it("conceder a um bot já excluído é recusado e não grava nada", async () => {
    const { agenteId, conectorId } = await escopado(async (trx) => {
      const bot = await agenteComConversa(trx, PESSOA, { nome: "Lia R121" });
      agentes.push(bot.agenteId);
      conversas.push(bot.conversaId);
      const d = depsDe(trx);
      const criado = await d.repos.conectores.criar({ nome: "Fixture R121b", slug: `r121b-${bot.agenteId}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      const conector = await d.repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("ler")], agora: Date.now() });
      return { agenteId: bot.agenteId, conectorId: conector?.id ?? "" };
    });
    await escopado((trx) => gerirAgente(depsDe(trx), { agenteId, acao: "excluir" }));
    await expect(escopado((trx) => concederLote(depsDe(trx), { agenteId, conectorId, capacidades: ["ler"] }))).rejects.toMatchObject({ codigo: "nao_encontrado" });
    const [n] = await escopado((trx) => trx<{ n: number }[]>`select count(*)::int as n from concessoes where agente_id = ${agenteId}`);
    expect(n?.n).toBe(0);
  });
});

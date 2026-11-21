import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { definirNivelDoBot } from "../../src/use-cases/acoes/acessos.ts";
import { concederLote } from "../../src/use-cases/conceder.ts";
import { revogarLote } from "../../src/use-cases/revogar.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * QA r187: "Revogar" do grupo (app · nível) na tela ao mesmo tempo que outra mudança dos mesmos acessos, em transações
 * reais. O revogar da tela não pegava a trava (agente, conector) que o executor dos acessos (tela e gerir_acessos) usa:
 * o outro lado lia o conjunto, a tela apagava, e o DELETE do outro voltava 0 → "concessão de outra pessoa" (404) e o
 * lote inteiro voltava atrás. E o grupo com uma concessão que já saiu (outra aba, o chat) recusava o grupo todo.
 */
const PESSOA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];

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
const desfecho = (p: Promise<unknown>): Promise<string> => p.then(() => "ok", (e: unknown) => { const x = e as { codigo?: string; code?: string; message?: string }; return x.codigo ?? x.code ?? x.message ?? "erro"; });

async function preparar(): Promise<{ app: string; bot: string; ids: string[] }> {
  return escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    const c = await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!c) throw new Error("conector");
    await repos.conectores.registrarSonda(c.id, { ok: true, catalogo: CATALOGO, agora: Date.now() });
    const bot = randomUUID();
    await repos.agentes.criar({ id: bot, nome: "Ana", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
    await repos.conversas.criar({ id: randomUUID(), tipo: "propria", agenteId: bot });
    const d = depsDe(trx);
    await concederLote(d, { agenteId: bot, conectorId: c.id, capacidades: CATALOGO.map((x) => x.nome), autorTipo: "pessoa" });
    const ids = (await repos.concessoes.doAgente(bot)).filter((x) => x.conectorId === c.id && x.capacidade !== "GMAIL_SEND_EMAIL").map((x) => x.id);
    return { app: c.id, bot, ids };
  });
}

const restantes = (app: string, bot: string) => escopado(async (trx) => (await criarRepos(trx, PESSOA).concessoes.doAgente(bot)).filter((x) => x.conectorId === app).map((x) => x.capacidade).sort());
const registros = (bot: string) => escopado(async (trx) => (await trx<{ n: number }[]>`select count(*)::int as n from mensagens m join conversas c on c.id = m.conversa_id where c.agente_id = ${bot} and m.assunto = 'acesso.revogado'`)[0]?.n ?? 0);

afterEach(async () => {
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    await trx`delete from acessos_definidos where owner_id = ${PESSOA.pessoaId}`;
  });
  await limparPessoaE2E(db, dbDono, PESSOA, { agentes: [], conversas: [] });
});

describeIntegracao("Revogar do grupo ao mesmo tempo que outra mudança dos acessos (QA r187)", () => {
  it("Revogar o grupo de leitura enquanto outra aba põe a Ana em Nenhum: nenhum dos dois falha", async () => {
    const { app, bot, ids } = await preparar();
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let leu!: () => void;
    const lido = new Promise<void>((ok) => (leu = ok));
    const nenhum = escopado(async (trx) => {
      const d = depsDe(trx);
      const doAgente = d.repos.concessoes.doAgente.bind(d.repos.concessoes);
      d.repos.concessoes.doAgente = async (...a) => { const r = await doAgente(...a); leu(); await segura; return r; };
      await definirNivelDoBot(d, { agenteId: bot, conectorId: app, nivel: "nenhum" });
    });
    await lido;
    const revogar = escopado((trx) => revogarLote(depsDe(trx), { agenteId: bot, concessaoIds: ids }));
    await new Promise((ok) => setTimeout(ok, 300));
    soltar();
    const r = await Promise.all([desfecho(nenhum), desfecho(revogar)]);
    expect(r).toEqual(["ok", "ok"]);
    expect(await restantes(app, bot)).toEqual([]);
  });

  it("Revogar o grupo duas vezes (duplo clique, duas abas): a segunda não é erro e não escreve outro registro", async () => {
    const { app, bot, ids } = await preparar();
    const r = await Promise.all([desfecho(escopado((trx) => revogarLote(depsDe(trx), { agenteId: bot, concessaoIds: ids }))), desfecho(escopado((trx) => revogarLote(depsDe(trx), { agenteId: bot, concessaoIds: ids })))]);
    expect(r).toEqual(["ok", "ok"]);
    expect(await restantes(app, bot)).toEqual(["GMAIL_SEND_EMAIL"]);
    expect(await registros(bot)).toBe(1);
  });

  it("grupo com uma concessão que já saiu (o chat tirou uma): revoga o resto em vez de recusar tudo", async () => {
    const { app, bot, ids } = await preparar();
    await escopado((trx) => revogarLote(depsDe(trx), { agenteId: bot, concessaoIds: [ids[0] ?? ""] }));
    expect(await desfecho(escopado((trx) => revogarLote(depsDe(trx), { agenteId: bot, concessaoIds: ids })))).toBe("ok");
    expect(await restantes(app, bot)).toEqual(["GMAIL_SEND_EMAIL"]);
  });
});

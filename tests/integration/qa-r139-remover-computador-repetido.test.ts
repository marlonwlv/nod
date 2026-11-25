import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasContasIa } from "../../src/adapters/http/rotas/contas-ia.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirLoteDeBots } from "../../src/use-cases/gerir-bots.ts";
import { removerComputadorPeloChat } from "../../src/use-cases/remover-computador.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA r139: remover_computador repetido abria outro card (aprovar os dois removia duas vezes) e o card aprovado depois
 * de a tela já ter removido mostrava `nao_encontrado` cru no recibo.
 */

const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
let trxAtual: Tx | null = null;
const efeitos: unknown[] = [];
const dentro: DentroDeTx = async (escopo, fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn({ ...depsSobre(trxAtual, escopo).deps, aposCommit: (e) => void efeitos.push(e) });
};
const vivas = new Set<string>();

describeIntegracao("QA r139: remover_computador repetido", () => {
  let srv: ServidorDeTeste;
  beforeAll(async () => {
    srv = await servidorDeTeste(rotasContasIa({ dentro, logins: {} as never, dispositivo: {} as never, compartilhado: true, onboardingTexto: true, avisar: () => undefined, maquinaViva: (_e, id) => vivas.has(id), plataformaDaMaquina: (_e, id) => (vivas.has(id) ? "windows" : null) }));
  });
  afterAll(() => srv.close());

  /** O começo dos dois lados: Notebook (padrão), PC do escritório e Mac; Ana presa ao Notebook, Bia solta, Caio no PC. */
  async function montar(trx: Tx, o: { sozinho?: boolean; turno?: Partial<{ entradaConfianca: "confiavel" | "nao_confiavel"; sobProcuracaoDe: string }> } = {}) {
    const { deps: d, repos } = depsSobre(trx, MARLON);
    const pc = async (nome: string, ultimoUso: number) => {
      const c = (await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
      await trx`update maquina_tokens set ultimo_uso_em = to_timestamp(${ultimoUso / 1000}) where id = ${c.id}`;
      return c.id;
    };
    const ids: Record<string, string> = { Notebook: await pc("Notebook", 3_000_000) };
    if (!o.sozinho) {
      ids["PC do escritório"] = await pc("PC do escritório", 2_000_000);
      ids["Mac"] = await pc("Mac", 1_000_000);
    }
    await d.repos.preferencias.definirMaquinaPadrao(ids.Notebook!);
    const bot = await agenteComConversa(trx, MARLON, { nome: "Faustino" });
    const bots: Record<string, string> = {};
    for (const nome of ["Ana", "Bia", "Caio"]) bots[nome] = (await agenteComConversa(trx, MARLON, { nome })).agenteId;
    await d.repos.agentes.definirMaquina([bots.Ana!], ids.Notebook!);
    if (ids["PC do escritório"]) await d.repos.agentes.definirMaquina([bots.Caio!], ids["PC do escritório"]);
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "tira o nod do notebook", entradaConfianca: o.turno?.entradaConfianca ?? "confiavel", modelo: "auto", ...(o.turno?.sobProcuracaoDe ? { sobProcuracaoDe: o.turno.sobProcuracaoDe } : {}) });
    if (!turno) throw new Error("turno");
    return { d, ids, ctx: { turnoId: turno.id, agenteId: bot.agenteId, conversaId: bot.conversaId } };
  }

  it("a mesma chamada repetida devolve o mesmo card; outra opção abre o próprio", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const pedido = { ...m.ctx, resumo: "Tirar o nod do Notebook", computador: "notebook", manter_ias: false, manter_conexao: false };
      const r1 = await removerComputadorPeloChat(m.d, pedido);
      const r2 = await removerComputadorPeloChat(m.d, pedido);
      if (!r1.data.ok || !r2.data.ok) throw new Error("recusou");
      expect(r2.data.decisao_id).toBe(r1.data.decisao_id);
      expect(r2.events ?? []).toEqual([]);
      expect((await m.d.repos.decisoes.pendentesDaConversa(m.ctx.conversaId)).filter((d) => d.tipo === "lote_bots")).toHaveLength(1);
      const r3 = await removerComputadorPeloChat(m.d, { ...pedido, manter_conexao: true });
      if (!r3.data.ok) throw new Error("recusou");
      expect(r3.data.decisao_id).not.toBe(r1.data.decisao_id);
      // Decidido o card, um novo pedido abre outro (não reaproveita o fechado).
      const doChat: unknown[] = [];
      await executar({ ...m.d, aposCommit: (e) => void doChat.push(e) }, decidirLoteDeBots, { decisaoId: r1.data.decisao_id, recusar: false });
      expect(doChat).toHaveLength(1);
      const recibos = (await trx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${m.ctx.conversaId} and assunto = 'aprovacao.recibo'`).map((x) => x.texto);
      expect(recibos).toHaveLength(1);
    });
  });

  it("card aprovado depois que a tela já removeu: o recibo diz que ele já saiu, sem código cru", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const r1 = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "Tirar o nod do Notebook", computador: "notebook", manter_ias: false, manter_conexao: false });
      if (!r1.data.ok) throw new Error("recusou");
      const t = await srv.chamar(await srv.entrar("marlon"), "POST", `/maquinas/${m.ids.Notebook}/remover`, { manterIas: false, manterConexao: false, daqui: true });
      expect(t.status).toBe(200);
      const doChat: unknown[] = [];
      await executar({ ...m.d, aposCommit: (e) => void doChat.push(e) }, decidirLoteDeBots, { decisaoId: r1.data.decisao_id, recusar: false });
      const recibo = (await trx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${m.ctx.conversaId} and assunto = 'aprovacao.recibo'`)[0]?.texto ?? "";
      expect(doChat).toEqual([]);
      expect(recibo).toContain("o computador já tinha saído da conta");
      expect(recibo).not.toContain("nao_encontrado");
    });
  });
});

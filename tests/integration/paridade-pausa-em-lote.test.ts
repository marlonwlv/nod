import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { criarRotasRotinas, type DepsRotasL7 } from "../../src/adapters/http/rotas/rotinas.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_ROTINAS } from "../../src/domain/acoes/rotinas.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { pausarTodasAsRotinas } from "../../src/use-cases/pausa-em-lote.ts";
import { pausarTodasRotinasPeloAgente, reativarLoteRotinasPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Desfazer a pausa em lote (2026-11-19, migração 0178, ADR-135): o teste de contrato de `rotinas.pausar_todas` e
 * `rotinas.reativar_lote`. A tela (POST rotinas/pausar-todas e rotinas/lotes/:id/reativar) e o chat
 * (pausar_todas_rotinas e reativar_lote_rotinas) levam o mesmo estado inicial ao mesmo estado final. O caso que motivou:
 * a pausa em lote marca só as que pausou, e desfazer volta só elas — a rotina que a pessoa já tinha pausado antes fica.
 * É o arquivo que o registro cita como `contrato`.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-19T12:36:00Z");

let trxAtual: Tx | null = null;
const txPara = (escopo: Escopo): Transacao => async (fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(trxAtual);
};

function plano(confiancaEntrada: PlanoTurno["confiancaEntrada"]): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, turnoId: "t", conversaId: "c", agenteId: "a", localidade: "local", machineId: "m", executor: "catcher", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada, profundidade: 0, catalogo: { ferramentas: [], servidores: [] },
    promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" }, politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok", expiraEm: AGORA + 60_000,
  };
}

/** Por rotina: o estado e se está num lote. Os ids de lote mudam entre os dois caminhos; o que conta é quem está junto. */
type Retrato = { estados: Record<string, string>; noLote: string[]; lotes: number };

describeIntegracao("paridade tela × chat de rotinas.pausar_todas e rotinas.reativar_lote (desfazer a pausa em lote)", () => {
  let srv: ServidorDeTeste;

  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    const deps: DepsRotasL7 = { txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => AGORA };
    srv = await servidorDeTeste(criarRotasRotinas(deps));
  });
  afterAll(() => srv.close());

  /** Dois bots: a Lia com duas ativas, o Téo com uma ativa e uma que a pessoa já tinha pausado ("antes"). */
  async function montar(trx: Tx) {
    trxAtual = trx;
    const lia = await agenteComConversa(trx, MARLON, { nome: "Lia" });
    const teo = await agenteComConversa(trx, MARLON, { nome: "Téo" });
    const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
    const nova = async (bot: { agenteId: string; conversaId: string }, nome: string, estado: "ativa" | "pausada") => {
      const r = await repos.rotinas.criar({ agenteId: bot.agenteId, conversaId: bot.conversaId, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: nome, fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA + 3_600_000, estado });
      return r?.id ?? "";
    };
    const ids = { lia1: await nova(lia, "lia1", "ativa"), lia2: await nova(lia, "lia2", "ativa"), teo: await nova(teo, "teo", "ativa"), antes: await nova(teo, "antes", "pausada") };
    const retrato = async (): Promise<Retrato> => {
      const estados: Record<string, string> = {};
      const noLote: string[] = [];
      const lotes = new Set<string>();
      for (const [nome, id] of Object.entries(ids)) {
        const x = await repos.rotinas.buscar(id);
        estados[nome] = x?.estado ?? "";
        if (x?.pausaLote) { noLote.push(nome); lotes.add(x.pausaLote.id); }
      }
      return { estados, noLote: noLote.sort(), lotes: lotes.size };
    };
    return { ids, deps, repos, ctx: { agenteId: lia.agenteId, conversaId: lia.conversaId, turnoId: randomUUID(), plano: plano("confiavel") }, retrato };
  }

  it("cobre as ações vivas da pausa em lote do registro", () => {
    const vivas = ACOES_ROTINAS.filter((a) => a.chat.estado === "vivo" && "contrato" in a.chat && a.chat.contrato === "tests/integration/paridade-pausa-em-lote.test.ts").map((a) => a.id);
    expect([...vivas].sort()).toEqual(["rotinas.pausar_todas", "rotinas.reativar_lote"]);
  });

  it("pausar todas: a rota e a ferramenta pausam as ativas num lote só e deixam de fora a que já estava pausada", async () => {
    let pelaTela: Retrato | null = null;
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", "/rotinas/pausar-todas");
      expect(r.status).toBe(200);
      pelaTela = await m.retrato();
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await pausarTodasRotinasPeloAgente(m.deps, { ...m.ctx });
      expect(r.data).toMatchObject({ pausadas: 3 });
      expect(await m.retrato()).toEqual(pelaTela);
    });
    expect(pelaTela).toEqual({ estados: { lia1: "pausada", lia2: "pausada", teo: "pausada", antes: "pausada" }, noLote: ["lia1", "lia2", "teo"], lotes: 1 });
  });

  it("reativar o lote: a rota e a ferramenta voltam só as do lote; a pausada antes e a já reativada à mão ficam como estão", async () => {
    const preparar = async (trx: Tx) => {
      const m = await montar(trx);
      const { data } = await pausarTodasAsRotinas(m.deps, {});
      // Uma das três volta à mão antes do desfazer: perde a marca e o lote passa a ter duas.
      await m.repos.rotinas.atualizarEstado(m.ids.lia2, "ativa");
      return { ...m, loteId: data.lote?.id ?? "" };
    };
    let pelaTela: Retrato | null = null;
    await withRollback(MARLON, async (trx) => {
      const m = await preparar(trx);
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", `/rotinas/lotes/${m.loteId}/reativar`);
      expect(r.status).toBe(200);
      expect(((await r.json()) as { reativadas: string[] }).reativadas.sort()).toEqual([m.ids.lia1, m.ids.teo].sort());
      pelaTela = await m.retrato();
    });
    await withRollback(MARLON, async (trx) => {
      const m = await preparar(trx);
      // Sem lote_id: a pausa em lote mais recente, como "reativa as rotinas que eu pausei sem querer".
      const r = await reativarLoteRotinasPeloAgente(m.deps, { ...m.ctx });
      expect(r.data).toMatchObject({ reativadas: 2, pausado_em: AGORA });
      expect(await m.retrato()).toEqual(pelaTela);
    });
    expect(pelaTela).toEqual({ estados: { lia1: "ativa", lia2: "ativa", teo: "ativa", antes: "pausada" }, noLote: [], lotes: 0 });
  });

  it("o chat só mexe em tudo com a pessoa no turno: pedido de outro bot ou conteúdo de fora é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const fora = { ...m.ctx, plano: plano("nao_confiavel") };
      expect((await pausarTodasRotinasPeloAgente(m.deps, fora)).data).toEqual({ erro: "nao_permitido" });
      expect((await reativarLoteRotinasPeloAgente(m.deps, fora)).data).toEqual({ erro: "nao_permitido" });
      expect((await m.retrato()).estados).toEqual({ lia1: "ativa", lia2: "ativa", teo: "ativa", antes: "pausada" });
    });
  });

  it("sem rotina ativa, pausar todas não cria lote; sem lote, reativar não mexe em nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      for (const id of [m.ids.lia1, m.ids.lia2, m.ids.teo]) await m.repos.rotinas.atualizarEstado(id, "pausada");
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", "/rotinas/pausar-todas");
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ lote: null, rotinaIds: [] });
      expect((await reativarLoteRotinasPeloAgente(m.deps, { ...m.ctx })).data).toEqual({ lote_id: null, pausado_em: null, reativadas: 0 });
      expect((await m.retrato()).noLote).toEqual([]);
    });
  });
});

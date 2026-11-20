import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente, executarRotinaPeloAgente, pausarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Issue #166 (emenda da ADR-050, 2026-11-18): a pessoa pede a um bot, ou ao Nod, para trocar o horário ou excluir a
 * rotina de OUTRO bot dela. Antes, atualizar_rotina e excluir_rotina só aceitavam a rotina do próprio bot e devolviam
 * nao_encontrado para o id certo, vindo de ver_colegas; pausar e reativar já aceitavam. Agora as quatro passam pelo mesmo
 * filtro: a própria sempre; a de um colega (ou de um bot da pessoa, quando quem pede é o Nod) só com a pessoa no turno.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
// quarta 18/11/2026 10:00 em São Paulo.
const AGORA = Date.parse("2026-11-18T10:00:00-03:00");

function plano(confiancaEntrada: PlanoTurno["confiancaEntrada"]): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, turnoId: "t", conversaId: "c", agenteId: "a", localidade: "local", machineId: "m", executor: "catcher", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada, modoTurno: "conversa", profundidade: 0, catalogo: { ferramentas: [], servidores: [] },
    promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" }, politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok", expiraEm: AGORA + 60_000,
  };
}

async function botComRotina(trx: Tx, nome: string, opcoes: { confirmado?: boolean } = {}) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  if (opcoes.confirmado !== false) await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, titulo: `PM ${nome}`, descricao: `${nome} acompanha o projeto` });
  const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "Resumo do projeto", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" });
  return { agenteId, conversaId, rotinaId: data.rotina.id };
}

/** Quem recebe o pedido da pessoa: um bot comum (colega) ou o Nod, com turno real (decisões têm FK para turnos). */
async function quemPede(trx: Tx, quem: "colega" | "nod", modo: ModoAprovacao) {
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  let agenteId: string;
  let conversaId: string;
  if (quem === "nod") {
    const { nod } = (await garantirNod(deps, {})).data;
    agenteId = nod.id;
    conversaId = nod.conversaId;
  } else {
    const b = await agenteComConversa(trx, MARLON, { nome: "Orquestra" });
    await repos.agentes.atualizarPerfil(b.agenteId, { confirmado: true, titulo: "Orquestra", descricao: "Coordena os PMs" });
    agenteId = b.agenteId;
    conversaId = b.conversaId;
  }
  await repos.agentes.definirModoAprovacao(agenteId, modo);
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "muda o horário das rotinas dos PMs", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  return { deps, repos, ctx: { agenteId, conversaId, turnoId: turno.id } };
}

describeIntegracao("rotina de outro bot a pedido da pessoa: atualizar e excluir (issue #166, emenda da ADR-050)", () => {
  it("colega no manual: atualizar a rotina de outro bot nasce proposta na conversa de quem pede, e confirmar muda a rotina do dono", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "colega", "manual");
      const r = await atualizarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId, cron: "18 9 * * 1-5" });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      expect(r.data).not.toHaveProperty("aplicada");
      expect((await q.repos.rotinas.buscar(kr.rotinaId))?.cron).toBe("0 9 * * 1-5");
      // O card fica com quem pediu: é a conversa em que a pessoa está.
      expect(await q.repos.propostas.buscar(r.data.proposta_id)).toMatchObject({ kind: "rotina_atualizacao", estado: "pendente", conversaId: q.ctx.conversaId });

      const aplicada = await aplicarAtualizacaoRotina(q.deps, { propostaId: r.data.proposta_id });
      expect(aplicada.data.rotina).toMatchObject({ id: kr.rotinaId, agenteId: kr.agenteId, cron: "18 9 * * 1-5" });
      // A conversa do dono registra a mudança.
      expect((await q.repos.mensagens.ultimaDaConversa(kr.conversaId))?.texto).toContain("Rotina atualizada.");
    });
  });

  it("colega no automático: a troca de horário vale na hora (aplicada: true), como na própria rotina", async () => {
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "colega", "automatico");
      const r = await atualizarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId, cron: "18 9 * * 1-5" });
      expect(r.data).toMatchObject({ aplicada: true });
      expect((await q.repos.rotinas.buscar(kr.rotinaId))?.cron).toBe("18 9 * * 1-5");
    });
  });

  it("sem a pessoa no turno (entrada não confiável ou sem plano), a rotina de outro bot continua nao_encontrado e nada nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "colega", "total");
      for (const p of [plano("nao_confiavel"), undefined]) {
        const ctx = { ...q.ctx, ...(p ? { plano: p } : {}), rotina_id: kr.rotinaId };
        expect((await atualizarRotinaPeloAgente(q.deps, { ...ctx, cron: "18 9 * * 1-5" })).data).toEqual({ erro: "nao_encontrado" });
        expect((await excluirRotinaPeloAgente(q.deps, ctx)).data).toEqual({ erro: "nao_encontrado" });
      }
      expect(await q.repos.propostas.pendentesDaConversa(q.ctx.conversaId)).toEqual([]);
      expect(await q.repos.rotinas.buscar(kr.rotinaId)).toMatchObject({ cron: "0 9 * * 1-5", excluidoEm: null });
    });
  });

  it("bot que não é colega (ainda sem perfil confirmado): nao_encontrado mesmo com a pessoa pedindo", async () => {
    await withRollback(MARLON, async (trx) => {
      const rascunho = await botComRotina(trx, "Rascunho", { confirmado: false });
      const q = await quemPede(trx, "colega", "total");
      expect((await atualizarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: rascunho.rotinaId, cron: "18 9 * * 1-5" })).data).toEqual({ erro: "nao_encontrado" });
      expect((await excluirRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: rascunho.rotinaId })).data).toEqual({ erro: "nao_encontrado" });
    });
  });

  it("os apps da rotina de outro bot ficam com a pessoa: atualizar com acessos novos é nao_permitido", async () => {
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "colega", "total");
      const gmail = await q.repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      if (!gmail) throw new Error("conector");
      await q.repos.conectores.registrarSonda(gmail.id, { ok: true, catalogo: [{ nome: "GMAIL_FETCH_EMAILS", descricao: "lê", schema: { type: "object" }, readOnlyHint: true }], agora: AGORA });
      await q.repos.conectores.habilitar(gmail.id, true);
      const r = await atualizarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId, acessos: [{ conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] }] });
      expect(r.data).toEqual({ erro: "nao_permitido" });
      expect(await q.repos.propostas.pendentesDaConversa(q.ctx.conversaId)).toEqual([]);
    });
  });

  it("excluir a rotina de outro bot é card também no automático; a própria, pedida na conversa, o automático exclui", async () => {
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "colega", "automatico");
      const r = await excluirRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      expect(r.data).not.toHaveProperty("aplicada");
      expect((await q.repos.rotinas.buscar(kr.rotinaId))?.excluidoEm).toBeNull();
      // A pessoa clica no card: a rotina do dono é excluída.
      const aplicada = await aplicarExclusaoRotina(q.deps, { propostaId: r.data.proposta_id });
      expect(aplicada.data.rotina.excluidoEm).not.toBeNull();

      // A própria rotina de quem pede segue a regra de antes (ADR-059): pedida na conversa, o automático aplica.
      const { data: propria } = await criarRotinaPelaPessoa(q.deps, { agenteId: q.ctx.agenteId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "Resumo", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" });
      expect((await excluirRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: propria.rotina.id })).data).toMatchObject({ aplicada: true });
    });
  });

  it("o Nod alcança a rotina de qualquer bot da pessoa: troca o horário no automático e pausa", async () => {
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "nod", "automatico");
      const r = await atualizarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId, cron: "18 9 * * 1-5" });
      expect(r.data).toMatchObject({ aplicada: true });
      expect((await q.repos.rotinas.buscar(kr.rotinaId))?.cron).toBe("18 9 * * 1-5");
      expect((await pausarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId })).data).toMatchObject({ estado: "pausada" });
    });
  });

  it("executar_rotina continua só para a rotina do próprio bot (NOD-393)", async () => {
    await withRollback(MARLON, async (trx) => {
      const kr = await botComRotina(trx, "Kira");
      const q = await quemPede(trx, "colega", "total");
      expect((await executarRotinaPeloAgente(q.deps, { ...q.ctx, plano: plano("confiavel"), rotina_id: kr.rotinaId })).data).toEqual({ erro: "nao_encontrado" });
    });
  });
});

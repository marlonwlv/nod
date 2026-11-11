import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { avisoDaEtapaNaSessao } from "../../src/use-cases/etapa-presa.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

// Regression: ISSUE-003 — partes de src/use-cases/etapa-presa.ts sem teste: o nome do BOT que moveu (o aviso e a recusa
// podiam dizer "outro bot"), a retomada da cadeia (o turno filho, não o raiz, é o que roda depois de uma volta da sessão)
// e a chave do aviso por coluna (a segunda mudança tem de gerar aviso novo). Cada mutante passava a suíte.
// Found by /qa on 2026-11-11 (QA do PR #16, ADA-302).
// Report: .gstack/qa-reports/qa-report-pr16-2026-11-11.md
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const s = Math.random().toString(36).slice(2, 7);
  const dono = await agenteComConversa(trx, MARLON, { nome: `Eng ${s}` });
  const dev = await agenteComConversa(trx, MARLON, { nome: `Dev ${s}` });
  await agenteComConversa(trx, MARLON, { nome: `Ze ${s}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId: dono.agenteId, executor: "catcher", ...p });
  const base = await lote({ autor: { tipo: "agente", agenteId: dono.agenteId }, limite: "total", ops: [
    { tipo: "criar_quadro", meta: null },
    { tipo: "definir_passagem", coluna: "A fazer", agente: `Dev ${s}`, instrucoes: "implementa" },
    { tipo: "definir_passagem", coluna: "Em revisão", agente: `Ze ${s}`, instrucoes: "revisa" },
    { tipo: "criar_tarefa", titulo: "Escrever um haiku" },
  ] });
  if (!base.data.ok) throw new Error(base.data.detalhe);
  const tid = base.data.quadro!.tarefas[0]!.id;
  const inicio = await lote({ ops: [{ tipo: "mudar_tarefa", tarefa: tid, status: "afazer" }] });
  if (!inicio.data.ok) throw new Error(inicio.data.detalhe);
  const turnoDev = inicio.data.comecaram[0]!.turnoId;
  await trx`update turnos set estado = 'despachando', despachado_em = clock_timestamp() where id = ${turnoDev}`;
  return { deps, repos, dono, dev, engNome: `Eng ${s}`, tid, turnoDev, lote };
}

describeIntegracao("etapa presa (ADA-302, QA): o nome do bot que moveu, a retomada e a chave do aviso", () => {
  it("movida por outro bot: o aviso e a recusa nomeiam esse bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ autor: { tipo: "agente", agenteId: m.dono.agenteId }, limite: "total", ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect((await avisoDaEtapaNaSessao(m.deps, m.turnoDev))?.texto).toContain(`foi movida por ${m.engNome} para Em revisão`);
      const recusa = await m.lote({ autor: { tipo: "agente", agenteId: m.dev.agenteId }, limite: "normal", turnoId: m.turnoDev, ops: [{ tipo: "terminei" }] });
      expect(!recusa.data.ok && recusa.data.detalhe).toContain(`movida por ${m.engNome} para Em revisão`);
    });
  });

  it("a retomada da cadeia também é presa e recebe o aviso; a segunda mudança de coluna troca a chave do aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const velho = (await m.repos.turnos.buscar(m.turnoDev))!;
      const filho = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: velho.conversaId, agenteId: velho.agenteId, origem: "retomada", retomaTurnoId: velho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continua", entradaConfianca: "confiavel", modelo: "auto" });
      if (!filho) throw new Error("retomada");
      const r = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "revisao" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      const primeiro = await avisoDaEtapaNaSessao(m.deps, filho.id);
      expect(primeiro?.texto).toContain("para Em revisão");
      const recusa = await m.lote({ autor: { tipo: "agente", agenteId: m.dev.agenteId }, limite: "normal", turnoId: filho.id, ops: [{ tipo: "terminei" }] });
      expect(recusa.data).toMatchObject({ ok: false, erro: "nao_permitido" });
      // A tarefa anda de novo (Em revisão → Bloqueado): o aviso é outro, com chave nova (a sessão lê cada um uma vez).
      const de_novo = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: m.tid, status: "bloqueado" }] });
      if (!de_novo.data.ok) throw new Error(de_novo.data.detalhe);
      const segundo = await avisoDaEtapaNaSessao(m.deps, filho.id);
      expect(segundo?.texto).toContain("para Bloqueado");
      expect(segundo?.chave).not.toBe(primeiro?.chave);
    });
  });
});

import { expect, it } from "vitest";
import { decisoesNoChat, aplicarExportacaoDecisoes } from "../../src/use-cases/decisoes-no-chat.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

async function turnoDe(d: Deps, agenteId: string, conversaId: string) {
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!turno) throw new Error("turno");
  return { turnoId: turno.id, agenteId, conversaId };
}

describeIntegracao("NOD-414: decisões pelo chat", () => {
  it("consulta as próprias decisões, grava card de até 4 linhas e bot comum não lê outro bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia decisões" });
      const lia = await agenteComConversa(trx, MARLON, { nome: "Lia decisões" });
      for (let i = 0; i < 6; i++) await d.repos.trilha.registrar({ agenteId: bia.agenteId, ferramenta: "github__create_issue", conectorId: null, kind: i % 2 ? "negacao" : "tool_call", motivo: i % 2 ? "retirado_pela_pessoa" : null, regra: "regra:clique", regraVersao: 1, em: Date.parse(`2026-11-13T1${i}:00:00Z`) });
      const ctx = await turnoDe(d, bia.agenteId, bia.conversaId);
      const r = await executar(d, decisoesNoChat, { ...ctx, acao: "consultar", de: "2026-11-13", ate: "2026-11-13", fuso: "UTC", desfecho: "tudo" });
      expect(r.data).toMatchObject({ ok: true, total: 6 });
      if (!r.data.ok || !("linhas" in r.data)) throw new Error("resultado");
      expect(r.data.linhas).toHaveLength(4);
      const card = (await d.repos.mensagens.listarDaConversa(bia.conversaId)).find((m) => m.payload?.kind === "decisoes_resumo");
      expect(card?.payload).toMatchObject({ kind: "decisoes_resumo", total: 6, linhas: expect.any(Array) });
      const negadas = await executar(d, decisoesNoChat, { ...ctx, acao: "consultar", de: "2026-11-13", ate: "2026-11-13", fuso: "UTC", desfecho: "negada" });
      expect(negadas.data).toMatchObject({ ok: true, total: 3 });
      const proibida = await executar(d, decisoesNoChat, { ...ctx, acao: "consultar", de: "2026-11-13", ate: "2026-11-13", fuso: "UTC", bot: "Lia decisões" });
      expect(proibida.data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      expect(lia.agenteId).not.toBe(bia.agenteId);
    });
  });

  it("exportar só cria anexos depois da confirmação e separa um período longo por mês", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia CSV" });
      await d.repos.trilha.registrar({ agenteId: bia.agenteId, ferramenta: "github__create_issue", conectorId: null, kind: "tool_call", motivo: null, regra: "regra:clique", regraVersao: 1, em: Date.parse("2026-10-15T12:00:00Z") });
      await d.repos.trilha.registrar({ agenteId: bia.agenteId, ferramenta: "terminal__bash", conectorId: null, kind: "negacao", motivo: "retirado_pela_pessoa", regra: "regra:clique", regraVersao: 1, em: Date.parse("2026-11-12T12:00:00Z") });
      const ctx = await turnoDe(d, bia.agenteId, bia.conversaId);
      const proposta = await executar(d, decisoesNoChat, { ...ctx, acao: "exportar", de: "2026-10-15", ate: "2026-11-13", fuso: "UTC", desfecho: "tudo" });
      expect(proposta.data).toMatchObject({ ok: true, estado: "pendente", arquivos: 2 });
      if (!proposta.data.ok || !("decisao_id" in proposta.data)) throw new Error("proposta");
      expect((await d.repos.anexos.daMensagens((await d.repos.mensagens.listarDaConversa(bia.conversaId)).map((m) => m.id))).size).toBe(0);
      const aplicado = await executar(d, aplicarExportacaoDecisoes, { propostaId: proposta.data.decisao_id, recusar: false });
      expect(aplicado.data.arquivos).toHaveLength(2);
      for (const id of aplicado.data.arquivos) {
        const a = await d.repos.anexos.conteudo(id);
        expect(a?.meta).toMatchObject({ mime: "text/csv", origem: "bot", mensagemId: expect.any(String) });
        expect(a?.bytes.toString("utf8")).toContain("data,hora,desfecho");
      }
    });
  });

  it("recusar não gera arquivo e mais de cinco meses pede para dividir", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia limite" });
      const ctx = await turnoDe(d, bia.agenteId, bia.conversaId);
      const longo = await executar(d, decisoesNoChat, { ...ctx, acao: "exportar", de: "2026-01-01", ate: "2026-06-01", fuso: "UTC" });
      expect(longo.data).toMatchObject({ ok: false, erro: "periodo_longo" });
      const proposta = await executar(d, decisoesNoChat, { ...ctx, acao: "exportar", de: "2026-11-01", ate: "2026-11-13", fuso: "UTC" });
      if (!proposta.data.ok || !("decisao_id" in proposta.data)) throw new Error("proposta");
      const recusado = await executar(d, aplicarExportacaoDecisoes, { propostaId: proposta.data.decisao_id, recusar: true });
      expect(recusado.data.arquivos).toEqual([]);
    });
  });
});

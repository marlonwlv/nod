import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import { decidirLoteDeBots } from "../../src/use-cases/gerir-bots.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];
const AGORA = Date.parse("2026-11-19T18:00:00-03:00");
const conjunto = async (d: Deps, agenteId: string, conectorId: string) =>
  (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conectorId).map((c) => c.capacidade).sort();

async function cenario(trx: Parameters<Parameters<typeof withRollback>[1]>[0], modo: "manual" | "automatico") {
  const d = depsSobreTrx(trx, MARLON, { relogio: () => AGORA });
  const suf = Math.random().toString(36).slice(2, 7);
  const app = await d.repos.conectores.criar({ nome: `Gmail ${suf}`, slug: `gmail-${suf}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!app) throw new Error("conector");
  await d.repos.conectores.registrarSonda(app.id, { ok: true, catalogo: CATALOGO, agora: AGORA });
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${suf}` });
  const ator = await agenteComConversa(trx, MARLON, { nome: `Ator ${suf}` });
  for (const b of [ana, ator]) await d.repos.agentes.atualizarPerfil(b.agenteId, { confirmado: true, descricao: "faz" });
  await d.repos.agentes.definirModoAprovacao(ator.agenteId, modo);
  const chat = async (args: Record<string, unknown>) => {
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ator.conversaId, agenteId: ator.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    return (await executar(d, gerirAcessos, { turnoId: t!.id, ...ator, ...args } as never)).data as Record<string, unknown>;
  };
  const recibos = async () => (await d.repos.mensagens.listarDaConversa(ator.conversaId, 50)).filter((m) => m.kind === "sistema").map((m) => m.texto);
  return { d, app, ana, ator, chat, recibos };
}

describeIntegracao("QA r106: card supervisionado do gerir_acessos", () => {
  it("Ler e alterar espera o card; aprovado aplica; recusado não aplica", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, app, ana, chat, recibos } = await cenario(trx, "manual");
      const r = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "escrita", resumo: "Ana com Ler e alterar" });
      expect(r).toMatchObject({ ok: true, esperando: true });
      expect(await conjunto(d, ana.agenteId, app.id)).toEqual([]);
      const dec = await executar(d, decidirLoteDeBots, { decisaoId: r.decisao_id as string, recusar: false });
      expect(dec.data).toMatchObject({ feitas: 1, falhas: 0 });
      expect(await conjunto(d, ana.agenteId, app.id)).toHaveLength(3);
      expect((await recibos()).join("\n")).toContain("✓ 1 bot com Ler e alterar");

      const r2 = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "nenhum", resumo: "Ana sem acesso" });
      expect(r2).toMatchObject({ ok: true, esperando: true });
      const dec2 = await executar(d, decidirLoteDeBots, { decisaoId: r2.decisao_id as string, recusar: true });
      expect(dec2.data).toMatchObject({ recusadas: 1 });
      expect(await conjunto(d, ana.agenteId, app.id)).toHaveLength(3);
    });
  });

  it("pedido repetido com o card aberto devolve o mesmo card, e não dois recibos por uma mudança", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, app, ana, ator, chat, recibos } = await cenario(trx, "manual");
      const a = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "leitura", resumo: "Ana com Ler" });
      const b = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "leitura", resumo: "Ana com Ler de novo" });
      expect(b).toMatchObject({ ok: true, esperando: true, decisao_id: a.decisao_id });
      expect(await d.repos.decisoes.pendentesDaConversa(ator.conversaId)).toHaveLength(1);
      // Outro nível é outro pedido: outro card.
      const c = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "nenhum", resumo: "Ana sem acesso" });
      expect(c.decisao_id).not.toBe(a.decisao_id);
      // Recusado o primeiro, o mesmo pedido abre um card novo.
      await executar(d, decidirLoteDeBots, { decisaoId: a.decisao_id as string, recusar: true });
      const e = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "leitura", resumo: "Ana com Ler" });
      expect(e.decisao_id).not.toBe(a.decisao_id);
      await executar(d, decidirLoteDeBots, { decisaoId: e.decisao_id as string, recusar: false });
      expect((await recibos()).filter((t) => t.includes("✓"))).toHaveLength(1);
    });
  });

  it("app desligado entre o card e o ok: o recibo diz o que fazer", async () => {
    await withRollback(MARLON, async (trx) => {
      const { d, app, ana, chat, recibos } = await cenario(trx, "manual");
      const r = await chat({ acao: "lote", app: app.nome, bots: [ana.agenteId], nivel: "escrita", resumo: "Ana com Ler e alterar" });
      await d.repos.conectores.habilitar(app.id, false);
      const dec = await executar(d, decidirLoteDeBots, { decisaoId: r.decisao_id as string, recusar: false });
      expect(dec.data).toMatchObject({ feitas: 0, falhas: 1 });
      const r1 = (await recibos()).join("\n");
      expect(r1).toContain("conecte o app antes de dar acesso");
      expect(r1).not.toContain("estado_invalido");
      expect(await conjunto(d, ana.agenteId, app.id)).toEqual([]);
    });
  });
});

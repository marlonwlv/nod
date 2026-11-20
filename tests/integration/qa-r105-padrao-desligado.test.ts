import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { EXECUTORES_ACESSOS, verAcessosDoApp } from "../../src/use-cases/acoes/acessos.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];
const LER = ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"];
const AGORA = Date.parse("2026-11-19T17:00:00-03:00");
const conjunto = async (d: Deps, agenteId: string, conectorId: string) =>
  (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conectorId).map((c) => c.capacidade).sort();

describeIntegracao("QA r105: padrão do app mudado com o app desligado", () => {
  it("quem seguia o padrão continua seguindo depois de religar: o padrão Nenhum tira o Ler da Ana", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { relogio: () => AGORA });
      const suf = Math.random().toString(36).slice(2, 7);
      const app = await d.repos.conectores.criar({ nome: `Gmail ${suf}`, slug: `gmail-${suf}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      if (!app) throw new Error("conector");
      await d.repos.conectores.registrarSonda(app.id, { ok: true, catalogo: CATALOGO, agora: AGORA });
      const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${suf}` });
      const ator = await agenteComConversa(trx, MARLON, { nome: `Ator ${suf}` });
      for (const b of [ana, ator]) await d.repos.agentes.atualizarPerfil(b.agenteId, { confirmado: true, descricao: "faz" });
      await d.repos.agentes.definirModoAprovacao(ator.agenteId, "automatico");
      const chat = async (args: Record<string, unknown>) => {
        const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ator.conversaId, agenteId: ator.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
        return (await executar(d, gerirAcessos, { turnoId: t!.id, ...ator, ...args } as never)).data;
      };
      const ver = async () => (await verAcessosDoApp(d, app.id)).bots.find((b) => b.agenteId === ana.agenteId);

      // 1) Padrão Ler pelo chat, app ligado: Ana herda.
      await chat({ acao: "padrao", app: app.nome, nivel: "leitura", resumo: "padrão Ler" });
      expect(await conjunto(d, ana.agenteId, app.id)).toEqual(LER);
      // 2) App desligado; o padrão vira Ler e alterar (pela tela, confirmado): só guarda.
      await d.repos.conectores.habilitar(app.id, false);
      const q = await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "escrita", confirmado: true });
      expect(q.data).toMatchObject({ padrao: "escrita", aplicados: [], soGuardado: true });
      expect(await conjunto(d, ana.agenteId, app.id)).toEqual(LER);
      // Ninguém escolheu a Ana: ela segue o padrão (no nível em vigor), não vira "escolha da pessoa".
      expect(await ver()).toMatchObject({ nivel: "leitura", seguePadrao: true });
      // 3) Religa e a pessoa pede pelo chat: padrão Nenhum.
      await d.repos.conectores.habilitar(app.id, true);
      const r3 = await chat({ acao: "padrao", app: app.nome, nivel: "nenhum", resumo: "padrão Nenhum" });
      expect(r3).toMatchObject({ ok: true });
      expect((r3 as { feito: string }).feito).toContain("Ana");
      expect(await conjunto(d, ana.agenteId, app.id)).toEqual([]);
    });
  });

  it("o chat não diz que os bots novos começam com Ler quando o app está desligado", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { relogio: () => AGORA });
      const suf = Math.random().toString(36).slice(2, 7);
      const app = await d.repos.conectores.criar({ nome: `Gmail ${suf}`, slug: `gmail-${suf}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      if (!app) throw new Error("conector");
      await d.repos.conectores.registrarSonda(app.id, { ok: true, catalogo: CATALOGO, agora: AGORA });
      const ator = await agenteComConversa(trx, MARLON, { nome: `Ator ${suf}` });
      await d.repos.agentes.atualizarPerfil(ator.agenteId, { confirmado: true, descricao: "faz" });
      await d.repos.agentes.definirModoAprovacao(ator.agenteId, "automatico");
      await d.repos.conectores.habilitar(app.id, false);
      const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: ator.conversaId, agenteId: ator.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
      const r = (await executar(d, gerirAcessos, { turnoId: t!.id, ...ator, acao: "padrao", app: app.nome, nivel: "leitura", resumo: "padrão Ler" } as never)).data;
      expect(r).toMatchObject({ ok: true });
      expect((r as { feito: string }).feito).toContain("o app está desligado");
      expect((r as { feito: string }).feito).not.toMatch(/^Bots novos/);
    });
  });
});

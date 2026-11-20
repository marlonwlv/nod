import { expect, it } from "vitest";
import { definirTetoModo } from "../../src/use-cases/ajustes-aprovacao.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { decidirLoteDeBots, gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA-114: o teto do modo do admin (ADR-166) corta o modo pedido pelo chat (gerir_bots mudar_modo) e pelo chip. A linha
 * na conversa do bot e o recibo do Nod dizem o modo que vale, não só o pedido.
 */

const ADMINS = [MARLON.pessoaId.toLowerCase()];

async function nodComTurno(d: Deps) {
  const { nod } = (await executar(d, garantirNod, {})).data;
  await d.repos.agentes.definirModoAprovacao(nod.id, "manual");
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!turno) throw new Error("turno");
  return { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId };
}

async function mudarPeloChat(d: Deps, modo: "automatico" | "total") {
  const ctx = await nodComTurno(d);
  const r = await gerirBots(d, { ...ctx, resumo: `Dev 1 em ${modo}`, acoes: [{ tipo: "mudar_modo", bot: "Dev 1", modo }] });
  if (!r.data.ok) throw new Error("lote recusado");
  await executar(d, decidirLoteDeBots, { decisaoId: r.data.decisao_id ?? "", recusar: false });
  const recibo = (await d.repos.mensagens.listarDaConversa(ctx.conversaId, 50)).at(-1)?.texto ?? "";
  return recibo;
}

async function linhaDoBot(d: Deps, agenteId: string) {
  const conversa = await d.repos.conversas.buscarPropriaDoAgente(agenteId);
  return conversa ? ((await d.repos.mensagens.ultimaComAssunto(conversa.id, "aprovacao.modo"))?.texto ?? "") : "";
}

describeIntegracao("QA-114: mudar_modo com o teto do admin", () => {
  it("teto Manual: o pedido Automático fica guardado, e a linha e o recibo dizem que o bot segue em Manual", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const dev = (await executar(d, criarAgente, { dono: "pessoa", nome: "Dev 1", descricao: "Dev 1 trabalha." })).data.agente;
      await d.repos.agentes.definirModoAprovacao(dev.id, "manual");
      await executar(d, definirTetoModo, { teto: "manual", admins: ADMINS });

      const recibo = await mudarPeloChat(d, "automatico");
      const depois = await d.repos.agentes.buscar(dev.id);
      expect(depois).toMatchObject({ modoAprovacao: "manual", modoPedido: "automatico" });
      const linha = await linhaDoBot(d, dev.id);
      expect(linha).toContain("o admin do time limitou os bots a Aprovar manualmente; segue em Aprovar manualmente");
      expect(linha).not.toContain("roda sem perguntar");
      expect(recibo).toContain("✓ Mudar modo Dev 1 para automatico (o admin do time limitou os bots a Aprovar manualmente");
    });
  });

  it("teto Automático corta o Total; sem teto, a linha segue a de sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const dev = (await executar(d, criarAgente, { dono: "pessoa", nome: "Dev 1", descricao: "Dev 1 trabalha." })).data.agente;
      await d.repos.agentes.definirModoAprovacao(dev.id, "manual");
      await executar(d, definirTetoModo, { teto: "automatico", admins: ADMINS });
      await mudarPeloChat(d, "total");
      expect(await d.repos.agentes.buscar(dev.id)).toMatchObject({ modoAprovacao: "automatico", modoPedido: "total" });
      expect(await linhaDoBot(d, dev.id)).toMatch(/para Ignorar todas as aprovações, mas o admin do time limitou os bots a Aprovar automaticamente; segue em Aprovar automaticamente enquanto o limite valer: roda sem perguntar/);

      await executar(d, definirTetoModo, { teto: null, admins: ADMINS });
      await d.repos.agentes.definirModoAprovacao(dev.id, "manual");
      const recibo = await mudarPeloChat(d, "automatico");
      expect(await linhaDoBot(d, dev.id)).toMatch(/para Aprovar automaticamente: roda sem perguntar/);
      expect(recibo).toContain("✓ Mudar modo Dev 1 para automatico");
      expect(recibo).not.toContain("admin");
    });
  });
});

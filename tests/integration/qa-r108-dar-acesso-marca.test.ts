import { expect, it } from "vitest";
import { EXECUTORES_ACESSOS, verAcessosDoApp } from "../../src/use-cases/acoes/acessos.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA r108: o "dar acesso" do chat (gerir_bots dar_acesso) é escolha da pessoa, como o "Dar acesso" da tela
 * (acessos.dar, que marca 'pessoa'). Sem a marca, o bot parecia seguir o padrão do app e uma troca de padrão
 * depois tirava o acesso que a pessoa tinha pedido pelo chat.
 */
const conjunto = async (d: Deps, agenteId: string, conectorId: string) =>
  (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conectorId).map((c) => c.capacidade).sort();

describeIntegracao("QA r108: dar_acesso pelo chat é escolha da pessoa", () => {
  it("padrão Nenhum → chat dá Ler ao bot → padrão Ler → padrão Nenhum: o bot fica com o Ler que a pessoa pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const suf = Math.random().toString(36).slice(2, 7);
      const { nod } = (await executar(d, garantirNod, {})).data;
      await d.repos.agentes.definirModoAprovacao(nod.id, "automatico");
      const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
      if (!turno) throw new Error("turno");
      const ctx = { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId };
      const nome = `Dev ${suf}`;
      const dev = (await executar(d, criarAgente, { dono: "pessoa", nome, descricao: "trabalha." })).data.agente;
      const slug = `gh-${suf}`;
      const app = await d.repos.conectores.criar({ nome: slug, slug, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      if (!app) throw new Error("conector");
      await d.repos.conectores.registrarSonda(app.id, { ok: true, catalogo: [{ nome: "listar", descricao: "lista", schema: { type: "object" }, readOnlyHint: true }, { nome: "comentar", descricao: "comenta", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const ver = async () => (await verAcessosDoApp(d, app.id)).bots.find((b) => b.agenteId === dev.id);

      // 1) Padrão Nenhum (os bots passam a seguir o padrão, sem acesso).
      await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "nenhum" });
      // 2) A pessoa pede pelo chat: "dá ao Dev acesso de leitura".
      const r = await gerirBots(d, { ...ctx, resumo: "Acesso", acoes: [{ tipo: "dar_acesso", bot: nome, app: slug, nivel: "leitura" }] });
      expect(r.data).toMatchObject({ ok: true, esperando: [] });
      expect(await conjunto(d, dev.id, app.id)).toEqual(["listar"]);
      expect(await ver()).toMatchObject({ nivel: "leitura", seguePadrao: false });
      // 3) e 4) Padrão Ler e, depois, Nenhum: quem a pessoa escolheu fica.
      await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "leitura" });
      await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "nenhum" });
      expect(await conjunto(d, dev.id, app.id)).toEqual(["listar"]);
    });
  });
});

import { expect, it } from "vitest";
import { EXECUTORES_ACESSOS, verAcessosDoApp } from "../../src/use-cases/acoes/acessos.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA r109: o bot que deixou de seguir o padrão do app (o card de acesso aprovado deu Ler com o padrão em Nenhum) era
 * pulado na primeira troca de padrão, mas a marca 'padrao' ficava. Na troca seguinte, o conjunto dele coincidia com o
 * padrão anterior e ele "voltava a seguir": padrão Nenhum → card aprovado (Ler) → padrão Ler → padrão Nenhum tirava o
 * Ler que a pessoa tinha aprovado no card, e a gaveta mostrava "segue o padrão" depois da primeira troca.
 */
const conjunto = async (d: Deps, agenteId: string, conectorId: string) =>
  (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conectorId).map((c) => c.capacidade).sort();

describeIntegracao("QA r109: card de acesso aprovado e duas trocas de padrão", () => {
  it("padrão Nenhum → card aprovado dá Ler → padrão Ler → padrão Nenhum: o bot fica com o Ler aprovado", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const suf = Math.random().toString(36).slice(2, 7);
      const criado = (await executar(d, criarAgente, { dono: "pessoa", nome: `Dev ${suf}`, descricao: "trabalha." })).data;
      const dev = criado.agente;
      const conversaId = criado.conversa.id;
      const slug = `gh-${suf}`;
      const app = await d.repos.conectores.criar({ nome: slug, slug, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      if (!app) throw new Error("conector");
      await d.repos.conectores.registrarSonda(app.id, { ok: true, catalogo: [{ nome: "listar", descricao: "lista", schema: { type: "object" }, readOnlyHint: true }, { nome: "comentar", descricao: "comenta", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const ver = async () => (await verAcessosDoApp(d, app.id)).bots.find((b) => b.agenteId === dev.id);

      // 1) Padrão Nenhum: o Dev passa a seguir o padrão (marca 'padrao'), sem acesso.
      await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "nenhum" });
      // 2) O Dev pede Ler pelo card e a pessoa aprova.
      const payload = { kind: "acesso" as const, conector: slug, capacidades: ["listar"], nivel: "leitura" as const, naoPedido: [] };
      const p = await d.repos.propostas.criar({ conversaId, agenteId: dev.id, payload });
      if (!p) throw new Error("proposta");
      await d.repos.decisoes.criar({ id: p.id, tipo: "acesso", agenteId: dev.id, conversaId, turnoId: null, prazoDecisaoEm: Date.now() + 600_000, frase: "Dev precisa ler" });
      await executar(d, decidirAcesso, { decisaoId: p.id, recusar: false, executor: "catcher" });
      expect(await conjunto(d, dev.id, app.id)).toEqual(["listar"]);
      expect(await ver()).toMatchObject({ nivel: "leitura", seguePadrao: false });

      // 3) Padrão Ler: o Dev não segue o padrão (foi aprovado à parte) e a gaveta continua dizendo isso.
      await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "leitura" });
      expect(await ver()).toMatchObject({ nivel: "leitura", seguePadrao: false });
      // 4) Padrão Nenhum: o Ler aprovado no card fica.
      await executar(d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: app.id, nivel: "nenhum" });
      expect(await conjunto(d, dev.id, app.id)).toEqual(["listar"]);
    });
  });
});

import { expect, it } from "vitest";
import type { AcaoLote } from "../../src/contracts/ferramentas-do-nod.ts";
import { EXECUTORES_BOTS } from "../../src/use-cases/acoes/bots.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA-119: o restaurar_versao do gerir_bots devolvia ao bot um nome que outro bot da pessoa já tinha pegado. Vera vira
 * Lia, nasce outra Vera, e "restaurar a versão 1 da Lia" deixa duas Vera: o chat passa a cair em "há mais de um bot".
 */
describeIntegracao("gerir_bots restaurar_versao não repete nome (QA-119)", () => {
  async function nodQueFaz(d: Deps) {
    const { nod } = (await executar(d, garantirNod, {})).data;
    await d.repos.agentes.definirModoAprovacao(nod.id, "total");
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId: nod.id, conversaId: nod.conversaId };
  }
  const bot = async (d: Deps, nome: string) => (await executar(d, criarAgente, { dono: "pessoa", nome, descricao: `${nome} trabalha.` })).data.agente;
  const vivosChamados = async (d: Deps, nome: string) =>
    (await d.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === MARLON.pessoaId && a.excluidoEm == null && a.nome.trim().toLowerCase() === nome.toLowerCase()).length;
  const lote = async (d: Deps, acoes: AcaoLote[]) => (await gerirBots(d, { ...(await nodQueFaz(d)), resumo: "teste", acoes })).data;

  it("restaurar a versão com um nome que outro bot pegou recusa e não muda o bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const a = await bot(d, "Vera R119");
      await executar(d, EXECUTORES_BOTS["bots.editar"], { agenteId: a.id, nome: "Lia R119" });
      await bot(d, "Vera R119");
      const r = await lote(d, [{ tipo: "restaurar_versao", bot: a.id, versao: 1 }]);
      expect(await vivosChamados(d, "Vera R119")).toBe(1);
      expect((await d.repos.agentes.buscar(a.id))?.nome).toBe("Lia R119");
      expect(JSON.stringify(r)).toMatch(/nome|Vera R119/);
    });
  });

  it("restaurar a versão cujo nome está livre continua funcionando", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const a = await bot(d, "Teo R119");
      await executar(d, EXECUTORES_BOTS["bots.editar"], { agenteId: a.id, nome: "Ravi R119" });
      await lote(d, [{ tipo: "restaurar_versao", bot: a.id, versao: 1 }]);
      expect((await d.repos.agentes.buscar(a.id))?.nome).toBe("Teo R119");
    });
  });

  it("restaurar só a missão, com o nome de agora, não recusa por nome", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const a = await bot(d, "Iris R119");
      await executar(d, EXECUTORES_BOTS["bots.editar"], { agenteId: a.id, descricao: "Missão nova." });
      await lote(d, [{ tipo: "restaurar_versao", bot: a.id, versao: 1 }]);
      expect((await d.repos.agentes.buscar(a.id))?.descricao).toBe("Iris R119 trabalha.");
    });
  });
});

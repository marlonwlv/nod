import { expect, it } from "vitest";
import type { AcaoLote } from "../../src/contracts/ferramentas-do-nod.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA-118: o gerir_bots do Nod (criar, editar nome) não pode deixar dois bots da pessoa com o mesmo nome. O chat resolve
 * bot por nome (resolverBot, pedir_a_bot): com dois "Vera", o próximo pedido cai em "há mais de um bot chamado". O
 * criar_bots dos bots comuns já recusa (ADR-104); o Nod precisa da mesma regra.
 */
describeIntegracao("gerir_bots não cria nome repetido (QA-118)", () => {
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

  it("criar com o nome de um bot que já existe recusa e não cria", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      await bot(d, "Vera R118");
      const r = await lote(d, [{ tipo: "criar", nome: "vera r118", descricao: "Outra Vera." }]);
      expect(r.ok).toBe(false);
      expect(await vivosChamados(d, "Vera R118")).toBe(1);
    });
  });

  it("editar o nome para o de outro bot recusa e não renomeia", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      await bot(d, "Vera R118");
      await bot(d, "Lia R118");
      const r = await lote(d, [{ tipo: "editar", bot: "Lia R118", nome: "Vera R118" }]);
      expect(r.ok).toBe(false);
      expect(await vivosChamados(d, "Vera R118")).toBe(1);
      expect(await vivosChamados(d, "Lia R118")).toBe(1);
    });
  });

  it("dois criar com o mesmo nome no mesmo lote recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const r = await lote(d, [{ tipo: "criar", nome: "Ugo R118", descricao: "a" }, { tipo: "criar", nome: "Ugo R118", descricao: "b" }]);
      expect(r.ok).toBe(false);
      expect(await vivosChamados(d, "Ugo R118")).toBe(0);
    });
  });

  it("editar o nome do próprio bot só na caixa continua valendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      await bot(d, "Vera R118");
      const r = await lote(d, [{ tipo: "editar", bot: "Vera R118", nome: "VERA R118" }]);
      expect(r.ok).toBe(true);
    });
  });
});

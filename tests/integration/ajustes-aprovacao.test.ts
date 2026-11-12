import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { apagarRegraRevisor, criarRegraRevisor, definirNivelFerramenta, definirSoLeitura, definirTetoModo, editarRegraRevisor, lerAjustesAprovacao } from "../../src/use-cases/ajustes-aprovacao.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-166 (0173): Ajustes > Aprovações no Postgres — as regras do revisor (padrão e do bot, 20 por lista), o nível por app,
 * o só leitura do bot e o teto do admin (linha 'equipe', lida por todo o tenant), com a RLS de cada uma.
 */
const ADMINS = [MARLON.pessoaId.toLowerCase()];

describeIntegracao("Ajustes > Aprovações (ADR-166)", () => {
  it("regras: cria no padrão e no bot, recusa a repetida e a 21ª, edita e apaga; a Ana não vê as do Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const bot = await agenteComConversa(trx, MARLON, { nome: "Dante", modo: "automatico" });
      const p = (await executar(d, criarRegraRevisor, { agenteId: null, lista: "perguntar", texto: "Qualquer pagamento" })).data.regra;
      await executar(d, criarRegraRevisor, { agenteId: bot.agenteId, lista: "permitir", texto: "Rodar testes nas worktrees do nod" });
      await expect(executar(d, criarRegraRevisor, { agenteId: null, lista: "perguntar", texto: "qualquer pagamento." })).rejects.toBeInstanceOf(ErroDeDominio);
      for (let i = 1; i < 20; i++) await executar(d, criarRegraRevisor, { agenteId: null, lista: "perguntar", texto: `Regra ${i}` });
      await expect(executar(d, criarRegraRevisor, { agenteId: null, lista: "perguntar", texto: "A vigésima primeira" })).rejects.toBeInstanceOf(ErroDeDominio);
      // A lista do bot é outra: o limite conta por alcance.
      await executar(d, criarRegraRevisor, { agenteId: bot.agenteId, lista: "perguntar", texto: "A do bot" });

      const lidos = (await executar(d, lerAjustesAprovacao, { agenteId: bot.agenteId, admins: [] })).data;
      expect(lidos.regras.padrao.filter((r) => r.lista === "perguntar")).toHaveLength(20);
      expect(lidos.regras.doBot.map((r) => r.texto).sort()).toEqual(["A do bot", "Rodar testes nas worktrees do nod"]);
      expect(lidos.modoPedido).toBe("automatico");

      expect((await executar(d, editarRegraRevisor, { regraId: p.id, texto: "Qualquer pagamento ou compra" })).data.regra.texto).toBe("Qualquer pagamento ou compra");
      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        const dAna = depsSobreTrx(sp, ANA);
        expect(await dAna.repos.ajustesAprovacao.regras()).toEqual([]);
        await expect(executar(dAna, apagarRegraRevisor, { regraId: p.id })).rejects.toBeInstanceOf(ErroDeDominio);
        await expect(executar(dAna, criarRegraRevisor, { agenteId: bot.agenteId, lista: "permitir", texto: "x" })).rejects.toBeInstanceOf(ErroDeDominio);
      });
      // set_config(..., true) sobrevive ao fim do savepoint: o escopo volta ao Marlon à mão (como em times.test.ts).
      await vincularEscopo(trx, MARLON);
      expect((await executar(d, apagarRegraRevisor, { regraId: p.id })).data.apagada).toBe(true);
    });
  });

  it("níveis: grava por app e tipo, 'revisor' apaga a linha, slug fora do formato é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const slug = (await trx<{ slug: string }[]>`select slug from conectores where tenant_id = ${MARLON.tenantId} limit 1`)[0]?.slug;
      if (!slug) return; // sem conector no banco de teste: o domínio já cobre a precedência
      await executar(d, definirNivelFerramenta, { agenteId: null, conector: slug, tipo: "escrita", nivel: "sempre_pedir" });
      await executar(d, definirNivelFerramenta, { agenteId: null, conector: slug, tipo: "escrita", nivel: "bloqueado" });
      expect(await d.repos.ajustesAprovacao.niveis()).toEqual([{ agenteId: null, conector: slug, ferramenta: "", tipo: "escrita", nivel: "bloqueado" }]);
      await executar(d, definirNivelFerramenta, { agenteId: null, conector: slug, tipo: "escrita", nivel: "revisor" });
      expect(await d.repos.ajustesAprovacao.niveis()).toEqual([]);
      await expect(executar(d, definirNivelFerramenta, { agenteId: null, conector: "Slack!", tipo: "escrita", nivel: "bloqueado" })).rejects.toBeInstanceOf(ErroDeDominio);
    });
  });

  it("só leitura e teto: o efetivo vem no agente; o teto do admin vale para a Ana; quem não é admin não muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const bot = await agenteComConversa(trx, MARLON, { nome: "Teo", modo: "total" });
      await executar(d, definirSoLeitura, { agenteId: bot.agenteId, soLeitura: true });
      expect((await d.repos.agentes.buscar(bot.agenteId))?.soLeitura).toBe(true);

      await executar(d, definirTetoModo, { teto: "manual", admins: ADMINS });
      const a = await d.repos.agentes.buscar(bot.agenteId);
      expect(a?.modoAprovacao).toBe("manual");
      expect(a?.modoPedido).toBe("total");
      await expect(executar(d, definirTetoModo, { teto: "manual", admins: [] })).rejects.toBeInstanceOf(ErroDeDominio);

      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        const dAna = depsSobreTrx(sp, ANA);
        expect(await dAna.repos.ajustesAprovacao.teto()).toBe("manual");
        // A Ana não apaga o teto do Marlon (DELETE de quem não é a dona afeta zero linhas).
        await dAna.repos.ajustesAprovacao.definirTeto(null);
        expect(await dAna.repos.ajustesAprovacao.teto()).toBe("manual");
      });
      await vincularEscopo(trx, MARLON);
      await executar(d, definirTetoModo, { teto: null, admins: ADMINS });
      expect((await d.repos.agentes.buscar(bot.agenteId))?.modoAprovacao).toBe("total");
    });
  });
});

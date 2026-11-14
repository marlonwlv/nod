import { expect, it } from "vitest";
import { aplicarLoteQuadro, montarQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Q5 (definido em 2026-11-12, fase 0 da migração do front): o montarQuadro lê os nomes dos bots e das pessoas num lote
 * por tabela, não um `buscar` por id no laço (a N+1), e o quadro sai igual.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-11-12T12:00:00Z");

describeIntegracao("montarQuadro em lote (Q5)", () => {
  it("os nomes de 4 bots saem de UMA leitura em lote; nenhum buscar por id", async () => {
    await withRollback(MARLON, async (trx) => {
      const sufixo = Math.random().toString(36).slice(2, 7);
      const bots = await Promise.all(["Ana", "Beto", "Caio", "Dora"].map((n) => agenteComConversa(trx, MARLON, { nome: `${n} ${sufixo}` })));
      const [ana] = bots;
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      await repos.preferencias.gravar({ experimentos: { quadro: true } });
      const lote = (p: Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "agente", agenteId: ana!.agenteId }, executor: "catcher", limite: "total", ...p });
      const r = await lote({ ops: [{ tipo: "criar_quadro", meta: "x" }, ...["Beto", "Caio", "Dora"].map((n) => ({ tipo: "criar_tarefa" as const, titulo: `Tarefa de ${n}`, agente: `${n} ${sufixo}`, status: "backlog" as const }))] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      const q = await repos.quadros.doAgente(ana!.agenteId);
      if (!q) throw new Error("sem quadro");

      let porId = 0;
      let emLote = 0;
      const agentes = deps.repos.agentes;
      const pessoas = deps.repos.pessoas;
      const contado = {
        ...deps,
        repos: {
          ...deps.repos,
          agentes: { ...agentes, buscar: (...a: Parameters<typeof agentes.buscar>) => (porId++, agentes.buscar(...a)), buscarVarios: (...a: Parameters<typeof agentes.buscarVarios>) => (emLote++, agentes.buscarVarios(...a)) },
          pessoas: { ...pessoas, buscar: (...a: Parameters<typeof pessoas.buscar>) => (porId++, pessoas.buscar(...a)) },
        },
      };
      const dto = await montarQuadro(contado, q);
      expect(porId, "buscar por id dentro do montarQuadro").toBe(0);
      expect(emLote).toBe(1);
      expect(dto.agenteNome).toBe(`Ana ${sufixo}`);
      expect(dto.tarefas.map((t) => [t.titulo, t.agenteNome])).toEqual([["Tarefa de Beto", `Beto ${sufixo}`], ["Tarefa de Caio", `Caio ${sufixo}`], ["Tarefa de Dora", `Dora ${sufixo}`]]);
      // O mesmo quadro que a leitura de sempre devolve.
      expect(dto).toEqual(await montarQuadro(deps, q));
    });
  });
});

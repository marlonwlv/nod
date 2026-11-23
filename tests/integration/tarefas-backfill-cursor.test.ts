import { expect, it } from "vitest";
import { backfillTarefasLote } from "../../src/use-cases/backfill-tarefas.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA-195: o cursor do backfill guarda `criado_em` em milissegundos, mas o Postgres grava microssegundos. O último
 * trabalho de um lote cheio (criado em .123456) fica depois do cursor (.123) e volta no lote seguinte: a simulação
 * conta o mesmo trabalho duas vezes, e o que não liga (fora) é processado de novo a cada lote.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("cursor do backfill das Tarefas (QA-195)", () => {
  it("com criado_em em microssegundos, cada trabalho é lido uma vez só, em simulação e aplicando", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { deps } = depsSobre(trx, MARLON);
      const ids: string[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const { trabalho } = await criarTrabalho(deps, { agenteId: ada.agenteId, conversaId: ada.conversaId, titulo: `Antigo ${i}`, origem: "pessoa", forma: "frente" });
        // Hora com microssegundos (como o default now() grava): segundos inteiros + 0,000456 s.
        await trx`update trabalhos set criado_em = now() - interval '2 hours' + make_interval(secs => ${i + 0.000456}) where id = ${trabalho.id}`;
        ids.push(trabalho.id);
      }
      const rodar = async (aplicar: boolean) => {
        let cursor: { criadoEm: number; id: string } | null = null;
        let lidos = 0;
        let lotes = 0;
        do {
          const r = await backfillTarefasLote(deps, { depois: cursor, limite: 2, aplicar });
          lidos += r.lidos;
          lotes += 1;
          cursor = r.cursor;
        } while (cursor && lotes < 20);
        return { lidos, lotes };
      };
      expect(await rodar(false)).toEqual({ lidos: 5, lotes: 3 });
      expect(await rodar(true)).toEqual({ lidos: 5, lotes: 3 });
      const ligados = await trx<{ n: number }[]>`select count(*)::int as n from trabalhos where id = any(${ids}::uuid[]) and tarefa_objetivo_id is not null`;
      expect(ligados[0]!.n).toBe(5);
      expect(await rodar(true)).toEqual({ lidos: 0, lotes: 1 });
    });
  });
});

import { expect, it } from "vitest";
import { medidaVazia, medirTarefasDaPessoa, relatorioDeTarefas, somarMedidas } from "../../scripts/medir-tarefas.ts";
import { abrirTarefaDaPessoa } from "../../src/use-cases/coordenar-trabalhos.ts";
import { devolverResumo } from "../../src/use-cases/frentes.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** ADR-192, etapa 0 (definido em 2026-11-22): a régua da migração das Tarefas (scripts/medir-tarefas.ts). */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("medir-tarefas (etapa 0)", () => {
  it("conta trabalhos por origem/forma/estado, as terminadas e as que terminaram com 'falta'", async () => {
    await withRollback(MARLON, async (trx) => {
      const antes = await medirTarefasDaPessoa(trx, MARLON);
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const a = (await abrirTarefaDaPessoa(deps, { agenteId: ada.agenteId, texto: "Primeira tarefa" })).data;
      const b = (await abrirTarefaDaPessoa(deps, { agenteId: ada.agenteId, texto: "Segunda tarefa" })).data;
      await devolverResumo(deps, { turnoId: a.turnoId, agenteId: ada.agenteId, conversaId: ada.conversaId, feito: "Metade", falta: "a outra metade" });
      for (const r of [a, b]) {
        await repos.turnos.assentar(r.turnoId, { estado: "concluido" });
        await sincronizarTrabalho(deps, r.trabalho.id);
      }
      const depois = await medirTarefasDaPessoa(trx, MARLON);
      expect(depois.tarefasTerminadas - antes.tarefasTerminadas).toBe(2);
      expect(depois.tarefasTerminadasComFalta - antes.tarefasTerminadasComFalta).toBe(1);
      const n = (m: typeof depois) => m.trabalhos.find((c) => c.origem === "pessoa" && c.forma === "frente" && c.estado === "terminado")?.n ?? 0;
      expect(n(depois) - n(antes)).toBe(2);
      const linhas = relatorioDeTarefas(depois, "teste");
      expect(linhas.join("\n")).toContain('com "falta" no resumo');
      // Só números: nenhum título vai ao relatório.
      expect(linhas.join("\n")).not.toContain("Primeira tarefa");
    });
  });

  it("somarMedidas junta as contagens por chave", () => {
    const a = { ...medidaVazia(), trabalhos: [{ origem: "pessoa", forma: "frente", estado: "terminado", n: 2 }], cards: 1 };
    const b = { ...medidaVazia(), trabalhos: [{ origem: "pessoa", forma: "frente", estado: "terminado", n: 3 }, { origem: "rotina", forma: "task", estado: "rodando", n: 1 }], cards: 2, tarefas: [{ estado: "entregue", n: 4 }], threads: 4, trabalhosLigados: 4 };
    const s = somarMedidas(a, b);
    expect(s.trabalhos).toEqual([{ origem: "pessoa", forma: "frente", estado: "terminado", n: 5 }, { origem: "rotina", forma: "task", estado: "rodando", n: 1 }]);
    expect(s).toMatchObject({ cards: 3, tarefas: [{ estado: "entregue", n: 4 }], threads: 4, trabalhosLigados: 4 });
    expect(somarMedidas(medidaVazia(), medidaVazia())).toMatchObject({ tarefas: null, threads: null });
  });
});

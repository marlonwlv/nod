import { expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { abrirTarefaDaPessoa } from "../../src/use-cases/coordenar-trabalhos.ts";
import { renomearTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-187 §6 (lote B, passo 3, 2026-11-18): a pessoa renomeia a tarefa na própria aba. Só o título muda (a pasta fica), com
 * a mesma regra do nascimento, e o frame `trabalho_mudou` avisa as telas.
 */
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("renomear a tarefa pela aba (ADR-187 §6)", () => {
  it("troca o título, mantém a pasta e avisa as telas", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const bot = await agenteComConversa(trx, ESCOPO, { nome: "Bot das abas" });
      const { deps, repos } = depsSobre(trx, ESCOPO);
      const t = (await abrirTarefaDaPessoa(deps, { agenteId: bot.agenteId, texto: "Escreva o texto da landing do produto novo" })).data.trabalho;
      const r = await renomearTrabalho(deps, { trabalhoId: t.id, titulo: "  Revisão da landing\nsegunda linha some" });
      expect(r.data.trabalho).toMatchObject({ id: t.id, titulo: "Revisão da landing", pasta: t.pasta });
      expect((await repos.trabalhos.buscar(t.id))?.titulo).toBe("Revisão da landing");
      expect(r.events?.map((e) => e.kind)).toEqual(["trabalho_mudou"]);
    });
  });

  it("título sem letra é entrada inválida; id de outra tarefa, não encontrado", async () => {
    await withRollback(ESCOPO, async (trx) => {
      const bot = await agenteComConversa(trx, ESCOPO, { nome: "Bot das abas" });
      const { deps } = depsSobre(trx, ESCOPO);
      const t = (await abrirTarefaDaPessoa(deps, { agenteId: bot.agenteId, texto: "Revise o contrato" })).data.trabalho;
      await expect(renomearTrabalho(deps, { trabalhoId: t.id, titulo: "   " })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(renomearTrabalho(deps, { trabalhoId: "00000000-0000-4000-8000-000000000000", titulo: "Outro" })).rejects.toBeInstanceOf(ErroDeDominio);
    });
  });
});

import { expect, it } from "vitest";
import { abrirTarefaDaPessoa } from "../../src/use-cases/coordenar-trabalhos.ts";
import { detalharTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * QA-201 (2026-11-23): a frota não traz o bot excluído, e a tela da tarefa dele oferecia o campo ("continue a conversa com
 * o bot") que o servidor recusa. O detalhe da tarefa diz que o bot saiu, com o nome, para a tela não oferecer o envio.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("QA-201: detalhe da tarefa de um bot excluído", () => {
  it("leva botExcluido com o nome; com o bot ativo (ou restaurado), não leva", async () => {
    await withRollback(MARLON, async (trx) => {
      const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const r = await abrirTarefaDaPessoa(deps, { agenteId: ada.agenteId, texto: "Levantar os contratos vencidos" });
      const trabalhoId = r.data.trabalho.id;
      expect((await detalharTrabalho(deps, { trabalhoId })).data.botExcluido).toBeUndefined();
      await repos.agentes.excluir(ada.agenteId, Date.now());
      expect((await detalharTrabalho(deps, { trabalhoId })).data.botExcluido).toEqual({ nome: "Ada" });
      await repos.agentes.restaurar(ada.agenteId);
      expect((await detalharTrabalho(deps, { trabalhoId })).data.botExcluido).toBeUndefined();
    });
  });
});

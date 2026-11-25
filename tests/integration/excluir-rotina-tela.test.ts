import { expect, it } from "vitest";
import { criarRotina, criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { excluirRotina } from "../../src/use-cases/excluir-rotina.ts";
import { listarRotinas } from "../../src/use-cases/listar-rotinas.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

describeIntegracao("PR #333: Excluir pela tela de Rotinas e a próxima execução por extenso no criar_rotina", () => {
  it("excluir: some da lista, linha 'Rotina excluída' na conversa, evento; a segunda vez não faz nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const { rotina } = (await criarRotinaPelaPessoa(deps, { agenteId, cron: "0 9 * * *", fusoIana: TZ, instrucao: "beber água", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" })).data;
      const r = await excluirRotina(deps, { rotinaId: rotina.id });
      expect(r.data).toMatchObject({ jaExcluida: false, rotina: { id: rotina.id } });
      expect(r.data.rotina.excluidoEm).not.toBeNull();
      expect(r.events?.map((e) => e.kind)).toContain("rotina_excluida");
      expect((await listarRotinas(deps, {})).data.rotinas.map((x) => x.rotina.id)).not.toContain(rotina.id);
      const textos = (await repos.mensagens.listarDaConversa(conversaId)).map((m) => m.texto);
      expect(textos.at(-1)).toBe(`Rotina excluída: todo dia às 09:00 (${TZ}). Nada mais será disparado por ela.`);
      const deNovo = await excluirRotina(deps, { rotinaId: rotina.id });
      expect(deNovo.data.jaExcluida).toBe(true);
      expect((await repos.mensagens.listarDaConversa(conversaId)).length).toBe(textos.length);
    });
  });

  it("excluir rotina que não existe: nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsSobre(trx, MARLON, { agora: () => AGORA });
      await expect(excluirRotina(deps, { rotinaId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("criar_rotina devolve a próxima execução também por extenso no fuso da rotina", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "todo dia útil às 8", entradaConfianca: "confiavel", modelo: "m" });
      const r = await criarRotina(deps, { ...contexto(agenteId, conversaId, turno?.id), ...rotinaValida() });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      expect(r.data.proxima_execucao_local).toBe(`17/09/2026, 08:00 (${TZ})`);
    });
  });
});

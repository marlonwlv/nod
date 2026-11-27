import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { ANA, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { vincularEscopo } from "../../src/db/tx.ts";

/**
 * XUM-11 (catálogo de apps sob demanda): as diretas de cada app saem das capacidades que o bot chamou nos últimos 30
 * dias. A consulta conta só as chamadas de app (tool_call com conector), do bot e da pessoa, dentro da janela.
 */
describeIntegracao("XUM-11: trilha.capacidadesUsadas", () => {
  it("conta as chamadas de app do bot na janela, das mais usadas para as menos; ignora nod, negação, outro bot, fora da janela e outra pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const outro = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const repos = criarRepos(trx, MARLON);
      const k = await repos.conectores.criar({ nome: "Outlook", slug: "outlook", transporte: "http", url: "https://x", declaracao: "toca" });
      const conectorId = k?.id ?? "";
      const agora = Date.UTC(2026, 10, 27, 12);
      const dia = 86_400_000;
      const linha = (agenteId: string, ferramenta: string, em: number, p: { kind?: string; conectorId?: string | null; motivo?: string | null; regra?: string } = {}) =>
        repos.trilha.registrar({ agenteId, ferramenta, conectorId: p.conectorId === undefined ? conectorId : p.conectorId, kind: p.kind ?? "tool_call", motivo: p.motivo ?? null, regra: p.regra ?? "regra:consulta_sem_decisao", regraVersao: 1, em });
      for (let i = 0; i < 3; i++) await linha(vera.agenteId, "outlook__OUTLOOK_BATCH_MOVE_MESSAGES", agora - i * dia);
      await linha(vera.agenteId, "outlook__OUTLOOK_LIST_MESSAGES", agora - dia);
      await linha(vera.agenteId, "outlook__OUTLOOK_LIST_MESSAGES", agora - 2 * dia);
      await linha(vera.agenteId, "outlook__OUTLOOK_LIST_MAIL_FOLDERS", agora - 3 * dia);
      // Fora: velha (40 dias), negação, ferramenta do nod (sem conector), outro bot.
      await linha(vera.agenteId, "outlook__OUTLOOK_SEND_EMAIL", agora - 40 * dia);
      await linha(vera.agenteId, "outlook__OUTLOOK_DELETE_MESSAGE", agora - dia, { kind: "negacao", motivo: "capacidade_desligada", regra: "regra:parada_alcada" });
      await linha(vera.agenteId, "lembrar", agora - dia, { conectorId: null, regra: "regra:chamar_ferramenta" });
      await linha(outro.agenteId, "outlook__OUTLOOK_CREATE_EMAIL_RULE", agora - dia);
      const usadas = await repos.trilha.capacidadesUsadas({ agenteId: vera.agenteId, desde: agora - 30 * dia });
      expect(usadas).toEqual([
        { conectorId, ferramenta: "outlook__OUTLOOK_BATCH_MOVE_MESSAGES", vezes: 3 },
        { conectorId, ferramenta: "outlook__OUTLOOK_LIST_MESSAGES", vezes: 2 },
        { conectorId, ferramenta: "outlook__OUTLOOK_LIST_MAIL_FOLDERS", vezes: 1 },
      ]);
      // Outra pessoa não vê o uso do bot de Marlon (RLS + owner_id).
      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).trilha.capacidadesUsadas({ agenteId: vera.agenteId, desde: agora - 30 * dia })).toEqual([]);
    });
  });

  it("a consulta usa o índice parcial das decisões (0128): o predicado implica o do índice", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await trx`set local enable_seqscan = off`;
      const plano = await trx.unsafe(`explain select conector_id, ferramenta, count(*) from trilha where tenant_id = '${MARLON.tenantId}' and owner_id = '${MARLON.pessoaId}' and agente_id = '${vera.agenteId}' and em >= now() - interval '30 days' and kind in ('tool_call', 'negacao', 'cartao') and (conector_id is not null or regra <> 'regra:chamar_ferramenta') and coalesce(motivo, '') not in ('plano_ausente', 'alcance_insuficiente', 'conector_indisponivel', 'timeout_transporte', 'falha_tecnica') and kind = 'tool_call' and conector_id is not null group by 1, 2`);
      expect(JSON.stringify(plano)).toContain("trilha_decisoes_por_agente");
    });
  });
});

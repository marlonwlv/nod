import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { mcpTokensRepo } from "../../../src/repositories/mcp-tokens.repo.ts";
import { cunharTokenMcp } from "../../../src/services/token-mcp.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

/** mcp_tokens sob RLS (0173): como a chave de máquina, só a dona lista, acha pelo hash e revoga. */
describeIntegracao("mcp_tokens: só a dona vê, acha e revoga (0173)", () => {
  it("cria sem o token cru; outra pessoa não lista, não acha e não revoga; revogado deixa de valer", async () => {
    const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    await withRollback(dona, async (trx) => {
      const agora = Date.now();
      const c = cunharTokenMcp(dona);
      const criado = await mcpTokensRepo(trx, dona).criar({ nome: "Grok Bot", prefixo: c.prefixo, hash: c.hash });
      expect(criado).toMatchObject({ nome: "Grok Bot", prefixo: c.prefixo, cliente: null, revogadoEm: null });
      const [linha] = await trx`select * from mcp_tokens where id = ${criado?.id ?? ""}`;
      expect(JSON.stringify({ ...linha, hash: (linha?.hash as Buffer).toString("hex") })).not.toContain(c.chave.split(".")[1]);
      expect(linha).toMatchObject({ owner_id: dona.pessoaId, visibility: "privado" });

      await vincularEscopo(trx, outra);
      const daOutra = mcpTokensRepo(trx, outra);
      expect(await daOutra.listar()).toEqual([]);
      expect(await daOutra.buscarVivoPorHash(c.hash)).toBeNull();
      expect(await daOutra.revogar(criado?.id ?? "", agora)).toBe(false);
      expect(await trx`select id from mcp_tokens where hash = ${c.hash}`).toHaveLength(0);

      await vincularEscopo(trx, dona);
      const repo = mcpTokensRepo(trx, dona);
      expect(await repo.buscarVivoPorHash(c.hash)).toMatchObject({ id: criado?.id });
      // Marca de uso: grava o cliente na hora e depois só a cada 30 s.
      expect(await repo.marcarUso(criado?.id ?? "", agora, "Grok Bot")).toBe(true);
      expect(await repo.marcarUso(criado?.id ?? "", agora + 1_000, null)).toBe(false);
      expect(await repo.marcarUso(criado?.id ?? "", agora + 2_000, "Claude Desktop")).toBe(true);
      expect((await repo.listar())[0]).toMatchObject({ cliente: "Claude Desktop", ultimoUsoEm: agora + 2_000 });
      expect(await repo.revogar(criado?.id ?? "", agora)).toBe(true);
      expect(await repo.buscarVivoPorHash(c.hash)).toBeNull();
    });
  });

  it("hash único e com 32 bytes; nome vazio recusado pelo banco", async () => {
    const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    await withRollback(dona, async (trx) => {
      const repo = mcpTokensRepo(trx, dona);
      const c = cunharTokenMcp(dona);
      await repo.criar({ nome: "a", prefixo: c.prefixo, hash: c.hash });
      await expectRejected(trx, () => repo.criar({ nome: "b", prefixo: c.prefixo, hash: c.hash }), "23505");
      await expectRejected(trx, () => repo.criar({ nome: "c", prefixo: c.prefixo, hash: c.hash.subarray(0, 16) }), "23514");
      await expectRejected(trx, () => repo.criar({ nome: "  ", prefixo: c.prefixo, hash: cunharTokenMcp(dona).hash }), "23514");
    });
  });

  it("0174: a ação pelo MCP grava com o nome do cliente do token, sai no dia do bot e só a dona a vê", async () => {
    const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    const bot = randomUUID();
    await withRollback(dona, async (trx) => {
      const repo = mcpTokensRepo(trx, dona);
      const c = cunharTokenMcp(dona);
      const token = await repo.criar({ nome: "Meu Grok", prefixo: c.prefixo, hash: c.hash });
      const faixa = { ini: new Date(Date.now() - 60_000), fim: new Date(Date.now() + 60_000) };
      expect(await repo.registrarAcao({ tokenId: token?.id ?? "", agenteId: bot, ferramenta: "nod_mudar_tarefa", resumo: "Moveu a tarefa ADA-1 para Done" })).toBe(true);
      await repo.marcarUso(token?.id ?? "", Date.now(), "Grok Bot");
      expect(await repo.registrarAcao({ tokenId: token?.id ?? "", agenteId: bot, ferramenta: "nod_conversar", resumo: "Mandou uma mensagem a Ada" })).toBe(true);
      expect(await repo.registrarAcao({ tokenId: token?.id ?? "", agenteId: null, ferramenta: "nod_chamar_rota", resumo: "Chamou POST /rotinas" })).toBe(true);
      expect(await repo.registrarAcao({ tokenId: randomUUID(), agenteId: bot, ferramenta: "x", resumo: "y" })).toBe(false);
      const linhas = await repo.acoesDoDia(bot, faixa, 10);
      expect(linhas.map((l) => [l.resumo, l.cliente])).toEqual([["Mandou uma mensagem a Ada", "Grok Bot"], ["Moveu a tarefa ADA-1 para Done", "Meu Grok"]]);
      expect(await repo.contarAcoesDoDia(bot, faixa)).toBe(2);

      await vincularEscopo(trx, outra);
      const daOutra = mcpTokensRepo(trx, outra);
      expect(await daOutra.acoesDoDia(bot, faixa, 10)).toEqual([]);
      expect(await daOutra.registrarAcao({ tokenId: token?.id ?? "", agenteId: bot, ferramenta: "x", resumo: "y" })).toBe(false);
      expect(await trx`select id from mcp_acoes`).toHaveLength(0);
    });
  });
});

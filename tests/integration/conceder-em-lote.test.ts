import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { concederLote } from "../../src/use-cases/conceder.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { MARLON, depsSobreTrx } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

/**
 * definido em 2026-11-16: o padrão de app (ADA-241) concede o catálogo inteiro a cada bot novo, e um catálogo
 * do Composio tem centenas de ferramentas. Um INSERT por capacidade fazia a criação de vários bots num lote
 * passar do prazo do proxy. concederVarias grava o lote numa ida só, com a mesma idempotência de conceder().
 */
describeIntegracao("concessões em lote (um INSERT por lote, não por capacidade)", () => {
  it("concederVarias grava todas, na ordem pedida, e pula as que já existem sem erro", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Lote" });
      const c = await d.repos.conectores.criar({ nome: "Fixture", slug: `lote-${b.agente.id}`, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const mensagem = (await d.repos.mensagens.listarDaConversa(b.conversa.id))[0]!;
      await d.repos.concessoes.conceder({ agenteId: b.agente.id, conectorId: c!.id, capacidade: "b", mensagemId: mensagem.id });

      const criadas = await d.repos.concessoes.concederVarias({ agenteId: b.agente.id, conectorId: c!.id, capacidades: ["c", "b", "a"], mensagemId: mensagem.id });
      expect(criadas.map((x) => x.capacidade)).toEqual(["c", "a"]);
      expect(criadas.every((x) => x.ownerId === MARLON.pessoaId && x.mensagemId === mensagem.id)).toBe(true);
      expect((await d.repos.concessoes.doAgente(b.agente.id)).map((x) => x.capacidade).sort()).toEqual(["a", "b", "c"]);
      expect(await d.repos.concessoes.concederVarias({ agenteId: b.agente.id, conectorId: c!.id, capacidades: [], mensagemId: mensagem.id })).toEqual([]);
    });
  });

  it("concederLote com catálogo grande: uma mensagem de consentimento, uma concessão e um evento por capacidade", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Catálogo grande" });
      const catalogo = Array.from({ length: 400 }, (_, i) => cap(`FERRAMENTA_${i}`, i % 2 === 0));
      const criado = await d.repos.conectores.criar({ nome: "Grande", slug: `grande-${b.agente.id}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      const conector = await d.repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo, agora: Date.now() });

      const { data, events } = await concederLote(d, { agenteId: b.agente.id, conectorId: conector!.id, capacidades: catalogo.map((k) => k.nome) });
      expect(data.concessoes).toHaveLength(400);
      expect(new Set(data.concessoes.map((x) => x.mensagemId))).toEqual(new Set([data.mensagemId]));
      expect(data.concessoes.map((x) => x.capacidade)).toEqual(catalogo.map((k) => k.nome));
      expect((events ?? []).filter((e) => e.kind === "concessao_criada")).toHaveLength(400);
      expect(await d.repos.concessoes.doAgente(b.agente.id)).toHaveLength(400);

      // Repetir o lote é sucesso sem mensagem nova (definido em 2026-09-21) — inalterado.
      const { data: deNovo } = await concederLote(d, { agenteId: b.agente.id, conectorId: conector!.id, capacidades: ["FERRAMENTA_0"] });
      expect(deNovo.mensagemId).toBeNull();
      expect(deNovo.concessoes).toEqual([data.concessoes[0]]);
    });
  });
});

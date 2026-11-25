import { describe, expect, it, vi } from "vitest";
import { criarApi } from "../../../../web/lib/api.ts";

// QA-196: o corpo da Nova tarefa com a chave de idempotência (aqui porque web/lib/api.ts usa o DOM; ver o tsconfig.server).
describe("QA-196: a chave da Nova tarefa no POST", () => {
  it("o POST agentes/:id/trabalhos leva a chave no corpo; sem ela, o corpo é o de antes", async () => {
    const corpos: unknown[] = [];
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      corpos.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, ids: {}, trabalho: { id: "t1" } }), { status: 201, headers: { "content-type": "application/json" } });
    }));
    try {
      const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
      await api.abrirTarefa("ada", "oi", false, [], "chave-xyz");
      await api.abrirTarefa("ada", "oi", false);
      expect(corpos).toEqual([{ texto: "oi", levarConversa: false, chave: "chave-xyz" }, { texto: "oi", levarConversa: false }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

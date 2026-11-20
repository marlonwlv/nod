import { describe, expect, it } from "vitest";
import { executarFerramentaMcp } from "../../../../src/adapters/http/mcp/ferramentas.ts";

describe("conteúdo devolvido pelo servidor MCP", () => {
  it("preserva um emoji composto na fronteira do resumo da conversa", async () => {
    const prefixo = "a".repeat(3_998);
    const emoji = "👨‍👩‍👧‍👦";
    const chamar = async (_escopo: unknown, pedido: { caminho: string }) => {
      if (pedido.caminho === "/frota") {
        return { status: 200, corpo: { agentes: [{ id: "bot-1", nome: "Ada", conversaId: "conversa-1" }] } };
      }
      return {
        status: 200,
        corpo: {
          mensagens: [{ id: "m-1", turnoId: null, kind: "texto", texto: `${prefixo}${emoji}fim`, criadoEm: 1, autoria: { autor_tipo: "agente" } }],
          turnosEmCurso: [],
          turnosPendentes: [],
        },
      };
    };
    const resultado = await executarFerramentaMcp({
      escopo: { tenantId: "tenant", pessoaId: "pessoa" },
      chamar,
      agora: () => 0,
      dormir: async () => {},
    }, "nod_ler_conversa", { bot: "Ada" });

    const texto = resultado?.content[0]?.text ?? "";
    expect(texto).not.toContain("\\ud83d");
    expect(JSON.parse(texto).mensagens[0].texto).toBe(`${prefixo}…`);
  });
});

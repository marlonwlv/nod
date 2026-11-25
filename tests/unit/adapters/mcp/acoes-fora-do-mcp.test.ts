import { describe, expect, it } from "vitest";
import { ACOES_FORA_DO_MCP } from "../../../../src/adapters/http/mcp/chamador-interno.ts";
import { REGISTRO_DE_ACOES } from "../../../../src/domain/acoes/index.ts";

// Regression: QA-179 — apps.conectar_com_chave tinha chat "nunca" por levar segredo, mas faltava na lista do MCP, e o
// nod_chamar_rota levava a chave de API do app. A lista é explícita de propósito (cartões e mensagem ficam abertos ao
// MCP); o que o registro diz que é segredo não pode ficar de fora dela.
describe("ACOES_FORA_DO_MCP", () => {
  it("toda ação que o registro fecha no chat por levar segredo fica fora do MCP", () => {
    const deSegredo = REGISTRO_DE_ACOES.filter((a) => a.chat.estado === "nunca" && /segredo/i.test(a.chat.motivo)).map((a) => a.id);
    expect(deSegredo.length).toBeGreaterThan(0);
    expect(deSegredo.filter((id) => !ACOES_FORA_DO_MCP.has(id))).toEqual([]);
  });
});

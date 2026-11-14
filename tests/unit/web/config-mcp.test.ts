import { describe, expect, it } from "vitest";
import { configDoCliente, renderMcp } from "../../../web/telas/config-mcp.ts";

const ui = { abertos: [] } as never;
const token = (o: Partial<{ id: string; nome: string; cliente: string | null; ultimoUsoEm: number | null; revogadoEm: number | null }> = {}) => ({ id: "t1", nome: "Grok Bot", prefixo: "abcd1234", cliente: null, criadoEm: 0, ultimoUsoEm: null, revogadoEm: null, ...o });

describe("Configurações › Geral › Conectar por MCP", () => {
  it("lista os tokens vivos com o app que usou e o Revogar; o revogado some", () => {
    const html = renderMcp({ tokens: { endpoint: "https://nod.exemplo/api/mcp", tokens: [token({ cliente: "Grok Bot", ultimoUsoEm: 1_000 }), token({ id: "t2", nome: "Velho", revogadoEm: 5 })] }, emitido: null }, ui);
    expect(html).toContain("Conectar por MCP");
    expect(html).toContain("Usado por Grok Bot");
    expect(html).toContain('data-act="revogar-token-mcp"');
    expect(html).not.toContain("Velho");
    expect(html).toContain("https://nod.exemplo/api/mcp");
  });

  it("o token recém-gerado aparece uma vez, com o Copiar e a configuração pronta", () => {
    const html = renderMcp({ tokens: null, emitido: { token: "nod_mcp_xyz", endpoint: "https://nod.exemplo/api/mcp", dados: token() } }, ui);
    expect(html).toContain("nod_mcp_xyz");
    expect(html).toContain("não será mostrado de novo");
    expect(html).toContain('data-act="fechar-token-mcp"');
    expect(JSON.parse(configDoCliente("https://nod.exemplo/api/mcp", "nod_mcp_xyz"))).toEqual({ mcpServers: { nod: { type: "http", url: "https://nod.exemplo/api/mcp", headers: { Authorization: "Bearer nod_mcp_xyz" } } } });
  });

  it("sem token nenhum, o formulário de gerar já vem aberto", () => {
    expect(renderMcp({ tokens: { endpoint: "x", tokens: [] }, emitido: null }, ui)).toContain('data-form="gerar-token-mcp"');
  });
});

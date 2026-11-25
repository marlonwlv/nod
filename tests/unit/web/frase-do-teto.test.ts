import { describe, expect, it } from "vitest";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { comFraseDoTeto, FRASE_TETO_TOKENS_MCP } from "../../../web/lib/frase-do-teto.ts";

describe("comFraseDoTeto (QA-169)", () => {
  it("troca o 'espere um pouco' do limite_atingido pelo que liberar, mantendo status, correlação e rota", () => {
    const e = new ErroApi(429, "limite_atingido", "Você chegou ao limite por agora. Espere um pouco e tente de novo.", "cid-1", "POST /mcp/tokens");
    const r = comFraseDoTeto(e, FRASE_TETO_TOKENS_MCP) as ErroApi;
    expect(r).toBeInstanceOf(ErroApi);
    expect(r.message).toBe(FRASE_TETO_TOKENS_MCP);
    expect(r.message).not.toContain("Espere");
    expect([r.status, r.codigo, r.correlationId, r.rota]).toEqual([429, "limite_atingido", "cid-1", "POST /mcp/tokens"]);
  });

  it("outro erro volta como veio", () => {
    const e = new ErroApi(400, "entrada_invalida", "x");
    expect(comFraseDoTeto(e, FRASE_TETO_TOKENS_MCP)).toBe(e);
    const bruto = new TypeError("rede");
    expect(comFraseDoTeto(bruto, FRASE_TETO_TOKENS_MCP)).toBe(bruto);
  });
});

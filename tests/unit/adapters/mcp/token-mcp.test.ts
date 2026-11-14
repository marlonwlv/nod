import { describe, expect, it } from "vitest";
import { cunharChaveMaquina, escopoAlegado } from "../../../../src/services/token-maquina.ts";
import { cunharTokenMcp, escopoAlegadoMcp, hashDoTokenMcp } from "../../../../src/services/token-mcp.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../../helpers/ids.ts";

describe("token do servidor MCP (0173)", () => {
  const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

  it("leva o prefixo nod_mcp_, o escopo alegado e o hash do token inteiro", () => {
    const t = cunharTokenMcp(escopo);
    expect(t.chave.startsWith("nod_mcp_")).toBe(true);
    expect(escopoAlegadoMcp(t.chave)).toEqual(escopo);
    expect(hashDoTokenMcp(t.chave).equals(t.hash)).toBe(true);
    expect(t.prefixo).toHaveLength(8);
  });

  it("uma chave de máquina não passa por token MCP, e o token MCP não passa por chave de máquina", () => {
    const chave = cunharChaveMaquina(escopo).chave;
    expect(escopoAlegadoMcp(chave)).toBeNull();
    expect(escopoAlegado(cunharTokenMcp(escopo).chave)).toBeNull();
    expect(escopoAlegadoMcp("nod_mcp_lixo")).toBeNull();
    expect(escopoAlegadoMcp(42)).toBeNull();
  });
});

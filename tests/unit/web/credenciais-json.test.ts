import { describe, expect, it } from "vitest";
import { lerCredenciaisJson } from "../../../web/lib/credenciais-json.ts";

/** QA-150: as credenciais do MCP próprio (Registrar e Atualizar credenciais) são um objeto JSON; o resto é recusado. */
describe("lerCredenciaisJson", () => {
  it("aceita um objeto JSON, com espaços em volta", () => {
    expect(lerCredenciaisJson('  {"TOKEN":"abc"} ', "vale-vazio")).toEqual({ TOKEN: "abc" });
    expect(lerCredenciaisJson('{"Authorization":"Bearer x"}', "obrigatorio")).toEqual({ Authorization: "Bearer x" });
  });
  it("vazio vale {} no Registrar e é inválido no Atualizar", () => {
    expect(lerCredenciaisJson("   ", "vale-vazio")).toEqual({});
    expect(lerCredenciaisJson("", "obrigatorio")).toBeNull();
  });
  it.each(["{TOKEN: abc}", '{"TOKEN":"abc"', "TOKEN=abc", "[]", '["a"]', '"texto"', "42", "null", "true"])("recusa %s sem lançar", (t) => {
    expect(() => lerCredenciaisJson(t, "vale-vazio")).not.toThrow();
    expect(lerCredenciaisJson(t, "vale-vazio")).toBeNull();
    expect(lerCredenciaisJson(t, "obrigatorio")).toBeNull();
  });
});

/** O caminho de antes: o `JSON.parse` solto lançava SyntaxError, que a tela trata como bug dela e manda relatar. */
import { erroDe } from "../../../web/lib/erro-da-tela.ts";
describe("o SyntaxError solto na ação vira erro da tela (o que o Registrar mostrava)", () => {
  it("vira erro_da_tela e é registrado como falha da tela", () => {
    const registrados: unknown[] = [];
    let erro: unknown;
    try { JSON.parse("{TOKEN: abc}"); } catch (e) { erro = e; }
    expect(erroDe(erro, (e) => registrados.push(e), "conectores")?.codigo).toBe("erro_da_tela");
    expect(registrados).toHaveLength(1);
  });
});

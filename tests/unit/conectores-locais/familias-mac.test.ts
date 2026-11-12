import { describe, expect, it } from "vitest";
import { caminhoFamiliasMac, ehFamiliaMac, lerFamiliasMac, TODAS_DESLIGADAS } from "../../../src/adapters/conectores-locais/mac/familias.ts";
import { FAMILIAS_MAC } from "../../../src/contracts/desktop-mac.ts";

describe("famílias de ferramentas do Mac: desligadas por padrão (ADR-171)", () => {
  it("sem arquivo, corrompido, array ou valor que não é true literal = desligada", () => {
    for (const conteudo of [null, "{", "[]", "null", JSON.stringify({ notas: "true", mail_ler: 1 })]) expect(lerFamiliasMac(conteudo)).toEqual(TODAS_DESLIGADAS);
    expect(Object.values(TODAS_DESLIGADAS).every((v) => v === false)).toBe(true);
    expect(Object.keys(TODAS_DESLIGADAS).sort()).toEqual([...FAMILIAS_MAC].sort());
  });

  it("liga só a família marcada com true; ignora chave desconhecida", () => {
    const f = lerFamiliasMac(JSON.stringify({ notas: true, root: true }));
    expect(f.notas).toBe(true);
    expect(f.mail_enviar).toBe(false);
    expect("root" in f).toBe(false);
  });

  it("valida o nome da família e mora em ~/.nod", () => {
    expect(ehFamiliaMac("imessage_enviar")).toBe(true);
    expect(ehFamiliaMac("shell")).toBe(false);
    expect(caminhoFamiliasMac("/Users/ana")).toBe("/Users/ana/.nod/ferramentas-mac.json");
  });
});

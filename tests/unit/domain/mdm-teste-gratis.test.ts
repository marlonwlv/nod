import { describe, expect, it } from "vitest";
import { criarChecagemTeste } from "../../../src/adapters/checagem-aparelho/teste.ts";
import { lerPoliticaMdm, modoComTeto, origemHttps } from "../../../src/domain/mdm.ts";
import { decidirTesteGratis, pareceMaquinaVirtual } from "../../../src/domain/teste-gratis.ts";

describe("política do MDM (ADR-176)", () => {
  it("só origem https, sem caminho, usuário ou consulta", () => {
    expect(origemHttps("https://Nod.Acme.com/")).toBe("https://nod.acme.com");
    expect(origemHttps("https://nod.acme.com:8443")).toBe("https://nod.acme.com:8443");
    expect(origemHttps("http://nod.acme.com")).toBeNull();
    expect(origemHttps("https://nod.acme.com/api")).toBeNull();
    expect(origemHttps("https://user@nod.acme.com")).toBeNull();
    expect(origemHttps("https://nod.acme.com?x=1")).toBeNull();
    expect(origemHttps("https://localhost")).toBeNull();
  });
  it("lê defaults e policy.json; o que não serve vira erro escrito e é ignorado", () => {
    const r = lerPoliticaMdm({ defaults: { DeploymentBackendUrl: "https://nod.acme.com", DeploymentWebsiteUrl: "http://x.com" }, policyJson: { tetoModoAprovacao: "manual", semTesteGratis: true, outra: 1 } });
    expect(r.politica).toEqual({ backendUrl: "https://nod.acme.com", tetoModoAprovacao: "manual", semTesteGratis: true });
    expect(r.erros).toEqual(["DeploymentWebsiteUrl: só origem https (https://host[:porta]), sem caminho", "policy.json: chave desconhecida outra (ignorada)"]);
  });
  it("o teto do admin limita o modo", () => {
    expect(modoComTeto("total", "automatico")).toBe("automatico");
    expect(modoComTeto("manual", "automatico")).toBe("manual");
    expect(modoComTeto("total", undefined)).toBe("total");
  });
});

describe("teste grátis com DeviceCheck (ADR-176)", () => {
  it("um teste por aparelho, nunca em VM nem com a empresa desligando", async () => {
    const c = criarChecagemTeste();
    const primeira = decidirTesteGratis({ bits: await c.consultar("tok"), maquinaVirtual: false, semTesteGratisPelaEmpresa: false });
    expect(primeira).toEqual({ libera: true, marcar: { bit0: true, bit1: false } });
    if (primeira.libera) await c.marcar("tok", primeira.marcar);
    expect(decidirTesteGratis({ bits: await c.consultar("tok"), maquinaVirtual: false, semTesteGratisPelaEmpresa: false })).toEqual({ libera: false, motivo: "aparelho_ja_usou" });
    expect(decidirTesteGratis({ bits: await c.consultar("invalido-1"), maquinaVirtual: false, semTesteGratisPelaEmpresa: false })).toEqual({ libera: false, motivo: "token_invalido" });
    expect(decidirTesteGratis({ bits: { bit0: false, bit1: false }, maquinaVirtual: true, semTesteGratisPelaEmpresa: false })).toEqual({ libera: false, motivo: "maquina_virtual" });
    expect(decidirTesteGratis({ bits: { bit0: false, bit1: false }, maquinaVirtual: false, semTesteGratisPelaEmpresa: true })).toEqual({ libera: false, motivo: "politica_da_empresa" });
  });
  it("sinais de VM", () => {
    expect(pareceMaquinaVirtual({ hvVmmPresent: "1\n" })).toBe(true);
    expect(pareceMaquinaVirtual({ modelo: "VirtualMac2,1" })).toBe(true);
    expect(pareceMaquinaVirtual({ hvVmmPresent: "0", modelo: "Mac14,2" })).toBe(false);
  });
});

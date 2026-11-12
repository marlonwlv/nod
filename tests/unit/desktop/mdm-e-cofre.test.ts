import { describe, expect, it } from "vitest";
import { opDaAgileBits, preencherCom1Password, referenciaValida } from "../../../desktop/cofre-1password.ts";
import { lerMdmDoMac } from "../../../desktop/mdm.ts";

const ASSINADO = "Executable=/opt/homebrew/bin/op\nAuthority=Developer ID Application: AgileBits Inc. (2BUA8C4S2C)\nTeamIdentifier=2BUA8C4S2C\n";

describe("MDM no Mac (ADR-178)", () => {
  it("desligado não lê nada; ligado lê os defaults e o policy.json", async () => {
    const executar = async (_c: string, args: readonly string[]) => (args[2] === "DeploymentBackendUrl" ? { codigo: 0, saida: "https://nod.acme.com\n" } : { codigo: 1, saida: "" });
    expect(await lerMdmDoMac({ bundleId: "br.nod", ligado: false, executar })).toBeNull();
    const r = await lerMdmDoMac({ bundleId: "br.nod", ligado: true, executar, ler: async () => '{"tetoModoAprovacao":"automatico"}' });
    expect(r).toEqual({ politica: { backendUrl: "https://nod.acme.com", tetoModoAprovacao: "automatico" }, erros: [] });
  });
  it("sem policy.json é o normal; JSON quebrado vira erro escrito", async () => {
    const executar = async () => ({ codigo: 1, saida: "" });
    const semArquivo = Object.assign(new Error("x"), { code: "ENOENT" });
    expect(await lerMdmDoMac({ bundleId: "b", ligado: true, executar, ler: async () => { throw semArquivo; } })).toEqual({ politica: {}, erros: [] });
    expect((await lerMdmDoMac({ bundleId: "b", ligado: true, executar, ler: async () => "{" }))?.erros).toEqual(["policy.json: não é JSON válido"]);
  });
});

describe("1Password no Mac (ADR-177)", () => {
  it("referência op:// válida; shell e caminho fora não", () => {
    expect(referenciaValida("op://Pessoal/Banco/senha")).toBe(true);
    expect(referenciaValida("op://Pessoal/Banco/Login/senha")).toBe(true);
    expect(referenciaValida("op://Pessoal/Banco/senha$(rm -rf ~)")).toBe(false);
    expect(referenciaValida("op://Pessoal/../senha")).toBe(true);
    expect(referenciaValida("https://x")).toBe(false);
  });
  it("só roda o op assinado pela AgileBits", async () => {
    expect(await opDaAgileBits("/opt/homebrew/bin/op", async (_c, a) => ({ codigo: 0, saida: a[0] === "-dv" ? ASSINADO : "" }))).toBe(true);
    expect(await opDaAgileBits("/opt/homebrew/bin/op", async (_c, a) => ({ codigo: 0, saida: a[0] === "-dv" ? "TeamIdentifier=OUTRO123\n" : "" }))).toBe(false);
    expect(await opDaAgileBits("/opt/homebrew/bin/op", async () => ({ codigo: 1, saida: "" }))).toBe(false);
  });
  it("entrega o segredo a quem preenche e não o devolve", async () => {
    const entregues: string[] = [];
    const r = await preencherCom1Password({
      ligado: true, referencia: "op://Pessoal/Banco/senha", existe: async (c) => c === "/opt/homebrew/bin/op",
      executar: async (_c, a) => ({ codigo: 0, saida: a[0] === "-dv" ? ASSINADO : a[0] === "read" ? "s3gr3d0" : "" }),
      entregar: async (s) => void entregues.push(s),
    });
    expect(r).toEqual({ ok: true });
    expect(JSON.stringify(r)).not.toContain("s3gr3d0");
    expect(entregues).toEqual(["s3gr3d0"]);
    expect(await preencherCom1Password({ ligado: false, referencia: "op://a/b/c", existe: async () => true, executar: async () => ({ codigo: 0, saida: "" }), entregar: async () => {} })).toEqual({ ok: false, motivo: "desligado" });
  });
});

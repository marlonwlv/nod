import { describe, expect, it } from "vitest";
import { chaveDaConta, contaValida, LIMITE_CONTAS_POR_APP, nomeDaConta, normalizarConta, rotuloValido, separarChave } from "../../../src/domain/contas-do-app.ts";
import * as daWeb from "../../../web/react/marketplace/contas.ts";
import { acharApp } from "../../../src/use-cases/gerir-acessos.ts";
import { toolkitAceito } from "../../../src/adapters/integracoes/toolkits-composio.ts";
import type { Conector } from "../../../src/contracts/conector.ts";

describe("ADR-196: a chave da conta a mais", () => {
  it("normaliza o nome que a pessoa digita", () => {
    expect(normalizarConta("Pessoal")).toBe("pessoal");
    expect(normalizarConta("  Família Silva!! ")).toBe("familia-silva");
    expect(normalizarConta("Cliente -- ACME")).toBe("cliente-acme");
    expect(normalizarConta("😀")).toBe("");
  });

  it("só aceita letras e números com um hífen entre eles, até 20", () => {
    expect(contaValida("pessoal")).toBe(true);
    expect(contaValida("familia-silva")).toBe(true);
    for (const ruim of ["", "a--b", "-a", "a-", "Pessoal", "a_b", "x".repeat(21)]) expect(contaValida(ruim)).toBe(false);
    expect(rotuloValido("Pessoal")).toBe(true);
    expect(rotuloValido("pes(soal)")).toBe(false);
    expect(rotuloValido("a​b")).toBe(false);
    expect(rotuloValido("   ")).toBe(false);
  });

  it("separa e junta a chave; o separador é o `--`", () => {
    expect(separarChave("gmail")).toEqual({ app: "gmail", conta: null });
    expect(separarChave("gmail--pessoal")).toEqual({ app: "gmail", conta: "pessoal" });
    expect(separarChave("microsoft-teams--trabalho")).toEqual({ app: "microsoft-teams", conta: "trabalho" });
    for (const ruim of ["", "gmail--", "--pessoal", "gmail---a", "gmail--a--b"]) expect(separarChave(ruim)).toBeNull();
    expect(chaveDaConta("gmail", "pessoal")).toBe("gmail--pessoal");
    expect(chaveDaConta("gmail", null)).toBe("gmail");
    expect(nomeDaConta("Gmail", " Pessoal ")).toBe("Gmail (Pessoal)");
    expect(LIMITE_CONTAS_POR_APP).toBe(5);
  });

  it("o toolkit do Composio com `__` fica fora: viraria o separador da conta", () => {
    expect(toolkitAceito("microsoft_teams")).toBe(true);
    expect(toolkitAceito("algo__estranho")).toBe(false);
  });

  it("a web repete as mesmas regras (ela não importa valor de src)", () => {
    for (const t of ["Pessoal", "Família Silva", "Cliente -- ACME", "x".repeat(25), "", "😀 ok"]) {
      expect(daWeb.normalizarConta(t)).toBe(normalizarConta(t));
      expect(daWeb.rotuloValido(t)).toBe(rotuloValido(t));
    }
    for (const c of ["gmail", "gmail--pessoal", "gmail--", "gmail---a", "microsoft-teams--trabalho"]) expect(daWeb.separarChave(c)).toEqual(separarChave(c));
    expect(daWeb.LIMITE_CONTAS_POR_APP).toBe(LIMITE_CONTAS_POR_APP);
  });
});

describe("ADR-196: o gerir_acessos não escolhe a conta", () => {
  const app = (id: string, slug: string, nome: string, contaEmail?: string): Conector => ({ id, slug, nome, ...(contaEmail ? { contaEmail } : {}) }) as Conector;
  const apps = [app("1", "gmail", "Gmail"), app("2", "gmail--pessoal", "Gmail (pessoal)", "maria@pessoal.example"), app("3", "slack", "Slack")];

  it("\"Gmail\" com duas contas devolve as duas, com o slug que resolve e o e-mail", () => {
    expect(acharApp("Gmail", apps)).toEqual({ opcoes: ["Gmail (app \"gmail\")", "Gmail (pessoal) · maria@pessoal.example (app \"gmail--pessoal\")"] });
  });

  it("o nome inteiro da conta, o slug ou o id resolvem sem dúvida", () => {
    expect(acharApp("Gmail (pessoal)", apps)).toMatchObject({ app: { id: "2" } });
    expect(acharApp("gmail", apps)).toMatchObject({ app: { id: "1" } });
    expect(acharApp("gmail--pessoal", apps)).toMatchObject({ app: { id: "2" } });
    expect(acharApp("Slack", apps)).toMatchObject({ app: { id: "3" } });
  });

  it("com uma conta só, \"Gmail\" segue resolvendo direto", () => {
    expect(acharApp("Gmail", [apps[0]!, apps[2]!])).toMatchObject({ app: { id: "1" } });
  });
});

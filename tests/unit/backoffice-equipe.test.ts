import { describe, expect, it } from "vitest";
import { estaNaLista, papelNoBackoffice } from "../../src/domain/backoffice-equipe.ts";
import * as servidor from "../../src/shared/backoffice.ts";
import * as web from "../../web/lib/backoffice.ts";

const { caminhoDeVolta, ehCaminhoDoBackoffice } = servidor;

/** ADR-194: quem entra no backoffice interno e para onde o login devolve. */
describe("estaNaLista (NOD_ADMINS)", () => {
  it("lista vazia não deixa ninguém entrar", () => {
    expect(estaNaLista([], { id: "a", email: "x@y" })).toBe(false);
  });
  it("aceita o id ou o e-mail, sem diferença de caixa", () => {
    expect(estaNaLista(["abc"], { id: "ABC", email: null })).toBe(true);
    expect(estaNaLista(["admin@exemplo.test"], { id: "z", email: "Admin@Exemplo.test" })).toBe(true);
    expect(estaNaLista(["admin@exemplo.test"], { id: "z", email: "outra@exemplo.test" })).toBe(false);
    expect(estaNaLista(["abc"], null)).toBe(false);
  });
});

describe("papelNoBackoffice", () => {
  const eu = { id: "p1", email: "eu@exemplo.test" };
  it("com a equipe vazia, NOD_ADMINS define os donos (bootstrap)", () => {
    expect(papelNoBackoffice({ papel: null, equipeVazia: true }, ["eu@exemplo.test"], eu)).toBe("dono");
    expect(papelNoBackoffice({ papel: null, equipeVazia: true }, ["outra@exemplo.test"], eu)).toBeNull();
    expect(papelNoBackoffice({ papel: null, equipeVazia: true }, [], eu)).toBeNull();
  });
  it("com a equipe preenchida, só a tabela vale (NOD_ADMINS deixa de dar acesso)", () => {
    expect(papelNoBackoffice({ papel: null, equipeVazia: false }, ["eu@exemplo.test"], eu)).toBeNull();
    expect(papelNoBackoffice({ papel: "leitura", equipeVazia: false }, [], eu)).toBe("leitura");
    expect(papelNoBackoffice({ papel: "dono", equipeVazia: false }, [], eu)).toBe("dono");
  });
});

describe("caminhoDeVolta", () => {
  it("aceita só caminhos do backoffice", () => {
    expect(caminhoDeVolta("/backoffice")).toBe("/backoffice");
    expect(caminhoDeVolta("/backoffice/uso")).toBe("/backoffice/uso");
    expect(caminhoDeVolta("/backoffice/problemas?dias=7")).toBe("/backoffice/problemas?dias=7");
    expect(caminhoDeVolta("/backoffice/pessoas/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa")).toBe(
      "/backoffice/pessoas/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa",
    );
  });
  it("descarta a query que não seja dias", () => {
    expect(caminhoDeVolta("/backoffice/uso?x=https://mal.example")).toBe("/backoffice/uso");
  });
  it("recusa o que poderia virar redirecionamento aberto", () => {
    for (const v of [null, undefined, "", "/", "/backofficex", "//mal.example/backoffice", "https://mal.example/backoffice", "/backoffice/../conta", "/backoffice//mal.example", "/backoffice/%2F%2Fmal", "/backoffice\\mal", "/backoffice/a?b?c", "/backoffice/a/b/c/d/e"]) {
      expect(caminhoDeVolta(v), String(v)).toBeNull();
    }
  });
  it("ehCaminhoDoBackoffice", () => {
    expect(ehCaminhoDoBackoffice("/backoffice")).toBe(true);
    expect(ehCaminhoDoBackoffice("/backoffice/uso")).toBe(true);
    expect(ehCaminhoDoBackoffice("/backoffices")).toBe(false);
  });
});

describe("o espelho da web (web/lib/backoffice.ts) é igual ao do servidor", () => {
  it("mesmas constantes e mesmo veredito nos mesmos caminhos", () => {
    expect([web.CAMINHO_BACKOFFICE, web.CAMINHO_BACKOFFICE_PADRAO, web.PARAMETRO_VOLTA]).toEqual([servidor.CAMINHO_BACKOFFICE, servidor.CAMINHO_BACKOFFICE_PADRAO, servidor.PARAMETRO_VOLTA]);
    for (const v of ["/backoffice", "/backoffice/uso?dias=7", "/backoffice/uso?x=1", "//mal.example", "/backoffice/../x", "/backoffice/a/b/c/d/e", "/backofficex", "/backoffice/pessoas/a/b"]) {
      expect(web.caminhoDeVolta(v), v).toBe(servidor.caminhoDeVolta(v));
      expect(web.ehCaminhoDoBackoffice(v), v).toBe(servidor.ehCaminhoDoBackoffice(v));
    }
  });
});

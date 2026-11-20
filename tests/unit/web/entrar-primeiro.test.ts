import { describe, expect, it } from "vitest";
import { etapaDaIntencao, htmlEntrarPrimeiro, intencaoDe, mostrarEntrarPrimeiro } from "../../../web/telas/entrar-primeiro.ts";

/**
 * #81: na primeira visita de um navegador (celular, outro computador), a web pergunta "Já usa o nod?" antes de abrir um
 * espaço provisório novo. Entrando na conta, a sessão é da pessoa e os bots dela aparecem, servidos pelo motor do outro
 * computador.
 */
const base = { google: true, codigoPorEmail: true, equipe: null, formEmailSenha: '<form data-form="entrada-conta"></form>', ocupado: false, erro: null };

describe("quando a tela 'Já usa o nod?' aparece", () => {
  it("só onde o espaço provisório abriria e só na primeira visita deste navegador", () => {
    expect(mostrarEntrarPrimeiro({ abreProvisorio: true, temVerificador: false })).toBe(true);
    // Quem já tem um espaço provisório neste navegador volta a ele, como antes.
    expect(mostrarEntrarPrimeiro({ abreProvisorio: true, temVerificador: true })).toBe(false);
    // App, saiu, equipe, pareamento pendente, contas desligadas: abreProvisorio já é false, e a tela de antes segue.
    expect(mostrarEntrarPrimeiro({ abreProvisorio: false, temVerificador: false })).toBe(false);
    expect(mostrarEntrarPrimeiro({ abreProvisorio: false, temVerificador: true })).toBe(false);
  });
});

describe("a tela 'Já usa o nod?'", () => {
  it("oferece entrar na conta (Google, código por e-mail, e-mail e senha, código de outro computador) e começar sem conta", () => {
    const h = htmlEntrarPrimeiro(base);
    expect(h).toContain("Já usa o nod?");
    expect(h).toContain('<h2 class="cc-titulo">Já usa o nod?</h2>');
    expect(h).toContain('data-intencao="google"');
    expect(h).toContain(">Continuar com Google<");
    expect(h).toContain('data-intencao="email"');
    expect(h).toContain('data-form="entrada-conta"');
    expect(h).toContain('data-intencao="parear-entrar"');
    expect(h).toContain('data-intencao="sem-conta"');
    expect(h).toContain(">Começar sem conta<");
    expect(h).toMatch(/class="bt pri"[^>]*data-intencao="sem-conta"/);
    expect(h.match(/data-act="entrada-primeiro"/g)).toHaveLength(4);
  });

  it("sem o Google para conta e sem o código por e-mail, esses botões somem; o resto fica", () => {
    const h = htmlEntrarPrimeiro({ ...base, google: false, codigoPorEmail: false });
    expect(h).not.toContain('data-intencao="google"');
    expect(h).not.toContain('data-intencao="email"');
    expect(h).toContain('data-form="entrada-conta"');
    expect(h).toContain('data-intencao="parear-entrar"');
    expect(h).toContain('data-intencao="sem-conta"');
  });

  it("mostra o link da equipe quando há, o erro escapado e trava os botões enquanto abre", () => {
    const h = htmlEntrarPrimeiro({ ...base, equipe: "/api/sessao/google", erro: "<b>falhou</b>", ocupado: true });
    expect(h).toContain('href="/api/sessao/google"');
    expect(h).toContain("Sou da equipe: entrar com Google");
    expect(h).toContain("&lt;b&gt;falhou&lt;/b&gt;");
    expect(h).toContain('role="alert"');
    expect(h.match(/data-act="entrada-primeiro"[^>]*disabled/g)).toHaveLength(4);
  });
});

describe("o que cada escolha faz depois do espaço provisório", () => {
  it("lê só intenções conhecidas", () => {
    expect(intencaoDe("google")).toBe("google");
    expect(intencaoDe("sem-conta")).toBe("sem-conta");
    expect(intencaoDe("cadastro")).toBeNull();
    expect(intencaoDe(undefined)).toBeNull();
  });

  it("código por e-mail e código de outro computador abrem o cartão de conta na etapa certa; Google e sem conta, nenhuma", () => {
    expect(etapaDaIntencao("email")).toBe("email");
    expect(etapaDaIntencao("parear-entrar")).toBe("parear-entrar");
    expect(etapaDaIntencao("google")).toBeNull();
    expect(etapaDaIntencao("sem-conta")).toBeNull();
  });
});

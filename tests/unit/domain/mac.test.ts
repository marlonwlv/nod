import { describe, expect, it } from "vitest";
import { ArgumentoMacInvalido, ehCapacidadeMac, familiaDaCapacidade, ferramentasMacNoPlano, htmlDaNota, validarArgsMac } from "../../../src/domain/mac.ts";
import { CAPACIDADES_MAC } from "../../../src/contracts/mac.ts";
import { FAMILIAS_MAC } from "../../../src/contracts/desktop-mac.ts";

describe("ferramentas do Mac: domínio (ADR-173)", () => {
  it("toda capacidade tem família conhecida; toda família tem capacidade; escrita não é readOnly", () => {
    for (const c of CAPACIDADES_MAC) expect(FAMILIAS_MAC).toContain(c.familia);
    for (const f of FAMILIAS_MAC) expect(CAPACIDADES_MAC.some((c) => c.familia === f)).toBe(true);
    for (const n of ["mail_enviar", "notas_criar", "calendario_criar", "lembretes_criar", "imessage_enviar"]) expect(CAPACIDADES_MAC.find((c) => c.nome === n)?.readOnlyHint).toBe(false);
    expect(familiaDaCapacidade("imessage_enviar")).toBe("imessage_enviar");
    expect(ehCapacidadeMac("pr_ver")).toBe(false);
  });

  it("valida e-mail, telefone E.164, datas e limites", () => {
    expect(validarArgsMac("mail_enviar", { para: ["ana@exemplo.com"], assunto: "Oi", corpo: "Texto" })).toEqual({ capacidade: "mail_enviar", para: ["ana@exemplo.com"], assunto: "Oi", corpo: "Texto" });
    expect(() => validarArgsMac("mail_enviar", { para: ["ana"], assunto: "Oi", corpo: "x" })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("mail_enviar", { para: [], assunto: "Oi", corpo: "x" })).toThrow(ArgumentoMacInvalido);
    expect(validarArgsMac("imessage_enviar", { para: "+5511999998888", texto: "oi" }).capacidade).toBe("imessage_enviar");
    expect(() => validarArgsMac("imessage_enviar", { para: "11 99999-8888", texto: "oi" })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("calendario_ler", { de: "2026-11-01", ate: "2027-01-01" })).toThrow(/31 dias/);
    expect(() => validarArgsMac("calendario_ler", { de: "2026-11-10", ate: "2026-11-01" })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("calendario_ler", { de: "amanhã", ate: "2026-11-01" })).toThrow(ArgumentoMacInvalido);
    expect(validarArgsMac("mail_ler", {})).toEqual({ capacidade: "mail_ler", busca: "", limite: 20 });
    expect(() => validarArgsMac("mail_ler", { limite: 500 })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("notas_criar", { titulo: "a\u0007", corpo: "b" })).toThrow(/controle/);
    expect(() => validarArgsMac("shell", {})).toThrow(ArgumentoMacInvalido);
    expect(validarArgsMac("tela_clicar", { x: 10, y: 20 })).toEqual({ capacidade: "tela_clicar", x: 10, y: 20, botao: "esquerdo", vezes: 1 });
    expect(() => validarArgsMac("tela_clicar", { x: -1, y: 20 })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("tela_clicar", { x: 1, y: 2, vezes: 3 })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("tela_tecla", { tecla: "f99" })).toThrow(/tecla/);
    expect(validarArgsMac("tela_tecla", { tecla: "Enter", modificadores: ["comando", "comando"] })).toEqual({ capacidade: "tela_tecla", tecla: "enter", modificadores: ["comando"] });
    expect(() => validarArgsMac("tela_tecla", { tecla: "a", modificadores: ["fn"] })).toThrow(ArgumentoMacInvalido);
    expect(() => validarArgsMac("tela_rolar", { x: 1, y: 1, delta: 0 })).toThrow(ArgumentoMacInvalido);
  });

  it("o corpo da nota vira HTML escapado", () => {
    expect(htmlDaNota("<t>", "a & b\n\nc")).toBe("<div><b>&lt;t&gt;</b></div><div>a &amp; b</div><div><br></div><div>c</div>");
  });

  it("no plano: no Mac marca para rodar na máquina; fora do Mac tira do catálogo; sem conector, nada muda", () => {
    const fs: { nome: string; origem: string; conectorId: string | null; execucao?: "maquina" }[] = [
      { nome: "mac__mail_ler", origem: "conector", conectorId: "m" },
      { nome: "github__pr_ver", origem: "conector", conectorId: "g" },
      { nome: "lembrar", origem: "nod", conectorId: null },
    ];
    expect(ferramentasMacNoPlano(fs, "m", true).find((f) => f.nome === "mac__mail_ler")?.execucao).toBe("maquina");
    expect(ferramentasMacNoPlano(fs, "m", true).find((f) => f.nome === "github__pr_ver")?.execucao).toBeUndefined();
    expect(ferramentasMacNoPlano(fs, "m", false).map((f) => f.nome)).toEqual(["github__pr_ver", "lembrar"]);
    expect(ferramentasMacNoPlano(fs, null, false)).toEqual(fs);
  });
});

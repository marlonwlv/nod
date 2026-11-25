import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campoDeNome } from "../../../web/lib/nome-editavel.ts";

/**
 * DS · nome editável (revisão de 2026-11-20): o nome do bot e o da conta de IA se editam do mesmo jeito porque saem do
 * mesmo componente (web/lib/nome-editavel.ts). Estes testes travam isso: nenhuma tela faz o campo à mão, e o desenho dos
 * estados (hover, foco) mora numa regra só.
 */
const raiz = new URL("../../../web/", import.meta.url);
const ler = (p: string): string => readFileSync(new URL(p, raiz), "utf8");
const telas = readdirSync(new URL("telas/", raiz)).filter((f) => f.endsWith(".ts")).map((f) => [`telas/${f}`, ler(`telas/${f}`)] as const);
const folhas = readdirSync(raiz).filter((f) => f.endsWith(".css")).map((f) => [f, ler(f)] as const);

describe("nome editável (DS)", () => {
  it("o campo: rótulo escondido, a classe do DS, o dono, o salvo e a dica de Enter/Esc", () => {
    expect(campoDeNome({ dono: "conta", campo: "apelido", id: "c1", valor: "Leapy", rotulo: "Nome da conta", maxlength: 40, inputId: "x", classe: "cl-nome-campo", placeholder: "Dar um nome" })).toBe(
      '<label class="sr-only" for="x">Nome da conta</label>'
      + '<input id="x" class="cl-nome-campo nome-editavel" data-nome-editavel="conta" data-campo="apelido" data-id="c1" data-salvo="Leapy" value="Leapy" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Dar um nome" title="Enter salva · Esc desfaz" />',
    );
    expect(campoDeNome({ dono: "bot", campo: "nome", id: 'a"1', valor: "<b>", rotulo: "Nome", maxlength: 60 })).toContain('id="nome-bot-nome"');
    expect(campoDeNome({ dono: "bot", campo: "nome", id: 'a"1', valor: "<b>", rotulo: "Nome", maxlength: 60 })).toContain('data-id="a&quot;1" data-salvo="&lt;b&gt;" value="&lt;b&gt;"');
  });

  it("o bot (gaveta e celular) e a conta aberta usam o componente", () => {
    for (const f of ["telas/detalhes.ts", "telas/perfil-celular.ts", "telas/contas-lista.ts"]) expect(ler(f), f).toContain("campoDeNome({");
    expect(ler("main.ts")).toContain('registrarNomeEditavel("conta"');
    expect(ler("lib/gaveta-identidade.ts")).toContain('registrarNomeEditavel("bot"');
  });

  it("nenhuma tela faz à mão um campo de nome que salva no lugar (input com data-salvo)", () => {
    const amao = telas.filter(([, s]) => /<input[^>]*data-salvo=/.test(s)).map(([f]) => f);
    expect(amao).toEqual([]);
  });

  it("os estados (hover e foco) moram só em .nome-editavel; nenhuma folha redesenha o hover ou o foco de um nome", () => {
    const comRegra = folhas.filter(([, s]) => s.includes(".nome-editavel:hover {")).map(([f]) => f);
    expect(comRegra).toEqual(["navegacao.css"]);
    for (const [f, s] of folhas) {
      expect(s, f).not.toMatch(/\.(gvn-nome|gvn-sub|pfc-nome|pfc-sub|cl-nome-campo)[^{,]*:(hover|focus)/);
    }
  });
});

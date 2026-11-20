import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criarLeituraDeNovo, ESPERAS_DA_LEITURA_MS } from "../../../web/lib/leitura-de-novo.ts";

const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");
const erro500 = { codigo: "falha_interna", mensagem: "Algo deu errado do nosso lado.", status: 500 };

describe("a leitura de fundo que falhou com 5xx", () => {
  it("tenta de novo calada em 2, 5 e 10 s; a quarta falha vai à tela", () => {
    const agendadas: number[] = [];
    const relidas: string[] = [];
    const l = criarLeituraDeNovo<string>({ agendar: (fn, ms) => { agendadas.push(ms); fn(); }, reler: (q) => relidas.push(q) });
    expect([l.falhou("nao-lidos", erro500), l.falhou("nao-lidos", erro500), l.falhou("nao-lidos", erro500)]).toEqual(["calar", "calar", "calar"]);
    expect(agendadas).toEqual([...ESPERAS_DA_LEITURA_MS]);
    expect(relidas).toEqual(["nao-lidos", "nao-lidos", "nao-lidos"]);
    expect(l.falhou("nao-lidos", erro500)).toBe("mostrar");
    // Depois de mostrar, a conta recomeça.
    expect(l.falhou("nao-lidos", erro500)).toBe("calar");
  });

  it("a leitura que dá certo zera a conta; cada leitura tem a sua", () => {
    const l = criarLeituraDeNovo<string>({ agendar: () => {}, reler: () => {} });
    l.falhou("frota", erro500);
    l.falhou("frota", erro500);
    l.deuCerto("frota");
    expect(l.falhou("frota", erro500)).toBe("calar");
    expect(l.falhou("sua-vez", erro500)).toBe("calar");
  });

  it("4xx e erro da própria web vão à tela na hora (não são falha passageira)", () => {
    const l = criarLeituraDeNovo<string>({ agendar: () => {}, reler: () => {} });
    expect(l.falhou("frota", { codigo: "entrada_invalida", mensagem: "x", status: 422 })).toBe("mostrar");
    expect(l.falhou("frota", { codigo: "erro_da_tela", mensagem: "x" })).toBe("mostrar");
  });
});

describe("o erro de uma ação é um aviso compacto", () => {
  it("cartão branco centrado com o vermelho só no ícone, Detalhes discreto e × de ícone", () => {
    const c = css("casca.css");
    expect(c).toContain("#erro:not(:empty) { display: flex; justify-content: center; }");
    expect(c).toMatch(/#erro > \.erro \{[^}]*width: fit-content;[^}]*background: var\(--surface-elevated\);[^}]*color: var\(--ink\);/);
    expect(c).toContain("#erro > .erro > .erro-ic { flex: none; color: var(--danger); }");
    expect(c).toContain("#erro > .erro > .erro-fechar {");
  });

  it("o main monta o aviso com ícone, texto, × com nome e o sumiço em 8 s", () => {
    const m = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(m).toContain('<span class="erro-txt">${esc(e.mensagem)}</span>');
    expect(m).toContain('data-act="fechar-erro" aria-label="Fechar o aviso"');
    expect(m).toContain("const SUMICO_DO_ERRO_MS = 8000;");
    expect(m).toContain('leituraDeNovo.falhou(q, erro) === "calar"');
  });
});

describe("o painel de detalhes e as linhas sem balão", () => {
  it("o cartão das seções segue o do Computador: sem sombra, 4 px de respiro, linha com raio 8", () => {
    const c = css("casca.css");
    expect(c).toMatch(/\.detalhes \.gv-cartao \{\s*padding: 4px;[^}]*box-shadow: none;/);
    expect(c).toContain(".detalhes .gv-linha { min-height: 52px; box-sizing: border-box; padding: 8px 8px 8px 12px; gap: 10px; border-radius: 8px; }");
  });

  it("as ações do recibo ficam logo depois do texto, como na fala do bot", () => {
    const c = css("chat.css");
    expect(c).toContain(".timeline .msg-linha.msg-encolhido { width: fit-content; max-width: 100%; }");
    expect(c).toContain(".timeline .msg-linha.msg-encolhido .msg-actions { left: calc(100% + 4px); right: auto; gap: 0; }");
  });
});

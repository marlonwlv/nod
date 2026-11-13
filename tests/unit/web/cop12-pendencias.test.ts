import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linhasDaFolha } from "../../../web/lib/atalhos.ts";
import { htmlFolhaDeAtalhos } from "../../../web/telas/menu-conta.ts";

/**
 * COP-12 (spec "A · Detalhes"): as pendências da rodada — o fade e a barra de rolagem de 6 px da lista, a legenda
 * "Nome · título" dos fixados e o diálogo de atalhos separado da Ajuda.
 */
const ler = (arquivo: string) => readFileSync(new URL(`../../../web/${arquivo}`, import.meta.url), "utf8");
const main = ler("main.ts");
const casca = ler("casca.css");

/** O bloco da barra aberta do ADR-179 (o último `html:not([data-largura="recolhida"]) #sidebar.sidebar {` do arquivo). */
const blocoAberta = (() => {
  const ini = casca.lastIndexOf('html:not([data-largura="recolhida"]) #sidebar.sidebar {');
  return casca.slice(ini, casca.indexOf("\n}\n", ini));
})();

describe("COP-12: a lista rolável da barra", () => {
  it("barra de rolagem de 6 px, raio 9999, borda-3, invisível até rolar", () => {
    expect(blocoAberta).toContain("& .list::-webkit-scrollbar { width: 6px; }");
    expect(blocoAberta).toMatch(/& \.list::-webkit-scrollbar-thumb \{[^}]*border-radius: 9999px; background: transparent; \}/);
    expect(blocoAberta).toContain("& .list[data-rolando]::-webkit-scrollbar-thumb { background: var(--borda-sutil); }");
  });

  it("scrollbar-width/scrollbar-color só onde não há ::-webkit-scrollbar (no Chromium 121+ eles anulariam os 6 px)", () => {
    expect(blocoAberta).not.toMatch(/scrollbar-(width|color)/);
    const suporte = casca.slice(casca.indexOf("@supports not selector(::-webkit-scrollbar) {"));
    expect(suporte.slice(0, suporte.indexOf("\n}\n"))).toMatch(/\.list \{ scrollbar-width: thin; scrollbar-color: transparent transparent; \}/);
  });

  it("a calha de 6 fica nos 12 de padding da direita: a linha tem 316 em 340, com ou sem rolagem", () => {
    expect(blocoAberta).toContain("& .list { padding: 0 6px 0 12px; scrollbar-gutter: stable; }");
    expect(340 - 12 - 6 - 6).toBe(316);
  });

  it("a máscara dissolve só a borda marcada; a opacidade anima em 150 ms ease ao rolar e no ⌘B, seca no resto", () => {
    expect(casca).toMatch(/#sidebar\.sidebar \.list \{\n {2}--fade-lista: 14px;\n {2}mask-image: linear-gradient\(to bottom, rgb\(0 0 0 \/ var\(--fade-topo\)\), #000 var\(--fade-lista\), #000 calc\(100% - var\(--fade-lista\)\), rgb\(0 0 0 \/ var\(--fade-base\)\)\);/);
    expect(casca).toContain("#sidebar.sidebar .list[data-fade-topo] { --fade-topo: 0; }");
    expect(casca).toContain("#sidebar.sidebar .list[data-fade-base] { --fade-base: 0; }");
    expect(casca).toContain("#sidebar.sidebar .list[data-rolando], html[data-barra-anim] #sidebar.sidebar .list { transition: --fade-topo 150ms ease, --fade-base 150ms ease; }");
    // A transição antiga de opacidade da lista inteira não volta: ela apagaria as linhas, não a máscara.
    expect(casca).not.toMatch(/\.list \{[^}]*transition: opacity 150ms/);
  });

  it("as duas opacidades são registradas fora do @media (o @property não vale dentro de regra condicional)", () => {
    const registro = casca.indexOf("@property --fade-topo");
    expect(registro).toBeGreaterThan(-1);
    expect(casca.indexOf("@property --fade-base")).toBeGreaterThan(registro);
    // Profundidade de chaves 0 no ponto do registro (sem contar as dos comentários).
    const antes = casca.slice(0, registro).replace(/\/\*[\s\S]*?\*\//g, "");
    expect((antes.match(/\{/g) ?? []).length).toBe((antes.match(/\}/g) ?? []).length);
  });

  it("main.ts marca as bordas ao redesenhar, ao rolar, ao filtrar e ao mudar o tamanho da janela", () => {
    const manter = main.slice(main.indexOf("function manterRolagemDaBarra"), main.indexOf("function marcarBordasDaLista"));
    expect(manter).toContain("marcarBordasDaLista(lista);");
    const rolar = main.slice(main.indexOf('document.addEventListener("scroll", (ev) => {'));
    expect(rolar.slice(0, rolar.indexOf("}, true);"))).toContain("marcarBordasDaLista(lista);");
    const filtrar = main.slice(main.indexOf("function filtrarBots"), main.indexOf("function filtrarBots") + 2600);
    expect(filtrar).toContain("if (lista && !celular.ativo()) marcarBordasDaLista(lista);");
  });
});

describe("COP-12: a legenda dos fixados", () => {
  it("no computador o fixado mostra \"Nome · título\"; no celular, só o nome", () => {
    expect(main).toContain("const legenda = ehCelular ? a.nome : nomeCompleto;");
    expect(main).toMatch(/class="fixado-bt"[^\n]*<b>\$\{esc\(legenda\)\}<\/b>/);
  });

  it("o ⌘1–9 anuncia só o nome, não a legenda", () => {
    expect(main).toContain('const nome = botGerido(bot.dataset.agente)?.nome ?? bot.querySelector("b")?.textContent ?? "";');
  });
});

describe("COP-12: Atalhos de teclado não é a Ajuda", () => {
  it("o diálogo traz só as teclas do lugar, com título, leitura falada e Fechar", () => {
    const linhas = linhasDaFolha("app-mac");
    const h = htmlFolhaDeAtalhos(linhas);
    expect(h).toContain("<h2>Atalhos de teclado</h2>");
    expect(h.match(/class="mc-atalho"/g)).toHaveLength(linhas.length);
    expect(h.match(/class="cfg-kbd"/g)).toHaveLength(linhas.length);
    expect(h).toContain('<span class="sr-only">Command N</span>');
    expect(h).toContain("data-fechar>Fechar</button>");
    // A Ajuda (Configurações) é o onboarding; o diálogo não repete a ajuda.
    expect(h).not.toContain("onboarding");
  });

  it("o título é escapado", () => {
    expect(htmlFolhaDeAtalhos([{ titulo: "<img>", combinacoes: [["?"]], falado: "<b>" }])).not.toMatch(/<img>|<b>/);
  });

  it("Suporte › Atalhos, ⌘/ e ?, a paleta e o ajuste abrem o diálogo; só a Ajuda abre Configurações › Ajuda", () => {
    expect(main).not.toContain('abrirEspaco("ajuda")');
    expect(main).toContain('acao: (qual) => (qual === "atalhos" ? abrirAtalhos() : abrirSobreONod(__NOD_VERSAO__)),');
    expect(main).toContain('if (a.tipo === "folha") { abrirAtalhos(); return true; }');
    expect(main).toContain('case "atalhos": abrirAtalhos(); return;');
    expect(main).toContain('if (a.id === "atalhos") { abrirAtalhos(); return; }');
    expect(main).toContain("const abrirAtalhos = (): void => abrirFolhaDeAtalhos(linhasDaFolha(LUGAR_TECLADO));");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATRASO_PREVIA_MS, enderecoDaPrevia } from "../../../web/lib/links.ts";
import { CHECK_CODIGO_MS, realcarCodigo, textoFormatado } from "../../../web/lib/texto-formatado.ts";

/** COP-14 (item 4): o formato da resposta dentro do balão do bot. */
const p = (html: string): string => `<p class="md-paragrafo">${html}</p>`;
const desesc = (html: string): string => html.replace(/<[^>]+>/g, "").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

describe("blocos da resposta (COP-14, item 4)", () => {
  it("3 parágrafos, lista, código e link: cada bloco é um elemento, sem <br> entre eles", () => {
    const html = textoFormatado("Um.\n\nDois.\n\nTrês [docs](https://exemplo.com/a).\n\n- a\n- b\n\n```js\nx = 1\n```");
    expect(html.startsWith(`${p("Um.")}${p("Dois.")}<p class="md-paragrafo">Três <a class="lk"`)).toBe(true);
    expect(html).toContain('</p><ul class="md-lista"><li>a</li><li>b</li></ul><div class="md-codigo">');
    expect(html).not.toMatch(/<br>\s*<(p|ul|div)/);
  });

  it("linha em branco dentro do texto com lista fecha o parágrafo (antes virava <br><br>)", () => {
    expect(textoFormatado("a\n\nb\n- c")).toBe(`${p("a")}${p("b")}<ul class="md-lista"><li>c</li></ul>`);
  });

  it("um parágrafo só continua sem <p> (cartões e Não lidos não mudam)", () => {
    expect(textoFormatado("oi **você**\ntudo bem?")).toBe("oi <strong>você</strong><br>tudo bem?");
  });

  it("texto antes e depois de uma tabela vira parágrafo", () => {
    const html = textoFormatado("Antes\n| a | b |\n|---|---|\n| 1 | 2 |\nDepois");
    expect(html.startsWith(p("Antes"))).toBe(true);
    expect(html.endsWith(p("Depois"))).toBe(true);
  });
});

describe("bloco de código (COP-14, item 4)", () => {
  it("o Copiar é só ícone (copiar + check); o rótulo fica para o leitor de tela", () => {
    const html = textoFormatado("```ts\nconst a = 1\n```");
    expect(html).toContain('class="md-codigo-copiar" data-act="copiar-codigo" aria-label="Copiar código"');
    expect(html).toContain('<svg class="md-ic-copiar"');
    expect(html).toContain('<svg class="md-ic-check"');
    expect(CHECK_CODIGO_MS).toBe(1_500);
  });

  it("realce: pontuação, strings, números e chaves ganham classe; o texto do <code> é o código exato", () => {
    const codigo = 'const o = { "nome": "Ana \\"A\\"", idade: 42, ok: true }; // it\'s <b>\nfoo(`t\n${1}`, 0x1F, 3.5e-2)';
    const html = realcarCodigo(codigo);
    expect(desesc(html)).toBe(codigo);
    expect(html).toContain('<span class="sx-c">&quot;nome&quot;</span><span class="sx-p">:</span>');
    expect(html).toContain('<span class="sx-s">&quot;Ana \\&quot;A\\&quot;&quot;</span>');
    expect(html).toContain('<span class="sx-c">idade</span><span class="sx-p">:</span> <span class="sx-n">42</span>');
    expect(html).toContain("// it&#39;s &lt;b&gt;\n");
    expect(html).toContain('<span class="sx-n">0x1F</span>');
    expect(html).toContain('<span class="sx-n">3.5e-2</span>');
    expect(html).not.toContain("<b>");
  });

  it("número dentro de identificador não é número; string sem aspa de fechamento para no fim da linha", () => {
    expect(realcarCodigo("abc1")).toBe("abc1");
    expect(realcarCodigo('x = "aberta\ny')).toBe('x <span class="sx-p">=</span> <span class="sx-s">&quot;aberta</span>\ny');
  });

  it("a cerca aberta não ganha realce (a string ainda sem fechamento pintaria o resto a cada quadro)", () => {
    expect(textoFormatado('```js\nx = "a')).toContain("<pre><code>x = &quot;a</code></pre>");
  });

  it("HTML do bot dentro do código sai escapado também com o realce", () => {
    const html = textoFormatado('```html\n<img src=x onerror="alert(1)">\n```');
    expect(html).not.toContain("<img");
  });
});

describe("links (COP-14, item 4)", () => {
  it("[título](url) de site comum: o título no link, o globo dentro (só o balão do bot mostra), abre fora", () => {
    const html = textoFormatado("Veja [a documentação](https://exemplo.com/docs).");
    expect(html).toMatch(/<a class="lk" href="https:\/\/exemplo\.com\/docs" data-lk target="_blank" rel="noopener noreferrer nofollow"><span class="lk-ic lk-ic-web lk-ic-so-chat" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span>a documentação<\/a>/);
  });

  it("link de app guarda o próprio ícone, sem a marca de só-chat", () => {
    const html = textoFormatado("[PR](https://github.com/acme/loja/pull/1)");
    expect(html).toContain('<span class="lk-ic lk-ic-github" aria-hidden="true">');
  });

  it("nome que parece endereço continua dando lugar ao chip do destino real (ADR-053)", () => {
    expect(textoFormatado("[github.com/acme](https://mal.example/x)")).toContain('<span class="lk-rotulo">mal.example/x</span>');
  });
});

describe("prévia do link (COP-14, item 4)", () => {
  it("o endereço sem https://, sem a barra solta da raiz; http:// fica à vista", () => {
    expect(enderecoDaPrevia("https://exemplo.com/")).toBe("exemplo.com");
    expect(enderecoDaPrevia("https://exemplo.com/a/b?c=1#d")).toBe("exemplo.com/a/b?c=1#d");
    expect(enderecoDaPrevia("http://exemplo.com/a")).toBe("http://exemplo.com/a");
    expect(enderecoDaPrevia("javascript:alert(1)")).toBeNull();
    expect(enderecoDaPrevia("https://u:s@exemplo.com/")).toBeNull();
    expect(ATRASO_PREVIA_MS).toBe(500);
  });
});

describe("chat-formato.css (COP-14, item 4)", () => {
  const css = readFileSync(new URL("../../../web/chat-formato.css", import.meta.url), "utf8");
  const regra = (seletor: string): string => {
    const i = css.indexOf(`${seletor} {`);
    expect(i, seletor).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf("}", i));
  };

  it("10 px entre blocos, lista 20/0/4 com marcador terciário, título 15/22 peso 600", () => {
    expect(css).toMatch(/\+ :is\([^)]*\) \{ margin-top: 10px; \}/);
    expect(regra(".message.bot .bubble .md-lista")).toContain("padding-left: 20px");
    expect(regra(".message.bot .bubble .md-lista li + li")).toContain("margin-top: 4px");
    expect(regra(".message.bot .bubble .md-lista li::marker")).toContain("var(--chat-tinta-3)");
    expect(regra(".message.bot .bubble .md-titulo")).toMatch(/font-size: 15px; line-height: 22px; font-weight: 600/);
  });

  it("cartão do código: tokens, raio 14, sem sombra, mono 12/18; Copiar 20×20 a 6 px, opacidade 0 até o hover", () => {
    const cartao = regra(".message.bot .bubble .md-codigo");
    for (const parte of ["var(--chat-codigo-fundo)", "1px solid var(--chat-codigo-borda)", "border-radius: 14px", "box-shadow: none"]) expect(cartao).toContain(parte);
    const codigo = regra(".message.bot .bubble .md-codigo pre code");
    for (const parte of ["ui-monospace", "font-size: 12px", "line-height: 18px", "padding: 0 10px", "white-space: pre"]) expect(codigo).toContain(parte);
    const copiar = regra(".message.bot .bubble .md-codigo-copiar");
    for (const parte of ["top: 6px", "right: 6px", "width: 20px", "height: 20px", "border-radius: 4px"]) expect(copiar).toContain(parte);
    expect(regra(".timeline .md-codigo:not(:hover) .md-codigo-copiar:not(:focus-visible):not(.copiado)")).toContain("opacity: 0");
  });

  it("prévia: superfície, sombra de popover, raio 10, altura 30, endereço até 320 px com reticências", () => {
    const previa = regra(".lk-previa");
    for (const parte of ["var(--chat-superficie)", "var(--sombra-popover)", "border-radius: 10px", "height: 30px"]) expect(previa).toContain(parte);
    expect(regra(".lk-previa-url")).toMatch(/max-width: 320px.*text-overflow: ellipsis/);
  });

  it("o globo de site comum só aparece no balão do bot; no da pessoa, link cru sem ícone", () => {
    expect(regra(".lk-ic.lk-ic-so-chat")).toContain("display: none");
    expect(regra(".message.you .bubble :is(.lk-ic, .lk-dominio)")).toContain("display: none");
  });
});

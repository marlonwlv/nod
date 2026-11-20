import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estiloDoTexto } from "../../../../web/react/html/html-em-react.tsx";
import { montarRegiaoPorHtml, type RegiaoPorHtml } from "../../../../web/react/html/regiao-por-html.tsx";
import { desmontarRegiao, regioesMontadas } from "../../../../web/react/regioes.tsx";
import { devolverRegiao, entregarRegiao, regiao, regiaoEmVoltaDe, regiaoEntregue, regiaoMudaria } from "../../../../web/lib/regioes.ts";

/**
 * ADR-189: a região desenhada pelo React a partir do HTML da tela. O que importa para a performance (e o que estes
 * testes travam): o DOM é o mesmo do innerHTML, só o pedaço que mudou é tocado e o custom element fica no mesmo nó.
 */
const linha = (id: string, nome: string, estado = "parado", previa = "oi") =>
  `<div class="bot-row" data-bot-contexto="${id}" data-busca="${nome.toLowerCase()}"><button class="row" data-act="abrir-conversa" data-agente="${id}" aria-label="Abrir conversa com ${nome}"><nod-mascote class="icon mascote c-azul" data-estado="${estado}" state="${estado === "trabalhando" ? "orbit" : "idle"}" shape="round" role="img" title="${nome}"></nod-mascote><span class="txt"><b>${nome}</b><span>${previa}</span></span></button><button type="button" class="bot-mais" data-act="menu-agente" data-id="${id}" aria-label="Ações de ${nome}">⋯</button></div>`;

const barra = (linhas: string[], extra = "") =>
  `<div class="search-wrap"><label class="search" hidden><input id="busca-bots" placeholder="Buscar agentes…" autocomplete="off" /></label></div>
    <div class="list"><section class="section time" data-grupo="secao" data-secao="">${linhas.join("")}</section>${extra}</div>
    <div class="rodape"><button type="button" class="me" data-act="menu-conta"><svg width="16" height="16" viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button></div>`;

/** O mesmo HTML pelo caminho do innerHTML: a régua do "DOM igual". */
function porString(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.innerHTML;
}

describe("região desenhada pelo React a partir do HTML (ADR-189)", () => {
  let r: RegiaoPorHtml;
  beforeEach(() => {
    document.body.innerHTML = `<aside id="sidebar"><p>desenho antigo</p></aside>`;
    act(() => { r = montarRegiaoPorHtml("sidebar"); });
  });
  afterEach(() => {
    for (const id of regioesMontadas()) act(() => desmontarRegiao(id));
  });

  it("desenha o mesmo DOM que o innerHTML (tags, classes, atributos, svg e texto)", () => {
    const html = barra([linha("a1", "Vera"), linha("a2", "Tuca")]);
    r.desenhar(html);
    expect(document.getElementById("sidebar")!.innerHTML).toBe(porString(html));
  });

  it("só a linha que mudou é tocada: as outras e o mascote dela ficam no mesmo nó", () => {
    r.desenhar(barra([linha("a1", "Vera"), linha("a2", "Tuca"), linha("a3", "Lia")]));
    const raiz = document.getElementById("sidebar")!;
    const antes = [...raiz.querySelectorAll(".bot-row")];
    const mascoteDaTuca = raiz.querySelector('[data-bot-contexto="a2"] nod-mascote')!;
    const botaoDaVera = raiz.querySelector('[data-bot-contexto="a1"] .row')!;

    r.desenhar(barra([linha("a1", "Vera"), linha("a2", "Tuca", "trabalhando", "lendo o relatório"), linha("a3", "Lia")]));

    const depois = [...raiz.querySelectorAll(".bot-row")];
    expect(depois).toHaveLength(3);
    depois.forEach((el, i) => expect(el).toBe(antes[i]));
    expect(raiz.querySelector('[data-bot-contexto="a1"] .row')).toBe(botaoDaVera);
    // O mascote não é recriado: recebe o estado novo no mesmo elemento (o motor dele segue).
    const mascote = raiz.querySelector('[data-bot-contexto="a2"] nod-mascote')!;
    expect(mascote).toBe(mascoteDaTuca);
    expect(mascote.getAttribute("state")).toBe("orbit");
    expect(mascote.getAttribute("data-estado")).toBe("trabalhando");
    expect(raiz.querySelector('[data-bot-contexto="a2"] .txt')!.textContent).toBe("Tucalendo o relatório");
    // E o DOM continua o mesmo do innerHTML.
    expect(r.medida()).toMatchObject({ novos: 2 });
  });

  it("linha nova entra no lugar e a que saiu some, sem regravar as vizinhas", () => {
    r.desenhar(barra([linha("a1", "Vera"), linha("a3", "Lia")]));
    const raiz = document.getElementById("sidebar")!;
    const lia = raiz.querySelector('[data-bot-contexto="a3"]');
    const html = barra([linha("a2", "Tuca"), linha("a3", "Lia")]);
    r.desenhar(html);
    expect([...raiz.querySelectorAll(".bot-row")].map((e) => e.getAttribute("data-bot-contexto"))).toEqual(["a2", "a3"]);
    expect(raiz.querySelector('[data-bot-contexto="a3"]')).toBe(lia);
    expect(raiz.innerHTML).toBe(porString(html));
  });

  it("o mesmo HTML não vai ao React; o que a pessoa digitou no campo fica", () => {
    const html = barra([linha("a1", "Vera")]);
    r.desenhar(html);
    const campo = document.getElementById("busca-bots") as HTMLInputElement;
    campo.value = "ve";
    expect(r.mudaria(html)).toBe(false);
    r.desenhar(html);
    r.desenhar(barra([linha("a1", "Vera", "trabalhando")]));
    expect(document.getElementById("busca-bots")).toBe(campo);
    expect(campo.value).toBe("ve");
  });

  it("chave repetida entre irmãos não quebra: cada uma ganha o seu nó", () => {
    const html = `<div class="list">${linha("a1", "Vera")}${linha("a1", "Vera")}</div>`;
    r.desenhar(html);
    expect(document.querySelectorAll(".bot-row")).toHaveLength(2);
    expect(document.getElementById("sidebar")!.innerHTML).toBe(porString(html));
  });

  it("vazio limpa a região (sem sessão)", () => {
    r.desenhar(barra([linha("a1", "Vera")]));
    r.desenhar("");
    expect(document.getElementById("sidebar")!.childNodes).toHaveLength(0);
  });

  it("campos: o value e o checked do HTML são os iniciais, e o textarea e o select também", () => {
    const html = `<form class="f"><input name="a" value="um"><input type="checkbox" name="b" checked><textarea name="c">texto</textarea><select name="d"><option value="x">X</option><option value="y" selected>Y</option></select><details data-chave="d1" open><summary>s</summary><p>p</p></details></form>`;
    r.desenhar(html);
    const raiz = document.getElementById("sidebar")!;
    expect((raiz.querySelector('[name="a"]') as HTMLInputElement).value).toBe("um");
    expect((raiz.querySelector('[name="b"]') as HTMLInputElement).checked).toBe(true);
    expect((raiz.querySelector('[name="c"]') as HTMLTextAreaElement).value).toBe("texto");
    expect((raiz.querySelector('[name="d"]') as HTMLSelectElement).value).toBe("y");
    expect((raiz.querySelector("details") as HTMLDetailsElement).open).toBe(true);
  });

  it("o estilo inline vira objeto, com as variáveis do CSS", () => {
    expect(estiloDoTexto("--mascote-cor: var(--azul); grid-template-columns: 1fr 2fr;")).toEqual({ "--mascote-cor": "var(--azul)", gridTemplateColumns: "1fr 2fr" });
    const html = `<div class="g" style="--x: 3px; margin-top: 2px">a</div>`;
    r.desenhar(html);
    const el = document.querySelector(".g") as HTMLElement;
    expect(el.style.getPropertyValue("--x")).toBe("3px");
    expect(el.style.marginTop).toBe("2px");
  });
});

describe("o registro de regiões entregues ao React (ADR-189)", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="detalhes"></div>`;
  });
  afterEach(() => {
    devolverRegiao("detalhes");
    for (const id of regioesMontadas()) act(() => desmontarRegiao(id));
  });

  it("entregue, `regiao()` vai pelo React: o mesmo DOM, e o nó que não mudou fica", () => {
    regiao("detalhes", `<section class="painel"><p data-chave="a">um</p><p data-chave="b">dois</p></section>`);
    act(() => entregarRegiao("detalhes", montarRegiaoPorHtml("detalhes")));
    expect(regiaoEntregue("detalhes")).toBe(true);
    const el = document.getElementById("detalhes")!;
    const a = el.querySelector('[data-chave="a"]');
    regiao("detalhes", `<section class="painel"><p data-chave="a">um</p><p data-chave="b">três</p></section>`);
    expect(el.querySelector('[data-chave="a"]')).toBe(a);
    expect(el.textContent).toBe("umtrês");
    expect(regiaoMudaria("detalhes", `<section class="painel"><p data-chave="a">um</p><p data-chave="b">três</p></section>`)).toBe(false);
  });

  it("devolver volta ao innerHTML com o último HTML, e o desenho por string segue dali", () => {
    act(() => entregarRegiao("detalhes", montarRegiaoPorHtml("detalhes")));
    regiao("detalhes", `<p class="x">pelo React</p>`);
    act(() => devolverRegiao("detalhes"));
    const el = document.getElementById("detalhes")!;
    expect(regiaoEntregue("detalhes")).toBe(false);
    expect(el.innerHTML).toBe(`<p class="x">pelo React</p>`);
    expect(regiaoMudaria("detalhes", `<p class="x">pelo React</p>`)).toBe(false);
    regiao("detalhes", `<p>por string</p>`);
    expect(el.innerHTML).toBe("<p>por string</p>");
  });

  it("regiaoEmVoltaDe com um nó de fora morando na região: ela volta ao innerHTML e o nó fica", () => {
    act(() => entregarRegiao("detalhes", montarRegiaoPorHtml("detalhes")));
    regiao("detalhes", `<p>antes</p>`);
    const el = document.getElementById("detalhes")!;
    const busca = document.createElement("div");
    busca.className = "busca";
    act(() => devolverRegiao("detalhes"));
    el.append(busca);
    regiaoEmVoltaDe("detalhes", `<p>depois</p>`, busca);
    expect(el.lastElementChild).toBe(busca);
    expect(el.textContent).toBe("depois");
  });
});

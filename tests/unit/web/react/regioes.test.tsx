import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARCA_REGIAO, desmontarRegiao, montarRegiao, regiaoEhDoReact, regioesMontadas } from "../../../../web/react/regioes.tsx";

/** ADR-179: um createRoot por região do index.html, a região inteira, montar e desmontar. */
describe("regiões do React", () => {
  beforeEach(() => {
    document.body.innerHTML = `<aside id="sidebar"><p>desenho antigo</p></aside><header id="cabecalho"></header>`;
  });
  afterEach(() => {
    for (const id of regioesMontadas()) act(() => desmontarRegiao(id));
  });

  it("monta na região inteira, tirando o desenho antigo, e marca o nó", () => {
    act(() => { montarRegiao("sidebar", <nav>barra nova</nav>); });
    const el = document.getElementById("sidebar")!;
    expect(el.textContent).toBe("barra nova");
    expect(el.hasAttribute(MARCA_REGIAO)).toBe(true);
    expect(regiaoEhDoReact("sidebar")).toBe(true);
    expect(regiaoEhDoReact("cabecalho")).toBe(false);
  });

  it("redesenha com conteúdo novo pelo mesmo root", () => {
    let r!: ReturnType<typeof montarRegiao>;
    act(() => { r = montarRegiao("cabecalho", <h1>um</h1>); });
    act(() => r.desenhar(<h1>dois</h1>));
    expect(document.getElementById("cabecalho")!.textContent).toBe("dois");
  });

  it("desmonta e devolve o nó vazio, sem a marca", () => {
    let r!: ReturnType<typeof montarRegiao>;
    act(() => { r = montarRegiao("sidebar", <nav>x</nav>); });
    act(() => r.desmontar());
    const el = document.getElementById("sidebar")!;
    expect(el.childNodes.length).toBe(0);
    expect(el.hasAttribute(MARCA_REGIAO)).toBe(false);
    expect(regioesMontadas()).toEqual([]);
    // Desmontar de novo não quebra; montar de novo funciona.
    act(() => desmontarRegiao("sidebar"));
    act(() => { montarRegiao("sidebar", <nav>de novo</nav>); });
    expect(el.textContent).toBe("de novo");
  });

  it("recusa região que não existe e região já montada", () => {
    expect(() => montarRegiao("nao-existe", <p />)).toThrow(/não existe/);
    act(() => { montarRegiao("sidebar", <nav />); });
    expect(() => montarRegiao("sidebar", <nav />)).toThrow(/já está montada/);
  });
});

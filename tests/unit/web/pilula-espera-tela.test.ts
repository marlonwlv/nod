// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { criarRolagem } from "../../../web/lib/rolagem-na-tela.ts";

/**
 * ADR-191 (definido em 2026-11-20, item E): a pílula "A Ada espera você" ligada à timeline. Os cartões marcados com
 * `data-pedido-espera` fora da janela fazem a pílula aparecer; um à vista a tira; com vários, o alvo é o mais antigo.
 * O happy-dom não faz layout: cada elemento diz onde está pelo getBoundingClientRect.
 */
type Caixa = { topo: number; base: number };

function posicionar(el: Element, topo: number, base: number): void {
  Object.defineProperty(el, "getBoundingClientRect", { value: () => ({ top: topo, bottom: base, left: 0, right: 0, width: 0, height: base - topo, x: 0, y: topo, toJSON: () => ({}) }) });
}

function montar(cartoes: { id: string; nome: string; frase: string; topo: number }[], janela: Caixa = { topo: 0, base: 600 }) {
  document.body.innerHTML = `<div id="timeline"><div class="timeline">${cartoes.map((c) => `<div class="pedido-que-espera" data-pedido-espera="${c.id}" data-nome="${c.nome}" data-frase="${c.frase}"></div>`).join("")}</div></div><div id="pilula"></div>`;
  const caixa = document.getElementById("timeline") as HTMLElement;
  posicionar(caixa, janela.topo, janela.base);
  cartoes.forEach((c, i) => {
    const el = caixa.querySelectorAll("[data-pedido-espera]")[i];
    if (el) posicionar(el, c.topo, c.topo + 80);
  });
  const lugar = document.getElementById("pilula") as HTMLElement;
  const rolagem = criarRolagem(caixa, lugar, () => false);
  rolagem.depoisDeDesenhar("c1", true);
  return lugar;
}

describe("a pílula na tela", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("o cartão acima da janela (a pessoa rolou, o bot escreveu muito depois): 'A Ada espera você: entrar no Drive'", () => {
    const lugar = montar([{ id: "d1", nome: "Ada", frase: "entrar no Drive", topo: -900 }]);
    expect(lugar.innerHTML).toContain("A Ada espera você: <b>entrar no Drive</b>");
    expect(lugar.querySelector("[data-act='ver-decisao']")?.getAttribute("data-id")).toBe("d1");
  });

  it("com o cartão à vista, nada", () => {
    expect(montar([{ id: "d1", nome: "Ada", frase: "entrar no Drive", topo: 100 }]).innerHTML).toBe("");
  });

  it("dois fora: a contagem, e o 'Ver' leva ao mais antigo", () => {
    const lugar = montar([{ id: "velho", nome: "Ada", frase: "entrar no Drive", topo: -2000 }, { id: "novo", nome: "Ada", frase: "conectar o Gmail", topo: -900 }]);
    expect(lugar.innerHTML).toContain("2 pedidos esperam você");
    expect(lugar.querySelector("[data-act='ver-decisao']")?.getAttribute("data-id")).toBe("velho");
  });
});

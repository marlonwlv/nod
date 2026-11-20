import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { desenharHtmlNoNo } from "../../../../../web/react/telas/telas.tsx";

/**
 * ADR-179 (item 2): o React desenha no `#qcp` o mesmo HTML do controle do quadro compartilhado. Reconciliando em vez de
 * regravar, o que a pessoa digitou e o foco ficam no mesmo nó; o casco que o main recria ganha outro root.
 */
const html = (titulo: string) => `<div class="qcp"><h1 class="qcp-tit">${titulo}</h1><form class="qcp-comentar" data-form="qcp-comentar" data-id="t1"><input id="qcp-com" name="texto" placeholder="Comentar"><button type="submit" class="qd-link">Comentar</button></form></div>`;

describe("o #qcp desenhado pelo React", () => {
  it("o mesmo DOM do HTML; o redesenho troca só o que mudou, e o campo com o texto e o foco é o mesmo nó", () => {
    document.body.innerHTML = '<div id="qcp" class="qcp-casco"></div>';
    const el = document.getElementById("qcp")!;
    act(() => desenharHtmlNoNo(el, html("Quadro do Marlon")));
    expect(el.querySelector(".qcp-tit")?.textContent).toBe("Quadro do Marlon");
    expect(el.querySelector('form[data-form="qcp-comentar"][data-id="t1"]')).toBeTruthy();
    const campo = el.querySelector<HTMLInputElement>("#qcp-com")!;
    campo.focus();
    campo.value = "meu comentário";
    act(() => desenharHtmlNoNo(el, html("Quadro do Marlon · meta nova")));
    expect(el.querySelector(".qcp-tit")?.textContent).toBe("Quadro do Marlon · meta nova");
    expect(el.querySelector("#qcp-com")).toBe(campo);
    expect(campo.value).toBe("meu comentário");
    expect(document.activeElement).toBe(campo);
  });

  it("o casco recriado (a timeline regravada) ganha um root novo; o velho sai", () => {
    document.body.innerHTML = '<div id="qcp" class="qcp-casco"></div>';
    const velho = document.getElementById("qcp")!;
    act(() => desenharHtmlNoNo(velho, html("A")));
    document.body.innerHTML = '<div id="qcp" class="qcp-casco"></div>';
    const novo = document.getElementById("qcp")!;
    act(() => desenharHtmlNoNo(novo, html("B")));
    expect(novo.querySelector(".qcp-tit")?.textContent).toBe("B");
    expect(velho.innerHTML).toBe("");
  });
});

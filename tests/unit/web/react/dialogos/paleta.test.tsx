import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { filtrarPaleta, type ItemPaleta } from "../../../../../web/lib/paleta.ts";
import { cascaDaPaleta, listaDaPaleta } from "../../../../../web/telas/paleta.ts";
import { criarPaletaNoReact } from "../../../../../web/react/dialogos/paleta.tsx";

/** ADR-179 (item 4): a paleta ⌘K em React — o DOM e o comportamento da paleta por string. */
const ITENS: ItemPaleta[] = [
  { chave: "bot:a1", grupo: "Bots", titulo: "Cecília", sub: "Dev <Sr>", agenteId: "a1" },
  { chave: "bot:a2", grupo: "Bots", titulo: "Milton", agenteId: "a2" },
  { chave: "ajuste:tema", grupo: "Ajustes", titulo: "Tema", sub: "Geral › Aparência", icone: "tema" },
  { chave: "acao:novo", grupo: "Ações", titulo: "Novo bot", icone: "mais", teclas: ["⌘", "⇧", "N"] },
] as ItemPaleta[];
const avatar = (id: string) => `<nod-mascote class="icon mascote c-red" title="${id}"></nod-mascote>`;

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) {
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.outerHTML.replace(/>\s+</g, "><");
}
function porString(termo: string, sel: number, vistos: ItemPaleta[]): Element {
  const d = document.createElement("div");
  d.innerHTML = cascaDaPaleta();
  d.querySelector("#paleta-lista")!.innerHTML = listaDaPaleta(vistos, sel, avatar, termo);
  const c = d.querySelector<HTMLInputElement>("#paleta-termo")!;
  c.setAttribute("value", termo);
  if (vistos.length) c.setAttribute("aria-activedescendant", `paleta-i-${sel}`);
  return d.firstElementChild!;
}
const montar = () => {
  document.body.innerHTML = '<button id="antes">antes</button>';
  document.getElementById("antes")!.focus();
  const executar = vi.fn();
  const itens = vi.fn(() => ITENS);
  const p = criarPaletaNoReact({ doc: document, itens, avatar, executar });
  act(() => p.abrir());
  const campo = document.querySelector<HTMLInputElement>("#paleta-termo")!;
  // O React põe o valor como propriedade; para comparar com o HTML por string, o atributo.
  const fotografar = () => { const el = document.querySelector(".paleta-fundo")!.cloneNode(true) as Element; el.querySelector("#paleta-termo")!.setAttribute("value", campo.value); return el; };
  return { p, executar, itens, campo, fotografar };
};

describe("a paleta ⌘K em React", () => {
  it("abre com o foco no campo e o DOM é o da paleta por string", () => {
    const { campo, fotografar } = montar();
    expect(document.activeElement).toBe(campo);
    expect(normalizar(fotografar())).toBe(normalizar(porString("", 0, filtrarPaleta(ITENS, ""))));
  });

  it("digitar filtra (relendo os itens), ↑ ↓ andam com o activedescendant, Enter executa e fecha", () => {
    const { p, campo, executar, itens, fotografar } = montar();
    const lidas = itens.mock.calls.length;
    act(() => { fireEvent.change(campo, { target: { value: "e" } }); });
    expect(itens.mock.calls.length).toBeGreaterThan(lidas);
    act(() => { fireEvent.keyDown(campo, { key: "ArrowDown" }); });
    const vistos = filtrarPaleta(ITENS, "e");
    expect(normalizar(fotografar())).toBe(normalizar(porString("e", 1, vistos)));
    expect(campo.getAttribute("aria-activedescendant")).toBe("paleta-i-1");
    expect(document.querySelector('[aria-selected="true"]')?.id).toBe("paleta-i-1");
    expect(vistos.length).toBeGreaterThan(1);
    act(() => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(executar).toHaveBeenCalledTimes(1);
    expect(p.aberta()).toBe(false);
  });

  it("Esc fecha e o foco volta a quem estava; o clique no fundo também fecha; nada encontrado diz o termo", () => {
    const a = montar();
    act(() => { fireEvent.change(a.campo, { target: { value: "zzz" } }); });
    expect(document.querySelector(".paleta-vazia")?.textContent).toBe("Nada encontrado para “zzz”.");
    act(() => { fireEvent.keyDown(a.campo, { key: "Escape" }); });
    expect(a.p.aberta()).toBe(false);
    expect(document.activeElement?.id).toBe("antes");
    const b = montar();
    act(() => { fireEvent.click(document.querySelector(".paleta-fundo")!); });
    expect(b.p.aberta()).toBe(false);
  });
});

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderNovaSala } from "../../../../../web/telas/sala.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaNovaSala } from "../../../../../web/react/telas/nova-sala.tsx";

/** ADR-179 (as telas no lugar da conversa): o novo chat em grupo em React — o DOM da tela por string, o envio por prop. */
const base: Estado = { ...estadoInicial, frota: { agentes: [{ id: "a1", nome: "Nina", cor: "c-red", forma: "shape-drop" }, { id: "a2", nome: "Leo <b>", cor: "c-black", forma: "shape-cloud" }] } as never };
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-form]")) n.removeAttribute("data-form");
  for (const n of c.querySelectorAll('[data-act="criar-sala"]')) n.removeAttribute("data-act");
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/> /g, ">").replace(/ </g, "<");
}
const porString = (e: Estado): Element => { const d = document.createElement("div"); d.innerHTML = renderNovaSala(e); return d.firstElementChild!; };

describe("o novo chat em grupo em React", () => {
  for (const [nome, e] of [["com bots", base], ["sem bots", { ...base, frota: { agentes: [] } as never }]] as const) {
    it(`o DOM é o da tela por string (${nome})`, () => {
      const { container } = render(<TelaNovaSala loja={criarLoja(() => e as Estado)} acoes={{ criar: vi.fn() }} />);
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(e as Estado)));
      expect(container.querySelector("[data-form], [data-act]")).toBeNull();
    });
  }
  it("o envio leva o formulário (com o nome e os marcados) à prop", () => {
    const criar = vi.fn();
    const { container } = render(<TelaNovaSala loja={criarLoja(() => base)} acoes={{ criar }} />);
    const form = container.querySelector("form")!;
    form.querySelector<HTMLInputElement>('input[name="nome"]')!.value = "revisão";
    form.querySelectorAll<HTMLInputElement>('input[name="agenteIds"]').forEach((c) => { c.checked = true; });
    fireEvent.submit(form);
    expect(criar).toHaveBeenCalledWith(form);
    expect(new FormData(form).getAll("agenteIds")).toEqual(["a1", "a2"]);
  });
});

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderNovaRotina } from "../../../../../web/telas/nova-rotina.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaNovaRotina } from "../../../../../web/react/telas/nova-rotina.tsx";

/** ADR-179 (as telas no lugar da conversa): Nova rotina em React — o DOM da tela por string, o envio por prop. */
const base: Estado = {
  ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "a1", nome: "Nina", ownerId: "p", confirmado: true }, { id: "a2", nome: "Leo <b>", ownerId: "p", confirmado: true }, { id: "a3", nome: "Outro", ownerId: "x", confirmado: true }] } as never,
  tela: { tipo: "nova-rotina", agenteId: "a2" },
};

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-form]")) n.removeAttribute("data-form");
  for (const n of c.querySelectorAll('[data-act="navegar"]')) { n.removeAttribute("data-act"); n.removeAttribute("data-tela"); }
  // O escolhido do <select> é a propriedade no React e o atributo `selected` por string: compara-se o valor, abaixo.
  for (const n of c.querySelectorAll("option[selected]")) n.removeAttribute("selected");
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.name === "class" ? a.value.trim() : a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><").replace(/\s+</g, "<").replace(/>\s+/g, ">");
}
const porString = (e: Estado): Element => { const d = document.createElement("div"); d.innerHTML = renderNovaRotina(e, e.tela.tipo === "nova-rotina" ? e.tela.agenteId : undefined); return d.firstElementChild!; };
const acoesFalsas = () => ({ criar: vi.fn(), cancelar: vi.fn(), criarBot: vi.fn() });

describe("Nova rotina em React", () => {
  for (const [nome, e] of [["com bots", base], ["sem bot", { ...base, frota: { agentes: [] } as never }]] as const) {
    it(`o DOM é o da tela por string (${nome})`, () => {
      const { container } = render(<TelaNovaRotina loja={criarLoja(() => e as Estado)} acoes={acoesFalsas()} />);
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(e as Estado)));
      expect(container.querySelector("[data-form], [data-act]")).toBeNull();
    });
  }

  it("o bot pedido vem escolhido, a frequência em Dias úteis, e o envio leva o formulário à prop", () => {
    const acoes = acoesFalsas();
    const { container } = render(<TelaNovaRotina loja={criarLoja(() => base)} acoes={acoes} />);
    const form = container.querySelector("form")!;
    expect(new FormData(form).get("agenteId")).toBe("a2");
    expect(new FormData(form).get("frequencia")).toBe("1-5");
    const porStr = porString(base).querySelector("form")! as HTMLFormElement;
    // A frequência da tela por string é o <option selected> (o happy-dom não o lê no FormData); o resto, campo a campo.
    expect(porStr.querySelector<HTMLOptionElement>('select[name="frequencia"] option[selected]')?.value).toBe("1-5");
    const semFreq = (f: HTMLFormElement) => [...new FormData(f).entries()].filter(([k]) => k !== "frequencia");
    expect(semFreq(form)).toEqual(semFreq(porStr));
    fireEvent.submit(form);
    expect(acoes.criar).toHaveBeenCalledWith(form);
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancelar")!);
    expect(acoes.cancelar).toHaveBeenCalled();
  });
});

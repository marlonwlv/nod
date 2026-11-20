import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderNovoBot } from "../../../../../web/telas/novo-bot.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaNovoBot, type AcoesDoNovoBot } from "../../../../../web/react/telas/novo-bot.tsx";

/** ADR-179 (as telas no lugar da conversa): a nova conversa em React — o DOM da tela por string, as ações por prop. */
const base: Estado = {
  ...estadoInicial,
  frota: { agentes: [
    { id: "a1", nome: "Cecília", titulo: "Dev <Sr>", cor: "c-green", forma: "shape-cloud", ownerId: "p", conversaId: "c1", confirmado: true, ultimaMensagem: { previa: "Pronto." } },
    { id: "a2", nome: "Milton", titulo: null, cor: "c-black", forma: "shape-drop", ownerId: "p", conversaId: "c2", confirmado: true },
    { id: "a3", nome: "Rascunho", titulo: null, cor: "c-red", forma: "shape-drop", ownerId: "p", conversaId: "c3", confirmado: false },
  ] } as never,
};
const acoesFalsas = (): { [K in keyof AcoesDoNovoBot]: ReturnType<typeof vi.fn> } => ({ abrirConversa: vi.fn(), fechar: vi.fn(), criar: vi.fn(), novoChatEmGrupo: vi.fn(), enviar: vi.fn(), aoDesenhar: vi.fn() });

const ACOES = new Set(["abrir-conversa", "fechar-nova-conversa", "criar-rapido", "navegar", "nc-enviar"]);
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-act]")) {
    if (!ACOES.has(n.getAttribute("data-act") ?? "")) continue;
    if (n.getAttribute("data-act") === "navegar") n.removeAttribute("data-tela");
    n.removeAttribute("data-act");
  }
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><");
}

describe("a nova conversa (Novo bot) em React", () => {
  it("o DOM é o da tela por string (sem as ações por atributo)", () => {
    const { container } = render(<TelaNovoBot loja={criarLoja(() => base)} acoes={acoesFalsas()} />);
    const d = document.createElement("div");
    d.innerHTML = renderNovoBot(base);
    expect(normalizar(container.firstElementChild!)).toBe(normalizar(d.firstElementChild!));
    expect(container.querySelector("[data-act]")).toBeNull();
  });

  it("as ações chegam por prop; o filtro do main roda depois de cada desenho", () => {
    let e = base;
    const loja = criarLoja(() => e);
    const acoes = acoesFalsas();
    const { container } = render(<TelaNovoBot loja={loja} acoes={acoes} />);
    expect(acoes.aoDesenhar).toHaveBeenCalled();
    fireEvent.click(container.querySelector('.nc-bot[data-agente="a2"]')!);
    expect(acoes.abrirConversa).toHaveBeenCalledWith("c2", "a2");
    fireEvent.click(container.querySelector(".nc-fechar")!);
    fireEvent.click(container.querySelector(".nc-criar")!);
    fireEvent.click(container.querySelectorAll(".nc-acao")[1]!);
    fireEvent.click(container.querySelector(".send")!);
    expect([acoes.fechar, acoes.criar, acoes.novoChatEmGrupo, acoes.enviar].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
    // O texto digitado no "Para:" fica (o campo não é do React) e o bot que chega num frame entra, com o filtro refeito.
    const campo = container.querySelector<HTMLInputElement>("#busca-destinatario")!;
    campo.value = "ce";
    const antes = acoes.aoDesenhar.mock.calls.length;
    act(() => { e = { ...e, frota: { agentes: [...e.frota!.agentes, { id: "a4", nome: "Celso", titulo: null, cor: "c-red", forma: "shape-drop", ownerId: "p", conversaId: "c4", confirmado: true }] } as never }; loja.avisar(); });
    expect(container.querySelector('.nc-bot[data-agente="a4"]')).toBeTruthy();
    expect(campo.value).toBe("ce");
    expect(container.querySelector("#busca-destinatario")).toBe(campo);
    expect(acoes.aoDesenhar.mock.calls.length).toBeGreaterThan(antes);
  });
});

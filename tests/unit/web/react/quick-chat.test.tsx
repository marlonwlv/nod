import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { htmlAvatarDaMesa, htmlTopoQuickChat } from "../../../../web/lib/quick-chat.ts";
import { criarAvatarDaMesa, criarTopoDoQuickChat } from "../../../../web/react/janelas/quick-chat.tsx";

/** ADR-179 (item 4): o topo do Quick Chat e o avatar da mesa em React — o DOM da string e as ações por prop. */
const BOTS = [{ id: "a", nome: "Ada <x>", conversaId: "c1" }, { id: "b", nome: "Gil", conversaId: "c2" }];
const MASCOTE = '<span class="mascote sm" data-mascote="a"></span>';

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) {
    e.removeAttribute("data-act");
    // O <option selected> da string vira o `value` do <select> no React.
    if (e.tagName === "OPTION") e.removeAttribute("selected");
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.innerHTML;
}
const nativo = (html: string): string => { const d = document.createElement("div"); d.innerHTML = html; return normalizar(d); };
const acoes = () => ({ escolherBot: vi.fn(), montar: vi.fn(), desmontar: vi.fn(), expandir: vi.fn(), fechar: vi.fn() });

describe("o topo do Quick Chat em React", () => {
  it.each([
    ["sem bot escolhido", null, { pode: false, montado: false }, ""],
    ["com bot e mascote, sem mesa", "a", { pode: false, montado: false }, MASCOTE],
    ["na mesa (montado)", "b", { pode: true, montado: true }, MASCOTE],
    ["pode montar", "a", { pode: true, montado: false }, MASCOTE],
  ] as const)("%s: o DOM da string", (_, atual, mesa, avatar) => {
    document.body.innerHTML = '<div id="topo"></div>';
    const el = document.getElementById("topo")!;
    const desenhar = criarTopoDoQuickChat(el, acoes());
    act(() => desenhar({ bots: BOTS, atual, mesa, avatar }));
    expect(normalizar(el)).toBe(nativo(htmlTopoQuickChat(BOTS, atual, mesa, avatar)));
    expect(el.querySelector("select")!.value).toBe(atual ?? "");
  });

  it("as ações: trocar o bot, montar e desmontar, expandir, fechar", () => {
    document.body.innerHTML = '<div id="topo"></div>';
    const el = document.getElementById("topo")!;
    const a = acoes();
    const desenhar = criarTopoDoQuickChat(el, a);
    act(() => desenhar({ bots: BOTS, atual: "a", mesa: { pode: true, montado: false }, avatar: "" }));
    act(() => { fireEvent.change(el.querySelector("select")!, { target: { value: "b" } }); });
    expect(a.escolherBot).toHaveBeenCalledWith("b");
    act(() => { fireEvent.click(el.querySelector('[aria-label="Montar na área de trabalho"]')!); });
    expect(a.montar).toHaveBeenCalledWith("a");
    act(() => desenhar({ bots: BOTS, atual: "a", mesa: { pode: true, montado: true }, avatar: "" }));
    act(() => { fireEvent.click(el.querySelector('[aria-label="Tirar da área de trabalho"]')!); });
    expect(a.desmontar).toHaveBeenCalledWith("a");
    act(() => { fireEvent.click(el.querySelector('[aria-label="Abrir na janela do nod"]')!); });
    act(() => { fireEvent.click(el.querySelector('[aria-label="Fechar o Quick Chat"]')!); });
    expect(a.expandir).toHaveBeenCalledOnce();
    expect(a.fechar).toHaveBeenCalledOnce();
  });

  it("o avatar da mesa: o DOM da string; abrir e tirar; sem bot, vazio", () => {
    document.body.innerHTML = '<div id="av"></div>';
    const el = document.getElementById("av")!;
    const a = { abrir: vi.fn(), tirar: vi.fn() };
    const desenhar = criarAvatarDaMesa(el, a);
    act(() => desenhar({ bot: BOTS[0]!, mascote: MASCOTE }));
    expect(normalizar(el)).toBe(nativo(htmlAvatarDaMesa(BOTS[0]!, MASCOTE)));
    act(() => { fireEvent.click(el.querySelector(".am-bot")!); });
    act(() => { fireEvent.click(el.querySelector(".am-tirar")!); });
    expect(a.abrir).toHaveBeenCalledWith("a");
    expect(a.tirar).toHaveBeenCalledWith("a");
    act(() => desenhar(null));
    expect(el.innerHTML).toBe("");
  });
});

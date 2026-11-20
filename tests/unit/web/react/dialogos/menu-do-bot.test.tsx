import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { corpoDoMenu, type BotGerido } from "../../../../../web/telas/gestao-agentes.ts";
import { abrirMenuDoBotNoReact } from "../../../../../web/react/dialogos/menu-do-bot.tsx";

/** ADR-179 (item 4): o menu do bot pelo Menu do Base UI — as linhas da nativa, a ação depois de fechar, o foco. */
const bot = (extra: Partial<BotGerido> = {}): BotGerido => ({ id: "b1", nome: "Cecília <dev>", papel: "bot", fixado: false, naoLido: true, secao: "Dev", oculto: false, ...extra } as BotGerido);

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) {
    // aria-disabled="false" é do Base UI (o CSS só lê o "true").
    for (const n of ["id", "tabindex", "data-highlighted"]) e.removeAttribute(n);
    if (e.getAttribute("aria-disabled") === "false") e.removeAttribute("aria-disabled");
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.innerHTML;
}
const abrir = (a: BotGerido, dona: boolean, executar = vi.fn()) => {
  document.body.innerHTML = '<button id="linha">linha</button>';
  const ancora = document.getElementById("linha")!;
  ancora.focus();
  act(() => { abrirMenuDoBotNoReact(document, { a, dona, ancora, executar }); });
  return { ancora, executar };
};
const popup = () => document.querySelector<HTMLElement>(".bot-menu.rx-menu")!;

describe("o menu do bot pelo Base UI", () => {
  it.each([["dona", bot(), true], ["de outra pessoa", bot(), false], ["o Nod", bot({ papel: "nod", fixado: true }), true], ["oculto", bot({ oculto: true }), true]] as const)("%s: as linhas da nativa, o rótulo e o nome", async (_, a, dona) => {
    abrir(a, dona);
    await waitFor(() => expect(popup()).toBeTruthy());
    expect(popup().getAttribute("role")).toBe("menu");
    expect(popup().getAttribute("aria-label")).toBe(`Ações de ${a.nome}`);
    const nativo = document.createElement("div");
    nativo.innerHTML = `<p class="menu-nome">${a.nome.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>${corpoDoMenu(a, dona, false)}`;
    expect(normalizar(popup())).toBe(normalizar(nativo));
  });

  it("escolher: o menu sai, o foco volta à linha e só então a ação roda", async () => {
    let focoNaHora: Element | null = null;
    const executar = vi.fn(() => { focoNaHora = document.activeElement; });
    const { ancora } = abrir(bot(), true, executar);
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.click(popup().querySelector('[data-gestao="renomear"]')!); });
    await waitFor(() => expect(executar).toHaveBeenCalledWith("renomear"));
    expect(document.querySelector(".rx-menu-host")).toBeNull();
    expect(focoNaHora).toBe(ancora);
    expect(executar).toHaveBeenCalledOnce();
  });

  it("Esc fecha sem ação e o foco volta", async () => {
    const { ancora, executar } = abrir(bot(), true);
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.keyDown(popup(), { key: "Escape" }); });
    await waitFor(() => expect(document.querySelector(".rx-menu-host")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(ancora));
    expect(executar).not.toHaveBeenCalled();
  });
});

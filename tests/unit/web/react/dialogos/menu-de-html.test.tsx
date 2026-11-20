import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { htmlDoMenuDaAba } from "../../../../../web/telas/abas-de-tarefa.ts";
import { htmlMenuCompartilhar } from "../../../../../web/telas/gestao-agentes.ts";
import { abrirMenuDeHtmlNoReact } from "../../../../../web/react/dialogos/menu-de-html.tsx";

/** ADR-179 (item 4): os menus da barra pelo Menu do Base UI, a partir do mesmo HTML do `<dialog>` nativo. */
const TIME = '<div role="menu" aria-label="Ações do time Dev &lt;x&gt;"><p class="menu-nome">Dev &lt;x&gt;</p><button type="button" role="menuitem" data-acao-time="subir" disabled>Mover para cima</button><button type="button" role="menuitem" data-acao-time="renomear">Renomear</button><hr><button type="button" role="menuitem" data-acao-time="excluir" class="danger">Excluir time</button><hr><p class="menu-nota">Sem time é fixo.</p></div>';

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) {
    for (const n of ["id", "tabindex", "data-highlighted", "role", "data-disabled", "type"]) e.removeAttribute(n);
    if (e.getAttribute("aria-disabled") === "false") e.removeAttribute("aria-disabled");
    if (e.getAttribute("aria-disabled") === "true") { e.removeAttribute("aria-disabled"); e.setAttribute("disabled", ""); }
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.innerHTML;
}
const abrir = (html: string, aoEscolher = vi.fn(), aoFechar = vi.fn()) => {
  document.body.innerHTML = '<button id="ancora">aba</button>';
  const ancora = document.getElementById("ancora")!;
  ancora.focus();
  act(() => { abrirMenuDeHtmlNoReact(document, { html, ancora, aoEscolher, aoFechar }); });
  return { ancora, aoEscolher, aoFechar };
};
const popup = () => document.querySelector<HTMLElement>(".bot-menu.rx-menu")!;
const nativo = (html: string): string => { const d = document.createElement("div"); d.innerHTML = html; return normalizar(d.firstElementChild!); };

describe("os menus da barra pelo Base UI", () => {
  it.each([["a aba de tarefa", htmlDoMenuDaAba({ titulo: "Revisar <o> PR", estado: "rodando" } as never, { fazerNaConversa: true })], ["o time (item desligado, nota)", TIME], ["o Compartilhar da gaveta", htmlMenuCompartilhar({ id: "b", nome: "Ada <x>", papel: "bot" } as never)], ["o Compartilhar do Nod", htmlMenuCompartilhar({ id: "n", nome: "Nod", papel: "nod" } as never)]])("%s: o mesmo conteúdo e o rótulo no popup", async (_, html) => {
    abrir(html);
    await waitFor(() => expect(popup()).toBeTruthy());
    const d = document.createElement("div");
    d.innerHTML = html;
    expect(popup().getAttribute("role")).toBe("menu");
    expect(popup().getAttribute("aria-label")).toBe(d.firstElementChild!.getAttribute("aria-label"));
    expect(normalizar(popup().firstElementChild!)).toBe(nativo(html));
  });

  it("a aba: a classe do corpo fica como filha do popup (o CSS lê .bot-menu > .menu-aba-corpo)", async () => {
    abrir(htmlDoMenuDaAba({ titulo: "X", estado: "rodando" } as never));
    await waitFor(() => expect(popup()).toBeTruthy());
    expect(popup().querySelector(":scope > .menu-aba-corpo > button[data-aba-acao]")).toBeTruthy();
  });

  it("escolher: sai, avisa o fechar, devolve o foco e só então entrega o botão (o dataset dele)", async () => {
    const ordem: string[] = [];
    const aoEscolher = vi.fn((b: HTMLButtonElement) => { ordem.push(`escolheu:${b.dataset.acaoTime}:${document.activeElement?.id}`); });
    const aoFechar = vi.fn(() => { ordem.push("fechou"); });
    abrir(TIME, aoEscolher, aoFechar);
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.click(popup().querySelector('[data-acao-time="subir"]')!); });
    expect(aoEscolher).not.toHaveBeenCalled();
    act(() => { fireEvent.click(popup().querySelector('[data-acao-time="renomear"]')!); });
    await waitFor(() => expect(aoEscolher).toHaveBeenCalledOnce());
    expect(ordem).toEqual(["fechou", "escolheu:renomear:ancora"]);
    expect(document.querySelector(".rx-menu-host")).toBeNull();
  });

  it("Esc: sai sem escolha, avisa o fechar e o foco volta", async () => {
    const { ancora, aoEscolher, aoFechar } = abrir(TIME);
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.keyDown(popup(), { key: "Escape" }); });
    await waitFor(() => expect(aoFechar).toHaveBeenCalledOnce());
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ancora);
  });
});

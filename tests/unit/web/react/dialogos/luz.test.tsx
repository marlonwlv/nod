import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lembrancaDaMidia, type ItemLuz } from "../../../../../web/lib/midia.ts";
import { htmlDaLuz } from "../../../../../web/telas/luz-html.ts";
import { abrirLuzNoReact } from "../../../../../web/react/dialogos/luz.tsx";

/** ADR-179 (item 4): a tela cheia da mídia pelo Base UI — o DOM de `htmlDaLuz` e o comportamento da nativa. */
const foto = (id: string, extra: Partial<ItemLuz> = {}): ItemLuz => ({ id, nome: `${id}.png`, mime: "image/png", url: `/u/${id}`, w: 1600, h: 900, ...extra });
const VIDEO: ItemLuz = { id: "v", nome: "demo.mp4", mime: "video/mp4", url: "/u/v", w: 1280, h: 720, dur: 83_000 };

function grupo(itens: ItemLuz[], i = 0): HTMLElement {
  document.body.innerHTML = `<div data-mensagem="m1"><div class="msg-midias" data-luz='${JSON.stringify(itens).replace(/'/g, "&#39;")}'>${itens.map((x, k) => `<button data-act="midia-abrir" data-i="${k}" data-anexo-id="${x.id}">${x.nome}</button>`).join("")}</div></div>`;
  const b = document.querySelectorAll<HTMLElement>("[data-i]")[i]!;
  b.focus();
  return b;
}
const popup = (): HTMLElement => document.querySelector<HTMLElement>(".luz.rx-luz")!;
afterEach(() => { document.body.innerHTML = ""; lembrancaDaMidia.esteMac = null; });

/** O conteúdo do popup como o HTML da nativa: atributos em ordem, sem o que o Base UI e o React acrescentam. */
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll('[data-luz="fechar"]')) { n.removeAttribute("tabindex"); n.removeAttribute("data-base-ui-click-trigger"); }
  for (const e of [c, ...c.querySelectorAll("*")]) {
    const attrs = [...e.attributes].map((x) => [x.name, x.name === "style" ? x.value.replace(/\s+/g, "").replace(/;$/, "") : x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.innerHTML.replace(/>\s+</g, "><");
}
const nativo = (itens: ItemLuz[], i: number, esteMac: string | null): string => {
  const d = document.createElement("div");
  d.innerHTML = htmlDaLuz(itens, i, esteMac);
  return normalizar(d);
};
const doPopup = (): string => {
  const d = document.createElement("div");
  for (const n of popup().childNodes) d.append(n.cloneNode(true));
  return normalizar(d);
};

describe("a tela cheia da mídia pelo Base UI", () => {
  it("várias imagens: o DOM de htmlDaLuz, o foco em Fechar, o rótulo e a legenda", async () => {
    const tres = [foto("a"), foto("b"), foto("c")];
    act(() => { abrirLuzNoReact(document, grupo(tres, 1)); });
    await waitFor(() => expect(popup()).toBeTruthy());
    expect(doPopup()).toBe(nativo(tres, 1, null));
    expect(popup().getAttribute("aria-label")).toBe("Mídia em tela cheia");
    expect(popup().getAttribute("aria-describedby")).toBe("luz-legenda");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-luz")).toBe("fechar"));
  });

  it("as setas, ← → e as miniaturas andam (sem dar a volta); na ponta o foco passa para a outra seta; o DOM segue o da nativa", async () => {
    const tres = [foto("a"), foto("b"), foto("c")];
    act(() => { abrirLuzNoReact(document, grupo(tres, 1)); });
    await waitFor(() => expect(popup()).toBeTruthy());
    const prox = popup().querySelector<HTMLElement>('[data-luz="prox"]')!;
    prox.focus();
    act(() => { fireEvent.click(prox); });
    expect(doPopup()).toBe(nativo(tres, 2, null));
    expect(document.activeElement?.getAttribute("data-luz")).toBe("ant");
    act(() => { fireEvent.keyDown(popup(), { key: "ArrowRight" }); });
    expect(popup().querySelector(".luz-legenda")?.textContent).toBe("c.png · 3 / 3");
    act(() => { fireEvent.keyDown(popup(), { key: "ArrowLeft" }); });
    expect(popup().querySelector(".luz-legenda")?.textContent).toBe("b.png · 2 / 3");
    act(() => { fireEvent.click(popup().querySelector('[data-luz-ir="0"]')!); });
    expect(doPopup()).toBe(nativo(tres, 0, null));
  });

  it("duplo clique: o tamanho real; andar volta ao ajustado; clicar na figura (fora da mídia) fecha e o foco volta", async () => {
    const dois = [foto("a"), foto("b")];
    const origem = grupo(dois);
    act(() => { abrirLuzNoReact(document, origem); });
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.doubleClick(popup().querySelector('[data-luz="midia"]')!); });
    expect(popup().classList.contains("cem")).toBe(true);
    act(() => { fireEvent.click(popup().querySelector('[data-luz="midia"]')!); });
    expect(popup()).toBeTruthy();
    act(() => { fireEvent.keyDown(popup(), { key: "ArrowRight" }); });
    expect(popup().classList.contains("cem")).toBe(false);
    act(() => { fireEvent.click(popup().querySelector(".luz-fig")!); });
    await waitFor(() => expect(document.querySelector(".rx-luz-host")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(origem));
  });

  it("Esc fecha; a conversa redesenhou com a tela aberta: o foco vai ao botão novo da mídia da vez", async () => {
    const dois = [foto("a"), foto("b")];
    act(() => { abrirLuzNoReact(document, grupo(dois)); });
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.keyDown(popup(), { key: "ArrowRight" }); });
    const host = document.querySelector(".rx-luz-host")!;
    document.querySelector("[data-mensagem]")!.outerHTML = `<div data-mensagem="m1"><div class="msg-midias"><button data-act="midia-abrir" data-i="0" data-anexo-id="a">a</button><button id="novo-b" data-act="midia-abrir" data-i="1" data-anexo-id="b">b</button></div></div>`;
    document.body.append(host);
    act(() => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    await waitFor(() => expect(document.querySelector(".rx-luz-host")).toBeNull());
    await waitFor(() => expect(document.activeElement?.id).toBe("novo-b"));
  });

  it("vídeo: o DOM da nativa (a barra mínima, 0:00 / 1:23, 1×); a velocidade anda; o tempo acompanha", async () => {
    act(() => { abrirLuzNoReact(document, grupo([VIDEO])); });
    await waitFor(() => expect(popup()).toBeTruthy());
    expect(doPopup()).toBe(nativo([VIDEO], 0, null));
    const vel = popup().querySelector<HTMLElement>('[data-luz="vel"]')!;
    act(() => { fireEvent.click(vel); });
    expect(vel.textContent).toBe("1,25×");
    expect(vel.getAttribute("aria-label")).toBe("Velocidade 1,25×");
    const v = popup().querySelector<HTMLVideoElement>('[data-luz="video"]')!;
    Object.defineProperty(v, "duration", { value: 83, configurable: true });
    Object.defineProperty(v, "currentTime", { value: 41.5, configurable: true, writable: true });
    Object.defineProperty(v, "paused", { value: false, configurable: true });
    act(() => { fireEvent.timeUpdate(v); });
    expect(popup().querySelector('[data-luz="tempo"]')?.textContent).toBe("0:42 / 1:23");
    expect(popup().querySelector<HTMLInputElement>('[data-luz="ir"]')!.value).toBe("500");
    expect(popup().querySelector('[data-luz="play"]')?.getAttribute("aria-label")).toBe("Pausar");
  });

  it("Mostrar no Finder só no Mac do arquivo; o clique chama o finder com o item", async () => {
    lembrancaDaMidia.esteMac = "m1";
    const finder = vi.fn();
    const dois = [foto("a", { mac: "m1" }), foto("b")];
    act(() => { abrirLuzNoReact(document, grupo(dois), { finder }); });
    await waitFor(() => expect(popup()).toBeTruthy());
    expect(doPopup()).toBe(nativo(dois, 0, "m1"));
    act(() => { fireEvent.click(popup().querySelector('[data-luz="finder"]')!); });
    expect(finder).toHaveBeenCalledWith(dois[0]);
    act(() => { fireEvent.keyDown(popup(), { key: "ArrowRight" }); });
    expect(popup().querySelector<HTMLElement>('[data-luz="finder"]')!.hidden).toBe(true);
  });

  it("sem lista ou índice fora: não abre", () => {
    document.body.innerHTML = '<button data-i="0"></button>';
    expect(abrirLuzNoReact(document, document.querySelector("button")!)).toBeNull();
  });
});

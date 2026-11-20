import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlPreviaArquivo } from "../../../../../web/lib/previa-html.ts";

vi.mock("../../../../../web/lib/previa-csv.ts", () => ({
  desenhar: vi.fn(async (el: HTMLElement) => { el.innerHTML = "<table><tr><td>a</td></tr></table>"; return { contagem: "1 linha" }; }),
}));
const { abrirPreviaNoReact } = await import("../../../../../web/react/dialogos/previa-arquivo.tsx");

/** ADR-179 (item 4): a prévia de arquivo pelo Base UI — a casca da nativa, o formato desenhando no nó dele, o erro e o fechar. */
const card = (): HTMLElement => {
  document.body.innerHTML = '<button data-act="previa-arquivo" data-id="x1" data-url="/api/anexos/x1" data-nome="dados <q>.csv" data-mime="text/csv">csv</button>';
  const b = document.querySelector<HTMLElement>("button")!;
  b.focus();
  return b;
};
const resposta = (status: number, corpo = "a,b\n1,2") => vi.fn(async () => new Response(status === 200 ? corpo : "", { status, headers: { "content-length": String(corpo.length) } }));
afterEach(() => vi.unstubAllGlobals());

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll('button[tabindex="0"]')) n.removeAttribute("tabindex");
  for (const e of [c, ...c.querySelectorAll("*")]) {
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.outerHTML.replace(/>\s+</g, "><");
}

describe("a prévia de arquivo pelo Base UI", () => {
  it("a casca é a da nativa enquanto carrega; depois o formato desenha no nó dele e a contagem aparece", async () => {
    let soltar: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { soltar = r; })));
    const origem = card();
    act(() => { abrirPreviaNoReact(document, origem); });
    await waitFor(() => expect(document.querySelector(".previa-arquivo-caixa")).toBeTruthy());
    const nativo = document.createElement("div");
    nativo.innerHTML = htmlPreviaArquivo({ nome: "dados <q>.csv", url: "/api/anexos/x1" });
    const caixa = document.querySelector(".previa-arquivo-caixa")!.cloneNode(true) as Element;
    caixa.querySelector(".previa-csv-corpo")?.remove();
    expect(normalizar(caixa)).toBe(normalizar(nativo.firstElementChild!));
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Prévia de dados <q>.csv");
    await act(async () => { soltar(new Response("a,b", { status: 200, headers: { "content-length": "3" } })); });
    await waitFor(() => expect(document.querySelector(".previa-contagem")?.textContent).toBe("1 linha"));
    expect(document.querySelector(".previa-csv-corpo table")).toBeTruthy();
    expect(document.querySelector(".previa-corpo")?.hasAttribute("aria-busy")).toBe(false);
    act(() => { fireEvent.click(document.querySelector('[data-previa="fechar"]')!); });
    await waitFor(() => expect(document.querySelector(".rx-prv-host")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(origem));
  });

  it("404: o erro sem Baixar (nem no topo); 500: o erro com Baixar", async () => {
    vi.stubGlobal("fetch", resposta(404));
    act(() => { abrirPreviaNoReact(document, card()); });
    await waitFor(() => expect(document.querySelector(".previa-erro")).toBeTruthy());
    expect(document.querySelector(".previa-erro a")).toBeNull();
    expect(document.querySelector(".previa-baixar")).toBeNull();
    vi.stubGlobal("fetch", resposta(500));
    act(() => { abrirPreviaNoReact(document, card()); });
    await waitFor(() => expect(document.querySelector(".previa-erro a.bt")).toBeTruthy());
    expect(document.querySelector(".previa-baixar")).toBeTruthy();
  });

  it("formato sem prévia: não abre", () => {
    document.body.innerHTML = '<button data-id="x" data-url="/u" data-nome="foto.png" data-mime="image/png"></button>';
    expect(abrirPreviaNoReact(document, document.querySelector("button")!)).toBeNull();
  });
});

import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderItens, type ItemAnexo } from "../../../../../web/lib/anexos.ts";
import { criarFilasNoReact } from "../../../../../web/react/composer/fila-de-anexos.tsx";

/** ADR-179 (fase 6, pedaço 1): a fila de anexos em React — o DOM do desenho por string; a miniatura fica entre os passos. */
const itens = (): ItemAnexo[] => [
  { chave: "k1", nome: "captura-2026-11-12-102400.png", mime: "image/png", tamanho: 204_800, estado: "enviando", progresso: 0.25, previa: "blob:1" },
  { chave: "k2", nome: "foto.jpg", mime: "image/jpeg", tamanho: 1_572_864, estado: "pronto", progresso: 1, previa: "blob:2" },
  { chave: "k3", nome: "contrato <v2>.pdf", mime: "application/pdf", tamanho: 3_000, estado: "enviando", progresso: 0.5 },
  { chave: "k4", nome: "notas.txt", mime: "text/plain", tamanho: 900, estado: "pronto", progresso: 1 },
  { chave: "k5", nome: "grande.mov", mime: "video/quicktime", tamanho: 9_000_000, estado: "erro", progresso: 0, erro: "Esse tipo não vai." },
] as ItemAnexo[];

function normalizar(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  for (const n of d.querySelectorAll('[data-act="remover-anexo"]')) n.removeAttribute("data-act");
  for (const n of d.querySelectorAll("[style]")) n.setAttribute("style", (n.getAttribute("style") ?? "").replace(/\s|;$/g, ""));
  for (const e of d.querySelectorAll("*")) {
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return d.innerHTML;
}

describe("a fila de anexos em React", () => {
  it("o DOM é o do desenho por string, em todos os estados, sem data-act", () => {
    document.body.innerHTML = '<div id="fila"></div>';
    const el = document.getElementById("fila")!;
    criarFilasNoReact(vi.fn()).desenhar(el, itens());
    expect(el.querySelector("[data-act]")).toBeNull();
    expect(normalizar(el.innerHTML)).toBe(normalizar(renderItens(itens())));
  });

  it("o passo do upload só mexe na barra: a miniatura é o mesmo nó; o remover é prop", () => {
    document.body.innerHTML = '<div id="fila"></div>';
    const el = document.getElementById("fila")!;
    const remover = vi.fn();
    const filas = criarFilasNoReact(remover);
    const lista = itens();
    filas.desenhar(el, lista);
    const img = el.querySelector('img[src="blob:1"]');
    lista[0]!.progresso = 0.75;
    filas.desenhar(el, lista);
    expect(el.querySelector('img[src="blob:1"]')).toBe(img);
    expect(el.querySelector<HTMLElement>(".anexo-thumb .anexo-barra > span")?.style.width).toBe("75%");
    act(() => { fireEvent.click(el.querySelector('.anexo-x[data-id="k3"]')!); });
    expect(remover).toHaveBeenCalledWith("k3");
  });

  it("o contêiner recriado (outra conversa) ganha um root novo, e o que saiu desmonta", () => {
    document.body.innerHTML = '<div id="a"></div>';
    const filas = criarFilasNoReact(vi.fn());
    filas.desenhar(document.getElementById("a")!, itens());
    document.body.innerHTML = '<div id="b">sobra do desenho por string</div>';
    const b = document.getElementById("b")!;
    filas.desenhar(b, itens().slice(0, 1));
    expect(b.querySelectorAll(".anexo-thumb")).toHaveLength(1);
    expect(b.textContent).not.toContain("sobra");
  });
});

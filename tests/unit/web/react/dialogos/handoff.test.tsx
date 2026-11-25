import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { htmlDoHandoff, type DadosDoHandoff } from "../../../../../web/telas/dialogo-handoff.ts";
import { abrirHandoffNoReact } from "../../../../../web/react/dialogos/handoff.tsx";

/** ADR-179 (item 4): o diálogo de handoff pelo Dialog do Base UI — o conteúdo do nativo, a mesma resposta. */
const AGORA = 1_800_000_000_000;
const dados = (extra: Partial<DadosDoHandoff> = {}): DadosDoHandoff => ({
  passa: true, aciona: true, deNome: "Ada", paraNome: "Gil", texto: "Revise o <PR> e responda", codigo: "NOD-7", coluna: "Em revisão",
  anterior: { agenteNome: "Ada", estado: "rodando", desde: AGORA - 5 * 60_000 }, ...extra,
} as DadosDoHandoff);

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("*")]) {
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).filter(([n]) => n !== "method").sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of [...e.attributes].map((x) => [x.name] as const)) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return c.outerHTML.replace(/>\s+</g, "><");
}

describe("o diálogo de handoff pelo Base UI", () => {
  it("o conteúdo é o do diálogo nativo; o foco abre em Mover; Mover com Parar marcado responde parar", async () => {
    document.body.innerHTML = "";
    const resposta = abrirHandoffNoReact(document, dados(), AGORA);
    await waitFor(() => expect(document.querySelector("form.qd-ho-form")).toBeTruthy());
    const nativo = document.createElement("div");
    nativo.innerHTML = htmlDoHandoff(dados(), AGORA);
    expect(normalizar(document.querySelector("form.qd-ho-form")!)).toBe(normalizar(nativo.firstElementChild!));
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe("qd-ho-titulo");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-ho")).toBe("mover"));
    act(() => { fireEvent.click(document.querySelector('input[name="parar"]')!); });
    act(() => { fireEvent.submit(document.querySelector("form.qd-ho-form")!); });
    await expect(resposta).resolves.toEqual({ parar: true });
    await waitFor(() => expect(document.querySelector(".rx-ho-host")).toBeNull());
  });

  it("Cancelar e Esc respondem null (não move)", async () => {
    document.body.innerHTML = "";
    const r1 = abrirHandoffNoReact(document, dados({ anterior: null } as never), AGORA);
    await waitFor(() => expect(document.querySelector('[data-ho="cancelar"]')).toBeTruthy());
    act(() => { fireEvent.click(document.querySelector('[data-ho="cancelar"]')!); });
    await expect(r1).resolves.toBeNull();
    const r2 = abrirHandoffNoReact(document, dados(), AGORA);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
    await expect(r2).resolves.toBeNull();
  });
});

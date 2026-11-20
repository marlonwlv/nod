import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { abrirArtefatoNoReact } from "../../../../../web/react/dialogos/artefato.tsx";

/** ADR-179 (item 4): a tela cheia do artefato pelo Base UI — o cabeçalho da nativa, o iframe montado por fora, o fechar. */
const abrir = () => {
  document.body.innerHTML = '<button id="origem">tela cheia</button>';
  const origem = document.getElementById("origem")!;
  origem.focus();
  const soltar = vi.fn();
  const montar = vi.fn((corpo: Element) => { corpo.innerHTML = '<iframe class="artefato-quadro tela-cheia" title="t"></iframe>'; return soltar; });
  const baixar = vi.fn();
  act(() => { abrirArtefatoNoReact(document, { titulo: "Plano <q>", versao: 3, montar, baixar, origem }); });
  return { origem, montar, soltar, baixar };
};

describe("a tela cheia do artefato pelo Base UI", () => {
  it("o cabeçalho da nativa (sem data-act: o Baixar é prop), o iframe no corpo, o rótulo", async () => {
    const { montar, baixar } = abrir();
    await waitFor(() => expect(document.querySelector(".artefato-dialogo.rx-art")).toBeTruthy());
    const p = document.querySelector(".artefato-dialogo.rx-art")!;
    expect(p.getAttribute("aria-label")).toBe("Plano <q>");
    expect(p.querySelector(".artefato-cab")?.textContent).toBe("▣Plano <q>v3Baixar .html✕");
    expect(p.querySelector("[data-act]")).toBeNull();
    expect(p.querySelector('[data-fechar][aria-label="Fechar tela cheia"]')).toBeTruthy();
    expect(montar).toHaveBeenLastCalledWith(p.querySelector(".artefato-dialogo-corpo"));
    expect(p.querySelector(".artefato-dialogo-corpo iframe.tela-cheia")).toBeTruthy();
    act(() => { fireEvent.click(p.querySelector(".bt.link")!); });
    expect(baixar).toHaveBeenCalledOnce();
  });

  it("✕ e Esc fecham: o iframe é solto e o foco volta a quem abriu", async () => {
    let r = abrir();
    await waitFor(() => expect(document.querySelector(".rx-art")).toBeTruthy());
    act(() => { fireEvent.click(document.querySelector("[data-fechar]")!); });
    await waitFor(() => expect(document.querySelector(".rx-art-host")).toBeNull());
    expect(r.soltar).toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(r.origem));
    r = abrir();
    await waitFor(() => expect(document.querySelector(".rx-art")).toBeTruthy());
    act(() => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    await waitFor(() => expect(document.querySelector(".rx-art-host")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(r.origem));
  });
});

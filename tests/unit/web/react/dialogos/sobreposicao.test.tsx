import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SELETOR_DENTRO_DA_SOBREPOSICAO, SELETOR_MODAL, SELETOR_SOBREPOSICAO } from "../../../../../web/lib/atalhos.ts";
import { confirmarNoReact } from "../../../../../web/react/dialogos/confirmar.tsx";
import { abrirMenuDeHtmlNoReact } from "../../../../../web/react/dialogos/menu-de-html.tsx";

/**
 * ADR-179: o main trava os atalhos e os Esc da tela de baixo quando há uma sobreposição por cima. Os diálogos e menus do
 * Base UI não são `<dialog>`: o host marca `data-rx-modal` enquanto existe, e o popup (num portal no `body`) casa com
 * o seletor de "dentro da sobreposição". Sem isso, um Esc no menu fecharia também a tela por baixo.
 */
describe("as sobreposições do Base UI contam como modal para o main", () => {
  it("o menu: aberto, os seletores o veem e o alvo dentro dele casa; fechado, somem", async () => {
    document.body.innerHTML = '<button id="a">a</button><div class="ligacao-cheia" role="dialog"><button id="lig">x</button></div>';
    act(() => { abrirMenuDeHtmlNoReact(document, { html: '<div role="menu" aria-label="M"><button type="button" role="menuitem" data-x="1">Um</button></div>', ancora: document.getElementById("a"), aoEscolher: () => undefined }); });
    await waitFor(() => expect(document.querySelector(".rx-menu [data-x]")).toBeTruthy());
    expect(document.querySelector(SELETOR_SOBREPOSICAO)).toBeTruthy();
    expect(document.querySelector(SELETOR_MODAL)).toBeTruthy();
    expect(document.querySelector(".rx-menu [data-x]")!.closest(SELETOR_DENTRO_DA_SOBREPOSICAO)).toBeTruthy();
    // A tela cheia da ligação (role=dialog) não é "dentro de uma sobreposição": o Esc dela segue encolhendo.
    expect(document.getElementById("lig")!.closest(SELETOR_DENTRO_DA_SOBREPOSICAO)).toBeNull();
    act(() => { fireEvent.keyDown(document.querySelector(".rx-menu")!, { key: "Escape" }); });
    await waitFor(() => expect(document.querySelector(SELETOR_SOBREPOSICAO)).toBeNull());
  });

  it("o diálogo de confirmação: o mesmo", async () => {
    document.body.innerHTML = '<button id="a">a</button>';
    let resposta: boolean | null = null;
    act(() => { void confirmarNoReact(document, { idDoTitulo: "t", titulo: "Certo?", texto: "x", cancelar: "Não", confirmar: "Sim" }).then((r) => { resposta = r; }); });
    await waitFor(() => expect(document.querySelector(".rx-dlg [data-nao]")).toBeTruthy());
    expect(document.querySelector(SELETOR_SOBREPOSICAO)).toBeTruthy();
    expect(document.querySelector(".rx-dlg [data-nao]")!.closest(SELETOR_DENTRO_DA_SOBREPOSICAO)).toBeTruthy();
    act(() => { fireEvent.click(document.querySelector(".rx-dlg [data-nao]")!); });
    await waitFor(() => expect(resposta).toBe(false));
    await waitFor(() => expect(document.querySelector(SELETOR_SOBREPOSICAO)).toBeNull(), { timeout: 2000 });
  });
});

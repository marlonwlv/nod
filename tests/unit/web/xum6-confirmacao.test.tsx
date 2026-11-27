import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pedirConfirmacao } from "../../../web/telas/gestao-agentes.ts";

/**
 * XUM-6 (26/11): o Parar da lista aberta da aba confirma num diálogo do visual novo — título com o ×, corpo, "Cancelar"
 * fantasma e o primário em pílula vermelho. Fechar (×, Cancelar) não para nada; só o primário chama o Parar.
 */
describe("XUM-6: a confirmação no design system atual", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  const abrir = (salvar = vi.fn(async () => {})) => ({ salvar, d: pedirConfirmacao({ titulo: "Parar as 3 tarefas abertas?", corpo: '<ul class="parar-lista"><li>A</li></ul><p>O que já foi feito fica.</p>', confirmar: "Parar tudo", perigo: true, salvar }) });

  it("o desenho: título, ×, corpo e o pé com Cancelar e o primário destrutivo; o foco nasce no Cancelar", () => {
    const { d } = abrir();
    expect(d.classList.contains("dlg-ds")).toBe(true);
    expect(d.querySelector("h2")?.textContent).toBe("Parar as 3 tarefas abertas?");
    expect(d.getAttribute("aria-labelledby")).toBe("gestao-dialogo-titulo");
    expect(d.querySelector(".dlg-ds-cab .dlg-ds-fechar")?.getAttribute("aria-label")).toBe("Fechar");
    expect(d.querySelector(".dlg-ds-corpo .parar-lista")).not.toBeNull();
    const botoes = [...d.querySelectorAll(".dlg-ds-pe button")].map((b) => [b.className, b.textContent]);
    expect(botoes).toEqual([["bt dlg-ds-cancelar", "Cancelar"], ["bt dlg-ds-primario perigo", "Parar tudo"]]);
    expect(document.activeElement?.className).toBe("bt dlg-ds-cancelar");
  });

  it("× e Cancelar fecham sem parar nada", () => {
    for (const sel of [".dlg-ds-fechar", ".dlg-ds-cancelar"]) {
      const { d, salvar } = abrir();
      d.querySelector<HTMLButtonElement>(sel)!.click();
      expect(d.open).toBe(false);
      expect(salvar).not.toHaveBeenCalled();
    }
  });

  it("o primário chama o Parar e fecha; na falha, o erro aparece e os botões voltam", async () => {
    const { d, salvar } = abrir();
    d.querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(d.open).toBe(false));
    expect(salvar).toHaveBeenCalledTimes(1);
    const falha = abrir(vi.fn(async () => { throw new Error("x"); }));
    falha.d.querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(falha.d.querySelector(".dialogo-erro")?.textContent).toMatch(/Não foi possível/));
    expect(falha.d.open).toBe(true);
    expect([...falha.d.querySelectorAll("button")].every((b) => !b.disabled)).toBe(true);
  });

  it("CSS (ds.css): botões em pílula, o primário destrutivo no --danger, superfície elevada e sombra de modal, só tokens", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../web/ds.css"), "utf8");
    expect(css).toMatch(/\.dlg-ds-pe \.bt \{[^}]*border-radius: var\(--raio-full\)/);
    expect(css).toMatch(/\.dlg-ds-primario\.perigo \{ background: var\(--danger\);/);
    expect(css).toMatch(/dialog\.bot-dialogo\.dlg-ds \{[^}]*background: var\(--surface-elevated\);[^}]*box-shadow: var\(--sombra-modal\);/);
  });
});

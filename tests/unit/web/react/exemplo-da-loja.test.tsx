import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExemploDaLoja, type EstadoDoExemplo } from "../../../../web/react/exemplo/exemplo-da-loja.tsx";
import { criarLoja } from "../../../../web/react/loja.ts";

/** ADR-179 (fase 1): o componente de exemplo — Base UI headless + loja por seletor + evento por prop. */
describe("ExemploDaLoja", () => {
  it("abre pelo gatilho do Base UI, lista os itens da loja e avisa a escolha", () => {
    let estado: EstadoDoExemplo = { titulo: "Bots", itens: ["Ada", "Gil"] };
    const loja = criarLoja(() => estado);
    const aoEscolher = vi.fn();
    render(<ExemploDaLoja loja={loja} aoEscolher={aoEscolher} />);

    const gatilho = screen.getByRole("button", { name: "Bots" });
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(gatilho);
    expect(gatilho.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Gil" }));
    expect(aoEscolher).toHaveBeenCalledWith("Gil");

    act(() => { estado = { ...estado, itens: [...estado.itens, "Dante"] }; loja.avisar(); });
    expect(screen.getByRole("button", { name: "Dante" })).toBeTruthy();
  });

  it("não usa data-act (o evento é prop do React, não delegação do main.ts)", () => {
    const estado: EstadoDoExemplo = { titulo: "T", itens: ["a"] };
    const loja = criarLoja(() => estado);
    const { container } = render(<ExemploDaLoja loja={loja} aoEscolher={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "T" }));
    expect(container.querySelector("[data-act]")).toBeNull();
  });
});

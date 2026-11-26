import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { abrirMenuIaNoReact } from "../../../../../web/react/dialogos/menu-ia.tsx";
import { abrirMenuDeHtmlNoReact } from "../../../../../web/react/dialogos/menu-de-html.tsx";
import { renderMenuIa, type DadosSeletor } from "../../../../../web/telas/seletor-ia.ts";

/**
 * O seletor de IA do campo não abria (task "Seletor de IA no composer não abre o menu ao clicar", 2026-11-25): o HTML
 * real do menu (`renderMenuIa`) tem `style="…"` na régua de raciocínio e na barra de uso, e o `propsDe` do menu do Base UI
 * passava a string ao React, que derrubava a árvore. O botão ficava com `aria-expanded="true"` (a seta para cima) e o
 * clique, mudo. O teste da casca no Chrome usava um HTML de mão, sem a régua: por isso o erro passou.
 */
const DADOS: DadosSeletor = {
  agenteId: "a", nome: "Clarice", dona: true, auto: true, ia: "claude-cli", modelo: "Opus", modeloDoAuto: "Opus",
  uso: 0.93, renovaEm: null, conta: "pessoal", seguir: { tipo: "esperar" }, raciocinio: "medium",
  niveis: ["low", "medium", "high", "xhigh", "max"],
  grupos: [{ ia: "claude-cli", serve: true, modelos: [{ id: "opus", nome: "Opus", marcado: false }, { id: "sonnet", nome: "Sonnet", marcado: false }] }],
};

const abrir = (escolher = vi.fn()) => {
  document.body.innerHTML = '<button id="composer-ia" aria-expanded="false">Auto · Opus</button>';
  const ancora = document.getElementById("composer-ia")!;
  ancora.focus();
  const expandido: (string | null)[] = [];
  let menu: { fechar: () => void } | null = null;
  act(() => { menu = abrirMenuIaNoReact(document, ancora, renderMenuIa(DADOS), escolher, () => expandido.push(ancora.getAttribute("aria-expanded"))); });
  return { ancora, escolher, expandido, fechar: () => menu?.fechar() };
};
const popup = () => document.querySelector<HTMLElement>(".bot-menu.rx-menu.ia-sel-menu");

describe("o menu do seletor de IA do campo (o HTML real, com a régua e o uso)", () => {
  it("abre com o Automático, os modelos e a régua de raciocínio, e o estilo inline vira estilo de verdade", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ancora } = abrir();
    await waitFor(() => expect(popup()).toBeTruthy());
    expect(ancora.getAttribute("aria-expanded")).toBe("true");
    expect(popup()!.querySelector('[data-escolha="auto"]')).toBeTruthy();
    expect(popup()!.querySelectorAll('[data-escolha="modelo"]')).toHaveLength(2);
    expect(popup()!.querySelectorAll('[data-escolha="raciocinio"]')).toHaveLength(5);
    expect(popup()!.querySelector<HTMLElement>(".ia-sel-seg")!.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    expect(popup()!.querySelector<HTMLElement>(".ia-sel-barra > span")!.style.width).toBe("93.0%");
    expect(erros).not.toHaveBeenCalled();
    erros.mockRestore();
  });

  it("escolher outro modelo entrega a escolha, fecha o menu e a seta volta (aria-expanded false)", async () => {
    const { ancora, escolher, expandido } = abrir();
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.click(popup()!.querySelector('[data-escolha="modelo"][data-modelo="sonnet"]')!); });
    await waitFor(() => expect(escolher).toHaveBeenCalledWith({ tipo: "modelo", ia: "claude-cli", modelo: "sonnet" }));
    await waitFor(() => expect(document.querySelector(".rx-menu-host")).toBeNull());
    expect(ancora.getAttribute("aria-expanded")).toBe("false");
    expect(expandido).toEqual(["true", "false"]);
  });

  it("o raciocínio também é uma escolha", async () => {
    const { escolher } = abrir();
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.click(popup()!.querySelector('[data-raciocinio="high"]')!); });
    await waitFor(() => expect(escolher).toHaveBeenCalledWith({ tipo: "raciocinio", raciocinio: "high" }));
  });

  it("Esc fecha sem escolha e a seta volta", async () => {
    const { ancora, escolher } = abrir();
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fireEvent.keyDown(document.activeElement ?? popup()!, { key: "Escape" }); });
    await waitFor(() => expect(document.querySelector(".rx-menu-host")).toBeNull());
    expect(escolher).not.toHaveBeenCalled();
    expect(ancora.getAttribute("aria-expanded")).toBe("false");
  });

  it("fechar por código (a conversa trocou com o menu aberto) também desfaz o aria-expanded", async () => {
    const { ancora, fechar } = abrir();
    await waitFor(() => expect(popup()).toBeTruthy());
    act(() => { fechar(); });
    await waitFor(() => expect(document.querySelector(".rx-menu-host")).toBeNull());
    expect(ancora.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("o menu da barra a partir do HTML: o style inline", () => {
  it("num contêiner com botões e no próprio botão vira objeto de estilo (o React não aceita a string)", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.body.innerHTML = '<button id="ancora">x</button>';
    const ancora = document.getElementById("ancora")!;
    const html = '<div role="menu" aria-label="M"><div class="linha" style="display: grid; --cor: red"><button type="button" role="menuitem" data-x="1" style="margin-left: 4px">Um</button></div></div>';
    act(() => { abrirMenuDeHtmlNoReact(document, { html, ancora, aoEscolher: vi.fn() }); });
    await waitFor(() => expect(document.querySelector(".rx-menu .linha")).toBeTruthy());
    const linha = document.querySelector<HTMLElement>(".rx-menu .linha")!;
    expect(linha.style.display).toBe("grid");
    expect(linha.style.getPropertyValue("--cor")).toBe("red");
    expect(document.querySelector<HTMLElement>('.rx-menu [data-x="1"]')!.style.marginLeft).toBe("4px");
    expect(erros).not.toHaveBeenCalled();
    erros.mockRestore();
  });
});

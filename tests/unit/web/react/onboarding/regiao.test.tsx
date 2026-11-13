import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoOnboarding } from "../../../../../src/contracts/onboarding.ts";
import { MARCA_REGIAO } from "../../../../../web/react/regioes.tsx";
import { desenharOnboarding, desmontarOnboarding, type DesenhoDoOnboarding } from "../../../../../web/react/onboarding/regiao.tsx";
import type { EstadoTelaOnboarding, VistaOnboarding } from "../../../../../web/telas/onboarding.ts";

/**
 * ADR-179 (fase 5): a região `#onboarding` inteira no React — montada uma vez, sem `data-act`, com o aviso no Dialog do
 * Base UI e o foco que vai ao título quando a tela troca sozinha.
 */
const dados = {
  etapa: "executor", mostrar: true, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null },
  guia: { id: "g1", nome: "Nod", conversaId: "cg", forma: "shape-square", cor: "c-black" }, executor: { pronto: false, ias: [{ id: "claude-cli", estado: "nao_autenticado" }] },
} as unknown as EstadoOnboarding;
const tela = (p: Partial<EstadoTelaOnboarding> = {}): EstadoTelaOnboarding => ({ dados, fase: "executor", procurando: false, iaEntrando: null, notaIa: null, teste: null, atendendo: false, emLigacao: false, appConectando: false, ocupado: false, ...p });

let regiao: HTMLElement;
const executar = vi.fn();
const desenho = (vista: VistaOnboarding): DesenhoDoOnboarding => ({ vista, executar, copiar: async () => true, cartao: { agir: vi.fn(), digitarCodigo: vi.fn(), colarCodigo: vi.fn(), copiar: async () => true } });
const desenhe = (v: VistaOnboarding | null): void => { act(() => desenharOnboarding(v ? desenho(v) : null)); };

beforeEach(() => {
  regiao = document.createElement("div");
  regiao.id = "onboarding";
  document.body.append(regiao);
  executar.mockReset();
});
afterEach(() => {
  act(() => desmontarOnboarding());
  regiao.remove();
});

describe("a região #onboarding no React", () => {
  it("sem camada não monta; com camada, monta uma vez e é marcada como do React", () => {
    desenhe(null);
    expect(regiao.hasAttribute(MARCA_REGIAO)).toBe(false);
    desenhe({ camada: { tipo: "ola" }, aviso: null });
    expect(regiao.hasAttribute(MARCA_REGIAO)).toBe(true);
    expect(regiao.querySelector(".ob-ola")).toBeTruthy();
    desenhe(null);
    expect(regiao.hasAttribute(MARCA_REGIAO)).toBe(true);
    expect(regiao.innerHTML).toBe("");
  });

  it("nenhuma tela da região usa data-act", () => {
    for (const camada of [{ tipo: "ola" }, { tipo: "executor", tela: tela() }, { tipo: "chamando", tela: tela({ fase: "chamando" }) }] as VistaOnboarding["camada"][]) {
      desenhe({ camada, aviso: null });
      expect(regiao.querySelector("[data-act]"), camada.tipo).toBeNull();
    }
  });

  it("o aviso de leitura abre no Dialog do Base UI e o 'Entendi' avisa o controlador", async () => {
    desenhe({ camada: { tipo: "executor", tela: tela() }, aviso: { titulo: "Como liberar o Claude Code", paragrafos: ["Peça ao administrador."] } });
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo.textContent).toContain("Como liberar o Claude Code");
    expect(dialogo.textContent).toContain("Peça ao administrador.");
    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    expect(executar).toHaveBeenCalledWith("onboarding-fechar-aviso");
    desenhe({ camada: { tipo: "executor", tela: tela() }, aviso: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("quem estava com o foco num botão que sumiu vai ao título da tela nova", () => {
    desenhe({ camada: { tipo: "executor", tela: tela() }, aviso: null });
    const entrar = screen.getByRole("button", { name: "Entrar" });
    entrar.focus();
    expect(document.activeElement).toBe(entrar);
    // O servidor diz que o login terminou: a tela vira "está te ligando" (sem o botão de antes).
    desenhe({ camada: { tipo: "executor", tela: tela({ teste: { rodando: true, vereditos: {}, testando: [], conexao: null, seguindo: false, nome: null }, dados: { ...dados, executor: { pronto: true, ias: [{ id: "claude-cli", estado: "pronto" }] } } }) }, aviso: null });
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("A IA dos seus bots");
  });
});

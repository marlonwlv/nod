import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { criarTelasNoReact, vagaDaTela } from "../../../../../web/react/telas/telas.tsx";

/** ADR-179 (as telas no lugar da conversa): a tela monta na vaga da região e desmonta antes de a vaga sair. */
describe("telas no React", () => {
  const acoes = { naoLidos: { abrirConversa: vi.fn(), abrirSala: vi.fn(), marcarLida: vi.fn(), marcarTudo: vi.fn() },
    rotinas: { pausar: vi.fn(), ativar: vi.fn(), testar: vi.fn(), alternarExecucoes: vi.fn(), abrirConversa: vi.fn(), verPergunta: vi.fn(), novaRotina: vi.fn() },
    novoBot: { abrirConversa: vi.fn(), fechar: vi.fn(), criar: vi.fn(), novoChatEmGrupo: vi.fn(), enviar: vi.fn(), aoDesenhar: vi.fn() },
    tarefas: { fonte: { dados: () => ({ quadros: null, erro: null }), assinar: () => () => undefined, tentarDeNovo: vi.fn() }, avatar: () => "", abrirTarefa: vi.fn(), abrirPagina: vi.fn() },
    trabalhos: { vista: vi.fn(), mostrar: vi.fn(), menuDeBots: vi.fn(), novaTarefa: vi.fn(), alternarBot: vi.fn(), abrirTrabalho: vi.fn(), abrirConversa: vi.fn() },
    novaRotina: { criar: vi.fn(), cancelar: vi.fn(), criarBot: vi.fn() },
    novaSala: { criar: vi.fn() },
    suaVez: { limparVencidos: vi.fn() } };
  const e: Estado = { ...estadoInicial, naoLidos: { conversas: [] } };

  it("monta na vaga, fica enquanto a vaga fica e desmonta antes de a região trocar de HTML", () => {
    document.body.innerHTML = '<section id="timeline"></section>';
    const regiao = document.getElementById("timeline")!;
    const telas = criarTelasNoReact(criarLoja(() => e), acoes);
    regiao.innerHTML = vagaDaTela("nao-lidos");
    // O 1º desenho é síncrono: sem act, a tela já está no documento (o foco do main a acha).
    telas.sincronizar(regiao);
    expect(regiao.querySelector(".tela-nao-lidos")).toBeTruthy();
    expect(telas.montada()).toBe("nao-lidos");
    expect(regiao.querySelector(".tela-nao-lidos h1")?.textContent).toBe("Não lidos");
    const vaga = regiao.firstElementChild;
    // O mesmo HTML (a região não é regravada): nada muda.
    act(() => { telas.antesDeRegravar(vagaDaTela("nao-lidos")); telas.sincronizar(regiao); });
    expect(regiao.firstElementChild).toBe(vaga);
    expect(telas.montada()).toBe("nao-lidos");
    // Outra tela: desmonta antes, e a região é escrita sem o root.
    act(() => telas.antesDeRegravar('<div class="tela-rotinas"></div>'));
    expect(telas.montada()).toBeNull();
    expect(vaga?.hasAttribute("data-react-regiao")).toBe(false);
    regiao.innerHTML = '<div class="tela-rotinas"></div>';
    act(() => telas.sincronizar(regiao));
    expect(telas.montada()).toBeNull();
  });

  it("a vaga recriada (a região regravada por fora) ganha um root novo", () => {
    document.body.innerHTML = '<section id="timeline"></section>';
    const regiao = document.getElementById("timeline")!;
    const telas = criarTelasNoReact(criarLoja(() => e), acoes);
    regiao.innerHTML = vagaDaTela("nao-lidos");
    act(() => telas.sincronizar(regiao));
    regiao.innerHTML = vagaDaTela("nao-lidos");
    act(() => telas.sincronizar(regiao));
    expect(regiao.querySelector(".tela-nao-lidos")).toBeTruthy();
  });
});

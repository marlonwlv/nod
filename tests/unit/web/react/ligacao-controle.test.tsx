import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ligacao } from "../../../../src/contracts/ligacao.ts";
import type { MotorLigacao, OpcoesMotor } from "../../../../web/lib/ligacao.ts";
import { criarTelaLigacao } from "../../../../web/telas/ligacao-controle.ts";
import { montarLigacaoNoReact } from "../../../../web/react/ligacao/ligacao.tsx";

/**
 * ADR-179 (item 4): o controle de verdade (web/telas/ligacao-controle.ts) com a região em React — abrir, o foco que ele
 * põe em Encolher e Expandir (o nó tem de estar no documento na hora), o tique do cronômetro, o mudo no motor e o fim
 * com a avaliação; a região some (`hidden`) quando não há o que mostrar.
 */
const ligacao: Ligacao = {
  id: "l1", agenteId: "a", conversaId: "c1", estado: "em_curso", iniciadaPor: "pessoa", harness: "claude-cli", modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "bento",
  mensagemId: null, iniciadaEm: 1_000, atendidaEm: Date.now(), encerradaEm: null, motivoFim: null, duracaoMs: null, religacoes: 0, trocas: 0, interrupcoes: 0, sttSegundos: 0, ttsCaracteres: 0,
  custoEstimadoUsd: null, latenciaP50Ms: null, latenciaP95Ms: null, avaliacao: null, transcricaoApagadaEm: null, resumida: false,
};
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

function preparar() {
  document.body.innerHTML = '<div id="ligacao" hidden></div>';
  const motor: MotorLigacao = { mudo: vi.fn(), enviarTexto: vi.fn(() => true), resolvendo: vi.fn(), desligar: vi.fn(), fechar: vi.fn(), retomarAudio: vi.fn(async () => undefined) };
  const tela = criarTelaLigacao({
    api: () => null, tenantId: () => "t1", iniciarMotor: (_o: OpcoesMotor) => motor, agente: () => ({ id: "a", nome: "Nina", cor: "c-blue", forma: "shape-square" }),
    suaVez: () => null, aoMudar: () => undefined, decidirPeloClique: async () => undefined, aoEncerrar: () => undefined,
  });
  const raiz = document.getElementById("ligacao")!;
  tela.desenharPorFora();
  act(() => {
    montarLigacaoNoReact(raiz, tela, {
      encolher: () => tela.encolher(), expandir: () => tela.expandir(), alternarMudo: () => tela.alternarMudo(), alternarTeclado: () => tela.alternarTeclado(), abrirAjustes: () => undefined,
      desligar: () => void tela.desligar(), decidir: () => undefined, retomarAudio: () => undefined, enviarTexto: (x) => tela.enviarTexto(x), continuarCom: () => undefined, iaNoMac: () => undefined,
      semVoz: () => undefined, avaliar: (n) => void tela.avaliar(n), motivo: () => undefined, fecharAvaliacao: () => tela.fecharAvaliacao(), fecharRecusa: () => tela.fecharRecusa(), ajustesDoMicrofone: () => undefined,
    });
  });
  return { tela, motor, raiz };
}

describe("o controle da ligação com a região em React", () => {
  it("abre em tela cheia com o foco em Encolher; encolher e expandir levam o foco ao botão do outro modo", () => {
    const { tela, raiz } = preparar();
    expect(raiz.hidden).toBe(true);
    act(() => { tela.atenderOnboarding(ligacao); });
    expect(raiz.hidden).toBe(false);
    expect(raiz.querySelector(".ligacao-cheia")).toBeTruthy();
    expect(document.activeElement?.getAttribute("data-lig")).toBe("encolher");
    act(() => { fireEvent.click(document.activeElement!); });
    expect(raiz.querySelector(".ligacao-pilula")).toBeTruthy();
    expect(document.activeElement?.getAttribute("data-lig")).toBe("expandir");
    act(() => { fireEvent.click(document.activeElement!); });
    expect(document.activeElement?.getAttribute("data-lig")).toBe("encolher");
  });

  it("o cronômetro anda a cada segundo; o mudo vai ao motor; o teclado envia pelo motor e a fala entra na legenda", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { tela, motor, raiz } = preparar();
    act(() => { tela.atenderOnboarding(ligacao); });
    const antes = raiz.querySelector(".lc-relogio")!.textContent;
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(raiz.querySelector(".lc-relogio")!.textContent).not.toBe(antes);
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="mudo"]')!); });
    expect(motor.mudo).toHaveBeenCalledWith(true);
    expect(raiz.querySelector('[data-lig="mudo"]')?.getAttribute("aria-pressed")).toBe("true");
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="teclado"]')!); });
    const campo = raiz.querySelector<HTMLInputElement>("#ligacao-texto")!;
    expect(document.activeElement).toBe(campo);
    campo.value = "Pode mandar";
    act(() => { fireEvent.submit(campo.form!); });
    expect(motor.enviarTexto).toHaveBeenCalledWith("Pode mandar");
    expect(raiz.querySelector(".lc-fala.lc-pessoa")?.textContent).toBe("Pode mandar");
  });

  it("desligar: o motor desliga e a avaliação aparece; fechar a avaliação esconde a região", () => {
    const { tela, motor, raiz } = preparar();
    act(() => { tela.atenderOnboarding(ligacao); });
    act(() => { fireEvent.click(raiz.querySelector('[data-lig="desligar"]')!); });
    expect(motor.desligar).toHaveBeenCalledOnce();
    expect(raiz.querySelector(".ligacao-avaliacao")).toBeTruthy();
    act(() => { fireEvent.click(raiz.querySelector(".la-fechar")!); });
    expect(raiz.hidden).toBe(true);
    expect(raiz.innerHTML).toBe("");
  });
});

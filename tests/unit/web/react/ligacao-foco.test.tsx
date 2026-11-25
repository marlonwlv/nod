import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ligacao } from "../../../../src/contracts/ligacao.ts";
import type { MotorLigacao } from "../../../../web/lib/ligacao.ts";
import { criarTelaLigacao } from "../../../../web/telas/ligacao-controle.ts";
import { montarLigacaoNoReact } from "../../../../web/react/ligacao/ligacao.tsx";

/**
 * QA-151: quem usa o teclado não perde o lugar quando a região da ligação é redesenhada — no React e no desenho por
 * string. Desligar leva ao 👍 da avaliação, o 👎 ao primeiro motivo, fechar devolve o foco a quem abriu a ligação; o mudo
 * e o teclado da string seguem no mesmo botão; foco fora da região (a pílula com a pessoa no nod) não é tocado.
 */
const ligacao = {
  id: "l1", agenteId: "a", conversaId: "c1", estado: "em_curso", iniciadaPor: "pessoa", harness: "claude-cli", modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "bento",
  mensagemId: null, iniciadaEm: 1_000, atendidaEm: Date.now(), encerradaEm: null, motivoFim: null, duracaoMs: null, religacoes: 0, trocas: 0, interrupcoes: 0, sttSegundos: 0, ttsCaracteres: 0,
  custoEstimadoUsd: null, latenciaP50Ms: null, latenciaP95Ms: null, avaliacao: null, transcricaoApagadaEm: null, resumida: false,
} as Ligacao;
afterEach(() => { document.body.innerHTML = ""; });

function preparar(react: boolean) {
  document.body.innerHTML = '<button id="ligar">Ligar</button><textarea id="composer-texto"></textarea><div id="ligacao" hidden></div>';
  const motor: MotorLigacao = { mudo: vi.fn(), enviarTexto: vi.fn(() => true), resolvendo: vi.fn(), desligar: vi.fn(), fechar: vi.fn(), retomarAudio: vi.fn(async () => undefined) };
  const tela = criarTelaLigacao({
    api: () => null, tenantId: () => "t1", iniciarMotor: () => motor, agente: () => ({ id: "a", nome: "Nina", cor: "c-blue", forma: "shape-square" }),
    suaVez: () => null, aoMudar: () => undefined, decidirPeloClique: async () => undefined, aoEncerrar: () => undefined,
  });
  const raiz = document.getElementById("ligacao")!;
  if (react) {
    tela.desenharPorFora();
    act(() => {
      montarLigacaoNoReact(raiz, tela, {
        encolher: () => tela.encolher(), expandir: () => tela.expandir(), alternarMudo: () => tela.alternarMudo(), alternarTeclado: () => tela.alternarTeclado(), abrirAjustes: () => undefined,
        desligar: () => void tela.desligar(), decidir: () => undefined, retomarAudio: () => undefined, enviarTexto: (x) => tela.enviarTexto(x), continuarCom: () => undefined, iaNoMac: () => undefined,
        semVoz: () => undefined, avaliar: (n) => void tela.avaliar(n), motivo: () => undefined, fecharAvaliacao: () => tela.fecharAvaliacao(), fecharRecusa: () => tela.fecharRecusa(), ajustesDoMicrofone: () => undefined,
      });
    });
  }
  const botao = (n: string) => raiz.querySelector<HTMLElement>(react ? `[data-lig="${n}"]` : `[data-act="ligacao-${n}"]`)!;
  return { tela, raiz, botao };
}

for (const react of [true, false]) {
  describe(`o foco na ligação (${react ? "React" : "string"})`, () => {
    it("mudo e teclado seguem no botão; desligar vai ao 👍, o 👎 ao 1º motivo e fechar volta a quem ligou", async () => {
      const { tela, raiz, botao } = preparar(react);
      document.getElementById("ligar")!.focus();
      act(() => { tela.atenderOnboarding(ligacao); });
      act(() => { botao("mudo").focus(); tela.alternarMudo(); });
      expect(document.activeElement).toBe(botao("mudo"));
      act(() => { tela.alternarTeclado(); });
      act(() => { botao("teclado").focus(); tela.alternarTeclado(); });
      expect(document.activeElement).toBe(botao("teclado"));
      act(() => { botao("desligar").focus(); void tela.desligar(); });
      expect(document.activeElement).toBe(raiz.querySelector(".la-nota"));
      act(() => { void tela.avaliar("ruim"); });
      expect(document.activeElement).toBe(raiz.querySelector(".la-motivos .chip-sugestao"));
      act(() => { tela.fecharAvaliacao(); });
      await Promise.resolve();
      expect(document.activeElement?.id).toBe("ligar");
    });

    it("sem quem ligou no documento, fechar leva ao campo de mensagem", async () => {
      const { tela, raiz, botao } = preparar(react);
      act(() => { tela.atenderOnboarding(ligacao); });
      act(() => { botao("desligar").focus(); void tela.desligar(); });
      act(() => { (raiz.querySelector(".la-fechar") as HTMLElement).focus(); tela.fecharAvaliacao(); });
      await Promise.resolve();
      expect(document.activeElement?.id).toBe("composer-texto");
    });

    it("com o foco fora da região, o fim da ligação não o mexe", async () => {
      const { tela } = preparar(react);
      act(() => { tela.atenderOnboarding(ligacao); tela.encolher(); });
      document.getElementById("composer-texto")!.focus();
      act(() => { void tela.desligar(); });
      act(() => { tela.fecharAvaliacao(); });
      await Promise.resolve();
      expect(document.activeElement?.id).toBe("composer-texto");
    });
  });
}

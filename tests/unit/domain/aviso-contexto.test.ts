import { describe, expect, it } from "vitest";
import type { ChamadaRaioX, ExecucaoRaioX } from "../../../src/contracts/raio-x.ts";
import { AVISO_CONTEXTO_TOKENS, avisoDeContexto, contextoNoFim, limiteDoAviso, textoDoAvisoDeContexto } from "../../../src/domain/aviso-contexto.ts";
import { JANELA_LONGA, JANELA_PADRAO, limiarDeCompactacao } from "../../../src/domain/orcamento-contexto.ts";

/** Issue #168: quando o histórico da conversa cruza o limite, o chat ganha UMA linha sugerindo /compactar ou /nova-sessao. */
const chamada = (em: number, contexto: number, subagente = false): ChamadaRaioX => ({ em, contexto, entrada: 0, cacheLido: contexto, cacheNovo: 0, saida: 10, pensamento: 0, subagente, ferramentas: [] });
const execucao = (chamadas: ChamadaRaioX[], o: Partial<ExecucaoRaioX> = {}): ExecucaoRaioX => ({
  chamadas, chamadasOmitidas: 0, compactacoes: [], janela: JANELA_LONGA, modelo: "claude-opus-5-5", versaoCli: "2.1.309", custoSessaoUsd: null, ferramentasNoInit: 0, buscaDeFerramentas: false, duracaoMs: 1, ...o,
});

describe("limiteDoAviso", () => {
  it("numa janela de 1M vale o padrão de 300 mil", () => {
    expect(limiteDoAviso(JANELA_LONGA)).toBe(AVISO_CONTEXTO_TOKENS);
  });

  it("numa janela de 200k vem a 80% do limiar de compactação, antes de o Claude Code resumir sozinho", () => {
    expect(limiteDoAviso(JANELA_PADRAO)).toBe(Math.floor(0.8 * limiarDeCompactacao(JANELA_PADRAO)));
    expect(limiteDoAviso(JANELA_PADRAO)).toBeLessThan(limiarDeCompactacao(JANELA_PADRAO));
  });
});

describe("contextoNoFim", () => {
  it("é o contexto da última chamada da conversa principal; subagente não conta", () => {
    expect(contextoNoFim(execucao([chamada(1, 100_000), chamada(2, 120_000), chamada(3, 900_000, true)]))).toBe(120_000);
  });

  it("uma compactação depois da última chamada vale o que sobrou dela", () => {
    expect(contextoNoFim(execucao([chamada(1, 310_000)], { compactacoes: [{ em: 2, antes: 310_000, depois: 20_000, gatilho: "manual" }] }))).toBe(20_000);
  });

  it("uma compactação antes da última chamada não muda a medida", () => {
    expect(contextoNoFim(execucao([chamada(3, 40_000)], { compactacoes: [{ em: 2, antes: 310_000, depois: 20_000, gatilho: "auto" }] }))).toBe(40_000);
  });

  it("sem chamada nem compactação (Codex, turno sem result), não há medida", () => {
    expect(contextoNoFim(execucao([]))).toBeNull();
    expect(contextoNoFim(null)).toBeNull();
  });
});

describe("avisoDeContexto", () => {
  const acima = execucao([chamada(1, 290_000), chamada(2, 305_000)]);

  it("avisa quando o turno cruza o limite", () => {
    expect(avisoDeContexto({ atual: acima, anterior: execucao([chamada(1, 250_000)]), modelo: "opus" })).toEqual({ contexto: 305_000, limite: AVISO_CONTEXTO_TOKENS });
  });

  it("avisa no primeiro turno medido, sem turno anterior", () => {
    expect(avisoDeContexto({ atual: acima, anterior: null, modelo: "opus" })).not.toBeNull();
  });

  it("não repete quando o turno anterior já tinha acabado acima", () => {
    expect(avisoDeContexto({ atual: acima, anterior: execucao([chamada(1, 301_000)]), modelo: "opus" })).toBeNull();
  });

  it("abaixo do limite, nada", () => {
    expect(avisoDeContexto({ atual: execucao([chamada(1, 299_999)]), anterior: null, modelo: "opus" })).toBeNull();
  });

  it("depois de /compactar o histórico volta para baixo e a próxima subida avisa de novo", () => {
    const compactado = execucao([chamada(1, 310_000)], { compactacoes: [{ em: 2, antes: 310_000, depois: 20_000, gatilho: "manual" }] });
    expect(avisoDeContexto({ atual: acima, anterior: compactado, modelo: "opus" })).not.toBeNull();
  });

  it("numa janela de 200k avisa bem antes de 300 mil", () => {
    const limite = limiteDoAviso(JANELA_PADRAO);
    const atual = execucao([chamada(1, limite + 1)], { janela: JANELA_PADRAO, modelo: "claude-haiku-4-5" });
    expect(avisoDeContexto({ atual, anterior: null, modelo: "haiku" })).toEqual({ contexto: limite + 1, limite });
  });

  it("sem a janela observada, decide pelo nome do modelo do turno", () => {
    const atual = execucao([chamada(1, 130_000)], { janela: null, modelo: null });
    expect(avisoDeContexto({ atual, anterior: null, modelo: "claude-sonnet-4-6" })).not.toBeNull();
    expect(avisoDeContexto({ atual, anterior: null, modelo: "opus" })).toBeNull();
  });
});

describe("textoDoAvisoDeContexto", () => {
  it("diz o tamanho, o limite e o que fazer", () => {
    expect(textoDoAvisoDeContexto("Atlas", { contexto: 305_400, limite: 300_000 })).toBe(
      "A conversa com Atlas já ocupa 305 mil tokens de contexto (o aviso começa em 300 mil). Cada mensagem relê esse histórico, então fica mais cara e mais lenta. Use /compactar para resumir ou /nova-sessao para começar do zero.",
    );
  });
});

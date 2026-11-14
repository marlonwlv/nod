import { describe, expect, it } from "vitest";
import type { EstadoComputadorRelatado } from "../../../src/contracts/computador-motor.ts";
import { PRESENCA_MULTIPLICA_SONO } from "../../../src/contracts/estado-vivo.ts";
import { chaveDaMaquina, cursorDaAcao, limiteDoSono, maquinaNoStream } from "../../../src/domain/computador-vivo.ts";

/** D (2026-11-12): o computador do bot ao vivo — cursor, estado da máquina no stream e o sono com a presença. */
describe("cursorDaAcao", () => {
  it("clicar: posição, botão do xdotool no nome e a contagem", () => {
    expect(cursorDaAcao({ tipo: "clicar", x: 10, y: 20, quadro: "q", botao: 3, vezes: 2 }, "b1", null, 5)).toEqual({ bot: "b1", tipo: "clicar", x: 10, y: 20, botao: "direito", contagem: 2, em: 5 });
    expect(cursorDaAcao({ tipo: "clicar", x: 1, y: 2, quadro: "q" }, "b1", null, 5)).toMatchObject({ botao: "esquerdo", contagem: 1 });
  });

  it("arrastar termina no destino; rolar e digitar acontecem onde o cursor estava (sem posição, não sai frame)", () => {
    expect(cursorDaAcao({ tipo: "arrastar", x: 1, y: 2, destinoX: 30, destinoY: 40, quadro: "q" }, "b1", null, 5)).toMatchObject({ tipo: "arrastar", x: 30, y: 40 });
    expect(cursorDaAcao({ tipo: "rolar", delta: 3, quadro: "q" }, "b1", { x: 7, y: 8 }, 5)).toMatchObject({ tipo: "rolar", x: 7, y: 8 });
    expect(cursorDaAcao({ tipo: "digitar", texto: "oi", quadro: "q" }, "b1", { x: 7, y: 8 }, 5)).toMatchObject({ tipo: "digitar", x: 7, y: 8 });
    expect(cursorDaAcao({ tipo: "tecla", tecla: "Enter", quadro: "q" }, "b1", null, 5)).toBeNull();
  });

  it("ação que não mexe no ponteiro não desenha nada", () => {
    expect(cursorDaAcao({ tipo: "observar" }, "b1", { x: 1, y: 1 }, 5)).toBeNull();
    expect(cursorDaAcao({ tipo: "terminal", comando: "ls" }, "b1", { x: 1, y: 1 }, 5)).toBeNull();
  });
});

describe("estado da máquina no stream", () => {
  const relato = (o: Partial<EstadoComputadorRelatado> = {}): EstadoComputadorRelatado => ({ computadorId: "c1", ligado: true, supervisorPub: "k", telas: [{ agenteId: "b1", estado: "aberta", ultimaAcaoEm: 1, memoriaMb: 500 }], memoriaTotalMb: 4000, operacao: null, ...o });

  it("leva ligado, operação, telas por bot, memória e presença — nunca a chave do supervisor", () => {
    const d = maquinaNoStream("m1", relato({ operacao: { tipo: "atualizar", pct: 42.4, etapa: "baixando" } }), true, 9);
    expect(d).toEqual({ maquinaId: "m1", ligado: true, operacao: { tipo: "atualizar", pct: 42 }, telas: [{ bot: "b1", estado: "aberta", ultimaAcaoEm: 1, memoriaMb: 500 }], memoriaTotalMb: 4000, presente: true, em: 9 });
    expect(JSON.stringify(d)).not.toContain("supervisorPub");
  });

  it("a chave só muda com o que importa: memória que oscila e ultimaAcaoEm não mudam; tela fechando e degrau de memória mudam", () => {
    const base = chaveDaMaquina(maquinaNoStream("m1", relato(), false, 1));
    expect(chaveDaMaquina(maquinaNoStream("m1", relato({ telas: [{ agenteId: "b1", estado: "aberta", ultimaAcaoEm: 99, memoriaMb: 520 }] }), false, 2))).toBe(base);
    expect(chaveDaMaquina(maquinaNoStream("m1", relato({ telas: [{ agenteId: "b1", estado: "fechando", ultimaAcaoEm: 1, memoriaMb: 500 }] }), false, 2))).not.toBe(base);
    expect(chaveDaMaquina(maquinaNoStream("m1", relato({ telas: [{ agenteId: "b1", estado: "aberta", ultimaAcaoEm: 1, memoriaMb: 1400 }] }), false, 2))).not.toBe(base);
    expect(chaveDaMaquina(maquinaNoStream("m1", relato({ ligado: false }), false, 2))).not.toBe(base);
  });
});

describe("limiteDoSono", () => {
  it("presente multiplica o limite; ausente, o de sempre", () => {
    expect(limiteDoSono(900_000, false)).toBe(900_000);
    expect(limiteDoSono(900_000, true)).toBe(900_000 * PRESENCA_MULTIPLICA_SONO);
  });
});

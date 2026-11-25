import { describe, expect, it } from "vitest";
import { escDoCanvas } from "../../../web/lib/canvas-na-tela.ts";

/**
 * QA-230: o Esc por postMessage fechava a apresentação do canvas vindo de QUALQUER janela (artefato do bot, sandbox
 * do diagrama, outra aba), porque o iframe da apresentação não está em `vivos` e o ouvinte caía no "se está
 * apresentando, sai". Só o iframe nosso pode mandar o Esc.
 */
describe("canvas-na-tela: Esc por postMessage só de iframe nosso", () => {
  const viva = { nome: "tela viva" };
  const apresentacao = { nome: "tela da apresentação" };
  const intruso = { nome: "artefato do bot" };
  const esc = { nod: "esc" };

  it("Esc da tela viva sai do tamanho real", () => {
    expect(escDoCanvas({ source: viva, data: esc }, [viva], null)).toBe("real");
  });

  it("Esc da tela da apresentação fecha a apresentação", () => {
    expect(escDoCanvas({ source: apresentacao, data: esc }, [viva], apresentacao)).toBe("apresentar");
  });

  it("Esc forjado por outra janela não fecha a apresentação", () => {
    expect(escDoCanvas({ source: intruso, data: esc }, [viva], apresentacao)).toBeNull();
  });

  it("apresentação sem iframe (miniatura) não aceita Esc de ninguém", () => {
    expect(escDoCanvas({ source: intruso, data: esc }, [], null)).toBeNull();
    expect(escDoCanvas({ source: null, data: esc }, [null], null)).toBeNull();
    expect(escDoCanvas({ source: undefined, data: esc }, [], undefined)).toBeNull();
  });

  it("mensagem que não é o Esc é ignorada", () => {
    expect(escDoCanvas({ source: apresentacao, data: { nod: "outra" } }, [], apresentacao)).toBeNull();
    expect(escDoCanvas({ source: apresentacao, data: "esc" }, [], apresentacao)).toBeNull();
    expect(escDoCanvas({ source: apresentacao, data: null }, [], apresentacao)).toBeNull();
  });
});

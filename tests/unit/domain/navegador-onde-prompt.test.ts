import { describe, expect, it } from "vitest";
import { textoDoLugarDoNavegador } from "../../../src/domain/prompt-sistema.ts";

/**
 * 2026-11-27: o prompt diz ao bot onde o navegador dele roda agora. Em produção (26 e 27/11), com as navegador_* no plano,
 * o bot respondeu "o navegador/computador permanece indisponível nesta sessão" sem chamar nenhuma, e o texto de antes
 * dizia "um Chrome do nod, separado do laptop da pessoa" para um navegador que rodava no PC dela.
 */
describe("onde o navegador roda, no prompt", () => {
  it("no PC da pessoa: diz o aparelho, que é sem janela e que o login dela abre numa janela", () => {
    const t = textoDoLugarDoNavegador({ tipo: "aparelho", aparelho: "PC" }, "conversa");
    expect(t).toContain("roda no PC da pessoa");
    expect(t).toContain("abre numa janela na tela dela");
    expect(t).not.toContain("laptop");
  });

  it("no nod e numa máquina dela: cada um diz o seu lugar", () => {
    expect(textoDoLugarDoNavegador({ tipo: "nod" })).toContain("roda no nod, não no aparelho da pessoa");
    expect(textoDoLugarDoNavegador({ tipo: "maquina", nome: "vm-sp" })).toContain("na máquina vm-sp");
  });

  it("o lugar fora do ar leva a instrução da ferramenta; sempre a regra de não dizer indisponível sem tentar", () => {
    for (const onde of [{ tipo: "espera" as const, instrucao: "O seu PC está desligado." }, { tipo: "nod" as const }, undefined]) {
      expect(textoDoLugarDoNavegador(onde)).toContain("Nunca diga que o navegador está indisponível sem ter chamado uma navegador_* neste turno");
    }
    expect(textoDoLugarDoNavegador({ tipo: "espera", instrucao: "O seu PC está desligado." })).toContain("O seu PC está desligado.");
  });

  it("na rotina: login pedido uma vez, com aviso, sem contornar", () => {
    expect(textoDoLugarDoNavegador({ tipo: "aparelho", aparelho: "Mac" }, "rotina")).toContain("Numa rotina a pessoa não está olhando");
    expect(textoDoLugarDoNavegador({ tipo: "aparelho", aparelho: "Mac" }, "conversa")).not.toContain("Numa rotina");
  });
});

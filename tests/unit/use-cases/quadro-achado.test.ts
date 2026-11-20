import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Quadro } from "../../../src/contracts/quadro.ts";
import { falhaDoAchado } from "../../../src/use-cases/quadro.ts";

const agente = (n: number): Agente => ({ id: `agente-${n}`, nome: `Bot ${n}` } as Agente);
const quadro = (n: number): Quadro => ({ id: `quadro-${n}`, agenteId: `agente-${n}` } as Quadro);

describe("escolha de quadro ambíguo pelo chat", () => {
  it("explica como obter os candidatos omitidos quando há mais de cinco quadros", () => {
    const agentes = Array.from({ length: 7 }, (_, i) => agente(i + 1));
    const quadros = Array.from({ length: 7 }, (_, i) => quadro(i + 1));

    const falha = falhaDoAchado({ ambiguo: quadros }, agentes);

    expect(falha.detalhe).toContain("a pessoa tem 7 quadros");
    expect(falha.detalhe).toContain("Bot 5 (quadro-5)");
    expect(falha.detalhe).not.toContain("Bot 6 (quadro-6)");
    expect(falha.detalhe).toContain("primeiros 5; para ver os outros 2, chame listar_quadros {todos:true}");
  });

  it("não sugere continuação quando todos os quadros cabem na resposta", () => {
    const falha = falhaDoAchado({ ambiguo: [quadro(1), quadro(2)] }, [agente(1), agente(2)]);

    expect(falha.detalhe).not.toContain("listar_quadros");
  });
});

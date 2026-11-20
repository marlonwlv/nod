import { describe, expect, it } from "vitest";
import type { LeituraDeMaquinaDto } from "../../../src/contracts/maquina.ts";
import { avisoDaMaquina } from "../../../web/lib/aviso-da-maquina.ts";

/** ADR-187 (protótipo 4t, opção A, 2026-11-18): o selo ao lado da aba fala da máquina das tarefas do bot, pelo nome. */
const leitura = (id: string, nome: string, extra: Partial<LeituraDeMaquinaDto> = {}): LeituraDeMaquinaDto => ({
  id, nome, ehMac: false, pressao: "verde", memoriaBotsMb: 0, processador: "verde", usoProcessador: 0.2, cargaProcessador: 0.3, fila: "verde", disco: null, discoSuportado: true, motivoEspera: null, seguraTudoNovo: false, ...extra,
});
const disco = (nivel: "amarela" | "vermelha") => ({ livreMb: 1_000, totalMb: 30_000, nivel, alertaMb: 10_240, criticoMb: 3_072 });

describe("avisoDaMaquina", () => {
  it("só a máquina das tarefas do bot: a apertada sem tarefa dele não avisa", () => {
    const maquinas = [leitura("vm", "nod-vm", { pressao: "vermelha" }), leitura("pc", "PC-Windows")];
    expect(avisoDaMaquina(maquinas, [{ id: "pc" }])).toBeNull();
    expect(avisoDaMaquina(maquinas, [{ id: "vm" }])).toMatchObject({ maquinaId: "vm", recurso: "memoria", nivel: "vermelha", curto: "nod-vm quase sem memória" });
    expect(avisoDaMaquina(maquinas, [null, undefined])).toBeNull();
    expect(avisoDaMaquina(undefined, [{ id: "vm" }])).toBeNull();
  });

  it("memória, processador e disco, pelo nome da máquina (Mac, Windows, servidor, VM)", () => {
    expect(avisoDaMaquina([leitura("a", "MacBook Air", { pressao: "amarela" })], [{ id: "a" }])?.curto).toBe("Pouca memória em MacBook Air");
    expect(avisoDaMaquina([leitura("b", "PC-Windows", { processador: "amarela" })], [{ id: "b" }])?.curto).toBe("Processador ocupado em PC-Windows");
    expect(avisoDaMaquina([leitura("c", "srv-1", { processador: "vermelha" })], [{ id: "c" }])?.curto).toBe("Processador no limite em srv-1");
    expect(avisoDaMaquina([leitura("d", "nod-vm", { disco: disco("amarela") })], [{ id: "d" }])?.curto).toBe("Pouco espaço em nod-vm");
    expect(avisoDaMaquina([leitura("e", "nod-vm", { motivoEspera: "disco", seguraTudoNovo: true })], [{ id: "e" }])).toMatchObject({ curto: "Sem espaço em nod-vm", nivel: "vermelha" });
    expect(avisoDaMaquina([leitura("a", "MacBook Air", { pressao: "amarela" })], [{ id: "a" }])?.frase).toBe("As tarefas rodam em MacBook Air: a memória está apertada e elas podem ficar lentas. Ver a máquina.");
  });

  it("o pior ganha: vermelho antes de amarelo; no empate, disco, memória, processador; entre máquinas também", () => {
    const uma = [leitura("a", "nod-vm", { pressao: "amarela", processador: "vermelha", disco: disco("amarela") })];
    expect(avisoDaMaquina(uma, [{ id: "a" }])?.recurso).toBe("processador");
    const empate = [leitura("a", "nod-vm", { pressao: "amarela", processador: "amarela", disco: disco("amarela") })];
    expect(avisoDaMaquina(empate, [{ id: "a" }])?.recurso).toBe("disco");
    const duas = [leitura("a", "nod-vm", { pressao: "amarela" }), leitura("b", "PC-Windows", { pressao: "vermelha" })];
    expect(avisoDaMaquina(duas, [{ id: "a" }, { id: "b" }])).toMatchObject({ maquinaId: "b", nivel: "vermelha" });
  });
});

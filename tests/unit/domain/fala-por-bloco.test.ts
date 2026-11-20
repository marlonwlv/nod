import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { criarFalaPorBloco } from "../../../src/domain/fala-por-bloco.ts";
import { criarFalaDoMeio } from "../../../src/domain/mensagem-no-meio.ts";
import { classificarResultado, classificarSessao, NARRACAO_MAX_CHARS } from "../../../src/domain/stream-json.ts";

/** Estado vivo, item 1 (2026-11-12): cada bloco de texto fechado vira mensagem própria, sem esperar o `result`. */
const bloco = (texto: string): EventoStream => ({ tipo: "texto_bloco", texto });
const ferramenta = (id: string): EventoStream => ({ tipo: "tool_use", id, nome: "Bash", input: {} });
const retorno = (id: string): EventoStream => ({ tipo: "tool_result", toolUseId: id, isError: false, texto: "ok" });
const result = (texto: string): EventoStream => ({ tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: null });
const relatorio = "R".repeat(NARRACAO_MAX_CHARS + 1);

function rodar(eventos: EventoStream[]) {
  const meio = criarFalaDoMeio();
  const porBloco = criarFalaPorBloco(meio);
  const falas: string[] = [];
  for (const ev of eventos) {
    const r = meio.avaliar(ev, true);
    if (r !== null) falas.push(r);
    const b = porBloco.avaliar(ev);
    if (b !== null) falas.push(b);
  }
  return { meio, falas };
}

describe("fala por bloco", () => {
  it("dois blocos seguidos: o primeiro sai na hora em que o segundo fecha; o último fica para a fala da volta", () => {
    const eventos = [bloco("Primeiro."), { tipo: "fase", fase: "fim_bloco" } as EventoStream, bloco("Segundo."), result("Segundo.")];
    const { meio, falas } = rodar(eventos);
    expect(falas).toEqual(["Primeiro."]);
    expect(classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio }).texto).toBe("Segundo.");
  });

  it("frase curta antes de ferramenta é narração (fica no cartão); relatório antes de ferramenta sai e não repete no fim", () => {
    const eventos = [bloco("Rodando os testes."), ferramenta("a"), retorno("a"), bloco(relatorio), ferramenta("b"), retorno("b"), bloco("Pronto."), result("Pronto.")];
    const { meio, falas } = rodar(eventos);
    expect(falas).toEqual([relatorio]);
    const r = classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio });
    expect(r.texto).toBe("Pronto.");
    // Sem a fala por bloco, o relatório ia colado acima do fim (comporFala).
    expect(classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "" }).texto).toBe(`${relatorio}\n\nPronto.`);
  });

  it("a resposta à mensagem do meio não sai duas vezes", () => {
    const meio = criarFalaDoMeio();
    const porBloco = criarFalaPorBloco(meio);
    meio.armar();
    const resposta = bloco("Sexta.");
    expect(meio.avaliar(resposta, true)).toBe("Sexta.");
    expect(porBloco.avaliar(resposta)).toBeNull();
    expect(porBloco.avaliar(bloco("Depois."))).toBeNull();
  });

  it("sessão viva com duas voltas: a rodada já falada por bloco não volta na entrega", () => {
    const eventos = [bloco("A."), bloco("B."), result("B."), bloco("C."), bloco("D."), result("D.")];
    const { meio, falas } = rodar(eventos);
    expect(falas).toEqual(["A.", "C."]);
    const r = classificarSessao({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio, rodadasJaFaladas: 1 });
    expect(r.texto).toBe("D.");
  });

  it("bloco vazio não vira mensagem", () => {
    expect(rodar([bloco("  "), bloco("Fim."), result("Fim.")]).falas).toEqual([]);
  });
});

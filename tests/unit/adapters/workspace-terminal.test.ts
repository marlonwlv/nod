import { describe, expect, it } from "vitest";
import { continuarResposta, cortarResposta } from "../../../src/adapters/mcp-proxy/corte.ts";
import { LIMITE_SAIDA_TERMINAL_CHARS, limitarSaidaTerminal } from "../../../src/adapters/workspace/terminal.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../../src/shared/constantes.ts";

describe("saída do terminal do computador", () => {
  it("preserva mais de uma página para o proxy oferecer o restante por ler_mais", () => {
    const original = Array.from({ length: 18_000 }, (_, i) => `${i + 1}`).join("\n");
    const resultado = limitarSaidaTerminal(original);

    expect(resultado.truncado).toBe(false);
    expect(resultado.saida).toBe(original);
    expect(resultado.saida.length).toBeGreaterThan(ORCAMENTO_RESULTADO_CHARS);
  });

  it("chega inteira em duas partes pelo contrato usado por ler_mais", () => {
    const saida = Array.from({ length: 18_000 }, (_, i) => `${i + 1}`).join("\n");
    const conteudo = JSON.stringify({ saida, codigoSaida: 0, truncado: false });
    const primeira = cortarResposta(conteudo, ORCAMENTO_RESULTADO_CHARS, "r1");

    expect(primeira.cortado).toBe(true);
    let reunido = primeira.texto.split("\n[nod:")[0]!;
    let resto = primeira.resto;
    while (resto) {
      const pagina = continuarResposta(resto, ORCAMENTO_RESULTADO_CHARS, "r1");
      reunido += pagina.texto.split("\n[nod:")[0]!;
      resto = pagina.resto;
    }
    expect(JSON.parse(reunido)).toEqual({ saida, codigoSaida: 0, truncado: false });
  });

  it("limita a memória por tamanho serializado e preserva explicitamente o fim", () => {
    const original = `${"x\n".repeat(LIMITE_SAIDA_TERMINAL_CHARS)}fim`;
    const resultado = limitarSaidaTerminal(original);

    expect(resultado.truncado).toBe(true);
    expect(resultado.saida.endsWith("fim")).toBe(true);
    expect(JSON.stringify(resultado.saida).length).toBeLessThanOrEqual(LIMITE_SAIDA_TERMINAL_CHARS);
  });
});

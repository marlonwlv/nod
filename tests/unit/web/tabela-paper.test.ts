import { describe, expect, it } from "vitest";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";

describe("a tabela da fala como o Paper 02/17 (rodada 2)", () => {
  it("o código de issue vai em mono e a prioridade sozinha na célula vira chip", () => {
    const h = textoFormatado("| Linear | | 2 issues |\n|---|---|---:|\n| NOD-512 | Criar bot | Alta |\n| NOD-515 | Card some | Urgente |\n| <b>x</b> | Média ou não | Baixa |");
    expect(h).toContain('<td class="curta md-codigo">NOD-512</td>');
    expect(h).toContain('<span class="md-prio md-prio-alta">Alta</span>');
    expect(h).toContain('<span class="md-prio md-prio-urgente">Urgente</span>');
    expect(h).toContain('<span class="md-prio md-prio-baixa">Baixa</span>');
    expect(h).not.toContain("md-prio-media");
    expect(h).not.toContain("<b>x</b>");
  });
});

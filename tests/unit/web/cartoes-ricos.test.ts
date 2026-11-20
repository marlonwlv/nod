import { describe, expect, it } from "vitest";
import { dinheiro, renderCartaoRico, renderMensagemCartoes } from "../../../web/telas/cartoes-ricos.ts";

describe("cartões ricos na conversa (ADR-175)", () => {
  it("voo: trecho, horário, preço em reais e o link", () => {
    const html = renderCartaoRico({ tipo: "voo", companhia: "Aérea", numero: "AT 1", origem: "GRU", destino: "SDU", partida: "2026-12-01T07:10", chegada: "2026-12-01T08:25", paradas: 0, preco: { centavos: 48900, moeda: "BRL" }, link: "https://exemplo.com/v" });
    expect(html).toContain("GRU → SDU");
    expect(html).toContain("07:10 – 08:25");
    expect(html).toContain("R$ 489,00");
    expect(html).toContain("direto");
    expect(html).toContain('href="https://exemplo.com/v" target="_blank" rel="noopener noreferrer"');
  });

  it("mapa desenhado sem tiles, com o link para o Mapas por ponto; tudo escapado", () => {
    const html = renderCartaoRico({ tipo: "mapa", titulo: "<b>Jantar</b>", pontos: [{ nome: "Bar & Cia", lat: -23.5, lng: -46.6 }, { nome: "B", lat: -23.6, lng: -46.7 }] });
    expect(html).toContain("&lt;b&gt;Jantar&lt;/b&gt;");
    expect(html).toContain('class="rc-mapa-desenho"');
    expect(html).toContain("maps.apple.com/?ll=-23.500000,-46.600000&amp;q=Bar%20%26%20Cia");
    expect(html).not.toMatch(/<img|tile/);
  });

  it("carrinho esperando a passkey diz isso; dinheiro em BRL e em outra moeda", () => {
    const html = renderCartaoRico({ tipo: "carrinho", itens: [{ nome: "Café", quantidade: 2, unitario: { centavos: 8990, moeda: "BRL" } }], total: { centavos: 17980, moeda: "BRL" }, estado: "aguardando_passkey" });
    expect(html).toContain("2× Café");
    expect(html).toContain("R$ 179,80");
    expect(html).toContain("Esperando sua passkey no Mac");
    expect(dinheiro({ centavos: 123456, moeda: "BRL" })).toBe("R$ 1.234,56");
    expect(dinheiro({ centavos: 1200, moeda: "USD" })).toBe("USD 12,00");
  });

  it("a fala: resumo da primeira linha e a marca de não confiável", () => {
    const html = renderMensagemCartoes({ texto: "Achei dois.\n- Voo …", confianca: "nao_confiavel" }, { kind: "cartoes", cartoes: [{ tipo: "arquivo", formato: "pdf", nome: "Contrato.pdf", paginas: 3 }] });
    expect(html).toContain('<p class="rc-resumo">Achei dois.');
    expect(html).toContain("não confiável");
    expect(html).toContain("PDF · 3 páginas");
  });
});

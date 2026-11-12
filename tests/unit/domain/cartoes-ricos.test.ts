import { describe, expect, it } from "vitest";
import { linkSeguro, normalizarCartoes, textoDosCartoes } from "../../../src/domain/cartoes-ricos.ts";

const voo = { tipo: "voo", companhia: "Aérea", numero: "AT 1", origem: "GRU", destino: "SDU", partida: "2026-12-01T07:10", chegada: "2026-12-01T08:25", paradas: 0, preco: { centavos: 48900, moeda: "BRL" }, link: "https://exemplo.com/voo?id=1" };

describe("cartões ricos (ADR-175)", () => {
  it("normaliza os sete tipos e monta o texto de quem não desenha cartão", () => {
    const r = normalizarCartoes({
      resumo: "Achei isto.",
      cartoes: [
        voo,
        { tipo: "hotel", nome: "Hotel", endereco: "Rua 1", entrada: "2026-12-01", saida: "2026-12-03", nota: 8.7, diaria: { centavos: 42000, moeda: "BRL" } },
        { tipo: "carro", locadora: "L", modelo: "Compacto", local: "GRU", retirada: "2026-12-01", devolucao: "2026-12-03" },
        { tipo: "mapa", titulo: "Jantar", pontos: [{ nome: "A", lat: -23.5, lng: -46.6 }] },
        { tipo: "clima", local: "Rio", dias: [{ data: "2026-12-01", minimaC: 21, maximaC: 30, chuvaPct: 40, resumo: "Sol" }] },
        { tipo: "carrinho", itens: [{ nome: "Café", quantidade: 2, unitario: { centavos: 8990, moeda: "BRL" } }], total: { centavos: 17980, moeda: "BRL" }, estado: "aguardando_passkey" },
        { tipo: "arquivo", formato: "planilha", nome: "Vendas.xlsx", previa: [["Mês", "Total"], ["Out", 10]] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.cartoes.map((c) => c.tipo)).toEqual(["voo", "hotel", "carro", "mapa", "clima", "carrinho", "arquivo"]);
    const t = textoDosCartoes(r.valor.resumo, r.valor.cartoes);
    expect(t.split("\n")[0]).toBe("Achei isto.");
    expect(t).toContain("Voo Aérea AT 1: GRU → SDU, 2026-12-01 07:10, R$ 489,00");
    expect(t).toContain("Carrinho: 1 item, R$ 179,80");
  });

  it("link só https, sem usuário e sem caractere de tag; o link ruim cai em silêncio, o cartão fica", () => {
    expect(linkSeguro("https://a.com/x?y=1")).toBe("https://a.com/x?y=1");
    expect(linkSeguro("http://a.com")).toBeUndefined();
    expect(linkSeguro("javascript:alert(1)")).toBeUndefined();
    expect(linkSeguro("https://user:senha@a.com")).toBeUndefined();
    expect(linkSeguro('https://a.com/"><script>')).toBeUndefined();
    const r = normalizarCartoes({ resumo: "x", cartoes: [{ ...voo, link: "javascript:alert(1)" }] });
    expect(r.ok && r.valor.cartoes[0] && "link" in r.valor.cartoes[0]).toBe(false);
  });

  it("o que está errado volta como frase para corrigir", () => {
    const sem = normalizarCartoes({ resumo: "x", cartoes: [{ ...voo, partida: "amanhã" }] });
    expect(sem.ok ? "" : sem.motivo).toContain("cartoes[0]: partida tem de ser AAAA-MM-DDTHH:MM");
    const tipo = normalizarCartoes({ resumo: "x", cartoes: [{ tipo: "ingresso" }] });
    expect(tipo.ok ? "" : tipo.motivo).toContain("tipo é voo, hotel");
    const lat = normalizarCartoes({ resumo: "x", cartoes: [{ tipo: "mapa", titulo: "m", pontos: [{ nome: "a", lat: 91, lng: 0 }] }] });
    expect(lat.ok).toBe(false);
    expect(normalizarCartoes({ resumo: "", cartoes: [voo] }).ok).toBe(false);
    expect(normalizarCartoes({ resumo: "x", cartoes: Array.from({ length: 11 }, () => voo) }).ok).toBe(false);
  });

  it("texto longo e invisíveis saem limpos", () => {
    const r = normalizarCartoes({ resumo: "x", cartoes: [{ ...voo, companhia: `A‮${"b".repeat(300)}` }] });
    expect(r.ok && r.valor.cartoes[0]?.tipo === "voo" && r.valor.cartoes[0].companhia.length).toBe(120);
  });
});

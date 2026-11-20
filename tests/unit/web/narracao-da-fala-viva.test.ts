import { describe, expect, it } from "vitest";
import { separarNarracao, type Pensar } from "../../../web/telas/conversa.ts";

// Casca, rodada 4 (Paper 05b): a narração de abertura do turno vivo vem antes do pensamento ("Vou rodar só os testes…",
// e só então o cabeçalho e os passos). Só as notas antes da primeira ação saem; as do meio ficam na ordem, no pensamento.
const base = (itens: Pensar["itens"]): Pensar => ({ turnoId: "t1", fase: "fazendo", cabecalho: { id: "x", texto: "Rodando no terminal" }, anuncio: "", desde: 0, contagem: { acoes: 2, falhas: 0 }, itens, tarefas: [] });
const grupo = (rotulo: string) => ({ tipo: "grupo", rotulo, vezes: 1, falhas: 0, rodando: false }) as unknown as Pensar["itens"][number];
const nota = (texto: string) => ({ tipo: "nota", texto }) as Pensar["itens"][number];

describe("separarNarracao (Paper 05b)", () => {
  it("as notas antes da primeira ação viram a narração; o resto fica no pensamento, na ordem", () => {
    const r = separarNarracao(base([nota("Vou rodar só os testes do quadro."), grupo("Leu um arquivo"), nota("Agora o terminal."), grupo("Rodou um comando")]));
    expect(r.narracao).toEqual(["Vou rodar só os testes do quadro."]);
    expect(r.pensar.itens.map((i) => i.tipo)).toEqual(["grupo", "nota", "grupo"]);
  });
  it("sem nota no começo, nada sai (o mesmo objeto)", () => {
    const p = base([grupo("Leu um arquivo"), nota("Depois.")]);
    const r = separarNarracao(p);
    expect(r.narracao).toEqual([]);
    expect(r.pensar).toBe(p);
  });
  it("só notas: todas viram narração", () => {
    expect(separarNarracao(base([nota("a"), nota("b")])).narracao).toEqual(["a", "b"]);
  });
});

import { describe, expect, it } from "vitest";
import { destinoAoExcluirRotina } from "../../../web/telas/agenda-rotinas.ts";

// QA r235: o Excluir da tela de Rotinas (PR #333) deixava o foco no <body> ao cancelar e ao excluir.
const raiz = (ids: string[]) => ({ querySelectorAll: () => ids.map((id) => ({ getAttribute: () => id })) });
const NOVA = '#espaco [data-act="navegar"][data-tela="nova-rotina"]';
const linha = (id: string) => `#espaco [data-act="agenda-linha"][data-id="${id}"]`;

describe("destino do foco ao excluir uma rotina pela tela (QA r235)", () => {
  it("a linha seguinte; na última, a anterior; sozinha, o Nova rotina", () => {
    expect(destinoAoExcluirRotina(raiz(["a", "b", "c"]), "b")).toBe(linha("c"));
    expect(destinoAoExcluirRotina(raiz(["a", "b", "c"]), "c")).toBe(linha("b"));
    expect(destinoAoExcluirRotina(raiz(["a"]), "a")).toBe(NOVA);
  });
  it("id repetido (lista + pausadas) conta uma vez; id fora da lista vai ao Nova rotina", () => {
    expect(destinoAoExcluirRotina(raiz(["a", "a", "b"]), "a")).toBe(linha("b"));
    expect(destinoAoExcluirRotina(raiz(["a", "b"]), "z")).toBe(NOVA);
  });
});

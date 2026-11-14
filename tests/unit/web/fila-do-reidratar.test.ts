import { describe, expect, it } from "vitest";
import { comAbertaNaFrente } from "../../../web/lib/fila-do-reidratar.ts";

/** C5 (definido em 2026-11-12): a conversa aberta é a primeira leitura da passada do reidratar, não a última. */
describe("comAbertaNaFrente (C5)", () => {
  it("a conversa aberta vai para a frente; o resto mantém a ordem", () => {
    expect(comAbertaNaFrente(["frota", "sua-vez", "conversa:b", "trabalhos", "conversa:a"], "a")).toEqual(["conversa:a", "frota", "sua-vez", "conversa:b", "trabalhos"]);
  });
  it("sem a conversa aberta na fila (ou sem conversa aberta), nada muda", () => {
    expect(comAbertaNaFrente(["frota", "conversa:b"], "a")).toEqual(["frota", "conversa:b"]);
    expect(comAbertaNaFrente(["frota", "conversa:b"], null)).toEqual(["frota", "conversa:b"]);
    expect(comAbertaNaFrente(["conversa:a", "frota"], "a")).toEqual(["conversa:a", "frota"]);
  });
});

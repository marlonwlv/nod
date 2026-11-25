import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { comPedidosDoNavegadorDepoisDaFala } from "../../../web/telas/linhas-do-chat.ts";
import { pedidoDoNavegadorNaFala } from "../../../web/lib/navegador-cartoes.ts";

/** Ponto 06 dos cenários de 2026-11-22: o cartão do pedido do navegador vai para baixo da fala do turno. */
const msg = (id: string, o: Partial<Mensagem> & { autor?: "pessoa" | "agente" }): Mensagem => ({
  id, conversaId: "c", turnoId: "t1", kind: "texto", texto: "", criadoEm: 1_000, confianca: "confiavel", payload: null,
  autoria: { autor_tipo: o.autor ?? "agente", autor_id: "a" }, ...o,
} as Mensagem);
const pedido = msg("p", { texto: "Preciso de você no meu navegador: google.com pede para provar que é gente (CAPTCHA).", payload: { kind: "pedido_a_pessoa", decisaoId: "d" } });
const eh = (m: Mensagem) => pedidoDoNavegadorNaFala(m.texto) !== null;
const ids = (l: readonly Mensagem[]) => l.map((m) => m.id);

describe("o pedido do navegador embaixo da fala", () => {
  it("vai para depois da última fala do mesmo turno", () => {
    const lista = [msg("eu", { autor: "pessoa", turnoId: null }), pedido, msg("fala", { texto: "Abri a página e ela pede um CAPTCHA." })];
    expect(ids(comPedidosDoNavegadorDepoisDaFala(lista, new Set(), eh))).toEqual(["eu", "fala", "p"]);
  });

  it("com o turno vivo e sem fala depois, fica segurado; sem turno vivo, fica onde está", () => {
    const lista = [msg("eu", { autor: "pessoa", turnoId: null }), pedido];
    expect(ids(comPedidosDoNavegadorDepoisDaFala(lista, new Set(["t1"]), eh))).toEqual(["eu"]);
    expect(comPedidosDoNavegadorDepoisDaFala(lista, new Set(), eh)).toBe(lista);
  });

  it("a fala de outro turno e a pergunta comum não mexem em nada", () => {
    const comum = msg("q", { texto: "Qual cor você prefere?", payload: { kind: "pedido_a_pessoa", decisaoId: "d2" } });
    const lista = [pedido, msg("outra", { turnoId: "t2", texto: "oi" }), comum, msg("fala2", {})];
    expect(ids(comPedidosDoNavegadorDepoisDaFala(lista, new Set(), eh))).toEqual(["outra", "q", "fala2", "p"]);
  });
});

import { describe, expect, it } from "vitest";
import { ehFalhaDeConexaoComOBanco, ouvirRejeicoesSemDono } from "../../../src/adapters/http/server.ts";
import { ErroBancoOcupado } from "../../../src/db/tx.ts";

/** Ponto 04 dos cenários de 2026-11-22: o banco que demora não derruba o servidor; o defeito continua derrubando. */
describe("rejeição sem dono", () => {
  it("reconhece a falha de conexão com o banco (driver, pool e o prazo do nod)", () => {
    expect(ehFalhaDeConexaoComOBanco(Object.assign(new Error("write CONNECT_TIMEOUT 127.0.0.1:5449"), { code: "CONNECT_TIMEOUT" }))).toBe(true);
    expect(ehFalhaDeConexaoComOBanco(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(ehFalhaDeConexaoComOBanco(new ErroBancoOcupado("c", 5000))).toBe(true);
    expect(ehFalhaDeConexaoComOBanco(Object.assign(new Error("x"), { code: "23505" }))).toBe(false);
    expect(ehFalhaDeConexaoComOBanco(new TypeError("x is undefined"))).toBe(false);
    expect(ehFalhaDeConexaoComOBanco(null)).toBe(false);
  });

  it("a falha de conexão vira aviso; o resto vai para quem derruba o processo", () => {
    const derrubou: unknown[] = [];
    const tirar = ouvirRejeicoesSemDono((e) => derrubou.push(e));
    try {
      const conexao = Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" });
      const defeito = new TypeError("x is undefined");
      process.emit("unhandledRejection", conexao, Promise.resolve());
      process.emit("unhandledRejection", defeito, Promise.resolve());
      expect(derrubou).toEqual([defeito]);
    } finally {
      tirar();
    }
  });
});

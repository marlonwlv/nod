import { afterEach, describe, expect, it, vi } from "vitest";

/** ADR-183: a leva de GETs de abrir um bot erra o cache da sessão ao mesmo tempo; a primeira consulta serve às outras. */
const sessaoViva = vi.fn();
const tocarSessao = vi.fn();
vi.mock("../../../src/repositories/contas.repo.ts", () => ({
  sessaoViva: (...a: unknown[]) => sessaoViva(...a),
  tocarSessao: (...a: unknown[]) => tocarSessao(...a),
  corteDaPessoa: vi.fn(async () => null),
  pessoaExiste: vi.fn(async () => true),
  criarSessaoConta: vi.fn(),
  revogarOutrasSessoes: vi.fn(),
  revogarSessao: vi.fn(),
}));
const { criarGuardaSessao, TOCAR_A_CADA_MS } = await import("../../../src/adapters/http/sessao-revogavel.ts");

const escopo = { tenantId: "t1", pessoaId: "p1" };
const db = {} as never;

afterEach(() => { sessaoViva.mockReset(); tocarSessao.mockReset(); });

describe("guarda da sessão: promessa em voo (ADR-183)", () => {
  it("quinze conferências simultâneas do mesmo cookie fazem UMA consulta e todas recebem a resposta", async () => {
    let soltar: ((v: { ultimoUsoEm: number } | null) => void) | null = null;
    sessaoViva.mockImplementation(() => new Promise((r) => { soltar = r; }));
    let agora = 1_000_000;
    const guarda = criarGuardaSessao(db, () => agora);
    const pedidos = Array.from({ length: 15 }, () => guarda.conferir(escopo, "sid-1"));
    expect(sessaoViva).toHaveBeenCalledTimes(1);
    soltar!({ ultimoUsoEm: agora });
    expect(await Promise.all(pedidos)).toEqual(Array.from({ length: 15 }, () => true));
    // Dentro do cache de 3 s, nada vai ao banco; depois, uma consulta nova.
    agora += 1_000;
    sessaoViva.mockResolvedValue({ ultimoUsoEm: agora });
    expect(await guarda.conferir(escopo, "sid-1")).toBe(true);
    expect(sessaoViva).toHaveBeenCalledTimes(1);
    agora += 3_000;
    expect(await guarda.conferir(escopo, "sid-1")).toBe(true);
    expect(sessaoViva).toHaveBeenCalledTimes(2);
  });

  it("o carimbo de uso (tocarSessao) sai sem segurar o pedido, e a falha dele não derruba a sessão", async () => {
    const agora = 10_000_000;
    sessaoViva.mockResolvedValue({ ultimoUsoEm: agora - TOCAR_A_CADA_MS - 1 });
    let falhou: (() => void) | null = null;
    tocarSessao.mockImplementation(() => new Promise((_r, rej) => { falhou = () => rej(new Error("banco")); }));
    const guarda = criarGuardaSessao(db, () => agora);
    expect(await guarda.conferir(escopo, "sid-2")).toBe(true);
    expect(tocarSessao).toHaveBeenCalledTimes(1);
    falhou!();
    await new Promise((r) => setTimeout(r, 0));
    expect(await guarda.conferir(escopo, "sid-2")).toBe(true);
  });

  it("a consulta que falha não fica no cache: o pedido seguinte consulta de novo", async () => {
    sessaoViva.mockRejectedValueOnce(new Error("banco fora")).mockResolvedValueOnce({ ultimoUsoEm: 5_000_000 });
    const guarda = criarGuardaSessao(db, () => 5_000_000);
    await expect(guarda.conferir(escopo, "sid-3")).rejects.toThrow("banco fora");
    await new Promise((r) => setTimeout(r, 0));
    expect(await guarda.conferir(escopo, "sid-3")).toBe(true);
    expect(sessaoViva).toHaveBeenCalledTimes(2);
  });
});

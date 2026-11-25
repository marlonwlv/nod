import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { iniciarVarredorNavegadores } from "../../../src/adapters/fundo/varredor-navegadores.ts";

/** ADR-190 (D0): o laço que pausa os Chromes ociosos — uma volta por intervalo, nunca duas ao mesmo tempo, e o parar espera a volta em voo. */
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("chama pausarOciosos a cada volta, sem sobrepor, e o parar espera a que está em voo", async () => {
  let voltas = 0;
  let soltar: (() => void) | null = null;
  const laco = iniciarVarredorNavegadores({ intervaloMs: 1_000, navegadores: { pausarOciosos: () => { voltas++; return new Promise<number>((r) => { soltar = () => r(1); }); } } });
  await vi.advanceTimersByTimeAsync(1_000);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(voltas).toBe(1);
  let parou = false;
  const parando = laco.parar().then(() => { parou = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(parou).toBe(false);
  soltar!();
  await parando;
  expect(parou).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(voltas).toBe(1);
});

import { AsyncLocalStorage } from "node:async_hooks";
import type { Rastro } from "../domain/traceparent.ts";

/**
 * ADR-171: o `traceparent` do pedido que está sendo atendido (a borda o lê do header), à parte do `Contexto` do log (que
 * nasce na transação): todo log dentro do pedido ganha `trace_id` e `span_pai`.
 */
const armazem = new AsyncLocalStorage<Rastro>();

export function comRastro<T>(r: Rastro | null, fn: () => Promise<T>): Promise<T> {
  return r ? armazem.run(r, fn) : fn();
}

export function rastroAtual(): Rastro | undefined {
  return armazem.getStore();
}

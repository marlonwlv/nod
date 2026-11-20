import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Loja } from "./loja.ts";

/**
 * ADR-179: lê um pedaço da loja do reducer. O componente só redesenha quando o pedaço que o seletor devolve muda
 * (por `igual`, padrão Object.is) — um frame do SSE que mexe em outra conversa não redesenha esta região.
 *
 * O seletor pode devolver um objeto novo a cada chamada (ex.: `{ a: e.a, b: e.b }`) desde que se passe um `igual`
 * raso (`igualRaso`): o último valor aceito fica guardado e é devolvido enquanto for igual, o que mantém o snapshot
 * estável (sem isso o useSyncExternalStore entra em laço).
 */
export function useLoja<T, S>(loja: Loja<T>, seletor: (estado: T) => S, igual: (a: S, b: S) => boolean = Object.is): S {
  const memo = useRef<{ estado: T; valor: S } | null>(null);
  const ler = useCallback(() => {
    const estado = loja.ler();
    const anterior = memo.current;
    if (anterior && Object.is(anterior.estado, estado)) return anterior.valor;
    const valor = seletor(estado);
    if (anterior && igual(anterior.valor, valor)) {
      memo.current = { estado, valor: anterior.valor };
      return anterior.valor;
    }
    memo.current = { estado, valor };
    return valor;
    // O seletor e o igual costumam ser funções inline: trocá-los não deve reassinar a loja nem recalcular à toa.
  }, [loja]);
  return useSyncExternalStore(loja.assinar, ler, ler);
}

/** Igualdade rasa para seletores que montam um objeto ou uma lista com pedaços do estado. */
export function igualRaso<S>(a: S, b: S): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

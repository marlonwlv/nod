/**
 * ADR-179 (fase 1 do React): a ponte entre o estado do reducer e o React, sem reescrever o reducer.
 *
 * O main.ts continua dono de `estado` (reduzir → render por regiões). A loja só sabe LER o estado atual e AVISAR quem
 * assina quando ele pode ter mudado; o `useLoja` (use-loja.ts) entrega isso ao `useSyncExternalStore`. Este arquivo
 * não importa React: entra no bundle do main.ts sem trazer a biblioteca junto.
 */
export type Loja<T> = {
  /** O estado atual (o mesmo objeto enquanto o reducer não devolver outro). */
  ler: () => T;
  /** Assina mudanças; devolve a função que cancela. Formato do `subscribe` do useSyncExternalStore. */
  assinar: (ouvinte: () => void) => () => void;
  /** Chamado por quem é dono do estado depois de trocá-lo. Só avisa se o objeto mudou de fato. */
  avisar: () => void;
};

export function criarLoja<T>(ler: () => T): Loja<T> {
  const ouvintes = new Set<() => void>();
  let ultimo = ler();
  return {
    ler,
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    avisar() {
      const atual = ler();
      if (Object.is(atual, ultimo)) return;
      ultimo = atual;
      for (const ouvinte of [...ouvintes]) ouvinte();
    },
  };
}

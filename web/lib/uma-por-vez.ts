/**
 * Impede que a mesma mutação seja iniciada outra vez enquanto a anterior ainda não terminou.
 * O portão abre também depois de falha, para a pessoa poder tentar novamente.
 */
export function umaPorVez<T extends readonly unknown[]>(fn: (...args: T) => Promise<void>): (...args: T) => Promise<boolean> {
  let ocupada = false;
  return async (...args: T): Promise<boolean> => {
    if (ocupada) return false;
    ocupada = true;
    try {
      await fn(...args);
      return true;
    } finally {
      ocupada = false;
    }
  };
}

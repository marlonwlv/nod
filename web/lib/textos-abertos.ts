/**
 * Validação de 2026-11-16 (ADR-185): o texto que a pessoa parou no meio fica recolhido (as primeiras linhas e "Mostrar o
 * texto todo"), para a resposta que veio depois ter o destaque. Só o interrompido: resposta completa e longa segue inteira.
 * Quais ela abriu fica na memória da aba (some ao recarregar, e o texto volta recolhido).
 */
const abertos = new Set<string>();

export function textoAberto(mensagemId: string): boolean {
  return abertos.has(mensagemId);
}

/** Abre ou fecha; devolve o estado novo. */
export function alternarTexto(mensagemId: string): boolean {
  if (abertos.has(mensagemId)) abertos.delete(mensagemId);
  else abertos.add(mensagemId);
  return abertos.has(mensagemId);
}

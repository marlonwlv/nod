/**
 * Validação de 2026-11-16 (ADR-185): o texto que a pessoa parou no meio fica recolhido (as primeiras linhas e "Mostrar o
 * texto todo"), para a resposta que veio depois ter o destaque. Só o interrompido: resposta completa e longa segue inteira.
 * Quais ela abriu fica na memória da aba (some ao recarregar, e o texto volta recolhido).
 */
const abertos = new Set<string>();
/** Sobe a cada clique: o histórico da timeline é memorizado (main.ts, `lembrar`) e esta versão entra nas dependências. */
let versao = 0;

export function versaoDosTextos(): number {
  return versao;
}

export function textoAberto(mensagemId: string): boolean {
  return abertos.has(mensagemId);
}

/** Abre ou fecha; devolve o estado novo. */
export function alternarTexto(mensagemId: string): boolean {
  if (abertos.has(mensagemId)) abertos.delete(mensagemId);
  else abertos.add(mensagemId);
  versao += 1;
  return abertos.has(mensagemId);
}

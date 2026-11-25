/**
 * ADR-180 (fase 2 do React): a chave da grade do quadro em React. LIGADA por padrão desde a fase 5 da ADR-179 (a régua e
 * as jornadas por ponteiro aprovaram; quadro-grade-react-chrome.test.ts). `?quadro-react=0` na URL desliga neste
 * navegador (fica guardado) e a grade volta à por string; `?quadro-react=1` liga de novo. Desligada, o módulo React do
 * quadro nem é baixado (import dinâmico no quadro-na-tela). Quem lê é o main (`criarQuadroNaTela({ gradeReact })`).
 */
export const CHAVE_REACT_NO_QUADRO = "nod.quadro.react";

export function reactNoQuadro(url: string, guardado: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): boolean {
  let pedido: string | null = null;
  try {
    pedido = new URL(url).searchParams.get("quadro-react");
  } catch {
    // URL estranha: vale o guardado
  }
  try {
    if (pedido === "0") guardado?.setItem(CHAVE_REACT_NO_QUADRO, "0");
    else if (pedido === "1") guardado?.removeItem(CHAVE_REACT_NO_QUADRO);
    if (pedido === "0" || pedido === "1") return pedido === "1";
    return guardado?.getItem(CHAVE_REACT_NO_QUADRO) !== "0";
  } catch {
    // localStorage bloqueado: só a URL decide
    return pedido !== "0";
  }
}

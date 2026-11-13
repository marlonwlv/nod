/**
 * ADR-180 (fase 2 do React): a chave da grade do quadro em React. Desligada por padrão: o quadro segue por string até a
 * régua e o teste de mão aprovarem. Liga com `?quadro-react=1` na URL (fica guardado neste navegador) e desliga com
 * `?quadro-react=0`. Sem a chave, o módulo React do quadro nem é baixado (import dinâmico no quadro-na-tela).
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
    if (pedido === "1") guardado?.setItem(CHAVE_REACT_NO_QUADRO, "1");
    else if (pedido === "0") guardado?.removeItem(CHAVE_REACT_NO_QUADRO);
    return pedido === "1" || (pedido !== "0" && guardado?.getItem(CHAVE_REACT_NO_QUADRO) === "1");
  } catch {
    // localStorage bloqueado: só a URL decide
    return pedido === "1";
  }
}

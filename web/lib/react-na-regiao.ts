/**
 * ADR-189: a chave de cada região que o React desenha pelo HTML das telas (a barra lateral, a conversa, o cabeçalho, o
 * painel do bot e Seu espaço), das telas no lugar da conversa já em componentes (`telas`, ADR-179) e das peças do campo
 * de mensagem já em componentes (`composer`: a fila de anexos e o topo) e dos diálogos criados por código (`dialogos`: o de
 * handoff do Quadro, pelo Dialog do Base UI). LIGADA por padrão;
 * `?<nome>-react=0` na URL desliga neste navegador (fica guardado) e `?<nome>-react=1` liga de novo. É o caminho de volta
 * da ADR-179 ("a região volta ao desenho por string"), sem deploy: desligada, a região segue por `regiao()` como antes e o
 * módulo React nem é baixado.
 */
export type RegiaoReact = "barra" | "conversa" | "cabecalho" | "detalhes" | "espaco" | "telas" | "composer" | "dialogos" | "ligacao" | "janelas";

export const chaveGuardada = (nome: RegiaoReact): string => `nod.${nome}.react`;

export function reactNaRegiao(nome: RegiaoReact, url: string, guardado: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): boolean {
  let pedido: string | null = null;
  try {
    pedido = new URL(url).searchParams.get(`${nome}-react`);
  } catch {
    // URL estranha: vale o guardado
  }
  try {
    if (pedido === "0") guardado?.setItem(chaveGuardada(nome), "0");
    else if (pedido === "1") guardado?.removeItem(chaveGuardada(nome));
    if (pedido === "0" || pedido === "1") return pedido === "1";
    return guardado?.getItem(chaveGuardada(nome)) !== "0";
  } catch {
    // localStorage bloqueado: só a URL decide
    return pedido !== "0";
  }
}

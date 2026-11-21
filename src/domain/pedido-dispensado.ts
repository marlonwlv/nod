import { PREFIXO_PEDIDO_DE_TELA, SUFIXO_PEDIDO_DE_TELA } from "./computador.ts";

/**
 * O pedido que a pessoa deixou para trás ao seguir conversando (definido em 2026-11-20, ADR-191, pedido do dono; referência:
 * o app de referência marca "Dismissed" o cartão esquecido quando a pessoa manda mensagem nova). Aqui só o que é texto e
 * não depende de banco: a frase curta do pedido e a linha fixa que o bot lê no turno seguinte.
 */

/** definido em 2026-11-20: a frase curta cabe numa linha da conversa e no histórico; o resto do pedido já está na fala do bot. */
export const FRASE_CURTA_MAX = 160;

/**
 * A frase curta do pedido. O pedido de ajuda do computador guarda a frase inteira do molde ("Abra meu computador para
 * concluir este passo: entrar no Drive. Abra a tela…"): fica só o motivo, que é o que o bot pediu. Espaços repetidos saem
 * e o que passa do teto vira reticências.
 */
export function fraseCurtaDoPedido(frase: string): string {
  let t = frase.replace(/\s+/gu, " ").trim();
  if (t.startsWith(PREFIXO_PEDIDO_DE_TELA.trim())) t = t.slice(PREFIXO_PEDIDO_DE_TELA.trim().length).trim();
  const sufixo = SUFIXO_PEDIDO_DE_TELA.trim();
  if (t.endsWith(sufixo)) t = t.slice(0, -sufixo.length).trim();
  t = t.replace(/[.\s]+$/u, "");
  if ([...t].length <= FRASE_CURTA_MAX) return t;
  return `${[...t].slice(0, FRASE_CURTA_MAX - 1).join("").trimEnd()}…`;
}

/**
 * A linha fixa que o bot lê (ADR-191, decisão B): a mensagem `sistema` com payload `pedido_dispensado` entra no histórico do
 * turno seguinte (ou no "desde a sua última vez", com a sessão retomada), antes da fala nova. Nunca cita a fala da pessoa
 * nem pede nada: diz o que houve (nada foi feito) e o que fazer (seguir com a mensagem nova, sem repetir o pedido agora).
 */
export function linhaDoPedidoDispensado(fraseCurta: string): string {
  return `A pessoa seguiu sem responder ao seu pedido: ${fraseCurta}. Nada foi feito com ele. Não peça de novo agora: siga com a mensagem nova e só volte ao pedido se ela pedir.`;
}

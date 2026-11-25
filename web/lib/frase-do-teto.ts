import { ErroApi } from "./erro-api.ts";

/**
 * QA-169: o `limite_atingido` da tabela de erros diz "Espere um pouco e tente de novo", que serve para limite de taxa.
 * Nos tetos de quantidade (tokens MCP vivos, rotinas por bot) esperar não adianta: a frase diz o que liberar.
 */
export const FRASE_TETO_TOKENS_MCP = "Você já tem 20 tokens MCP ativos. Revogue um que não usa mais e gere de novo.";
export const FRASE_TETO_ROTINAS = "Este bot já tem 50 rotinas. Exclua uma que não usa mais para criar outra.";

/** O mesmo erro com a frase do teto quando é `limite_atingido`; qualquer outro volta como veio. */
export function comFraseDoTeto(e: unknown, frase: string): unknown {
  if (!(e instanceof ErroApi) || e.codigo !== "limite_atingido") return e;
  const novo = new ErroApi(e.status, e.codigo, frase, e.correlationId, e.rota);
  novo.motivo = e.motivo;
  return novo;
}

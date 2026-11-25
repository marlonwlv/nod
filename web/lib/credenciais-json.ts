/**
 * QA-150: o campo de credenciais de um MCP próprio (Registrar e Atualizar credenciais) recebe um objeto JSON. Texto que
 * não é JSON, ou é JSON mas não é objeto (lista, texto, número, null), devolve `null` para a tela dizer o que corrigir; o
 * `JSON.parse` solto do Registrar caía no "Algo deu errado nesta tela" e virava relato de bug da tela.
 * Vazio vale `{}` quando o campo é opcional (Registrar) e é inválido quando é obrigatório (Atualizar credenciais).
 */
export const FRASE_CREDENCIAIS_INVALIDAS = "Informe as credenciais como um objeto JSON válido.";

export function lerCredenciaisJson(texto: string, vazio: "vale-vazio" | "obrigatorio"): Record<string, string> | null {
  const t = texto.trim();
  if (!t) return vazio === "vale-vazio" ? {} : null;
  let v: unknown;
  try { v = JSON.parse(t); } catch { return null; }
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, string>) : null;
}

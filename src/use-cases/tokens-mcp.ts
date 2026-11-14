import type { TokenMcpDto } from "../contracts/mcp.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { cunharTokenMcp } from "../services/token-mcp.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O nome para a pessoa reconhecer o cliente na lista ("Assistente no WhatsApp", "Claude Desktop"). */
const NOME_MAX = 60;
/** Um teto para a pessoa (e um token vazado) não encher a tabela; quem precisa de mais revoga os que não usa. */
export const TOKENS_MCP_VIVOS_MAX = 20;

/**
 * Gera um token do servidor MCP (0173). O token cru nasce aqui e sai SÓ no `data` desta resposta: o banco recebe o hash,
 * o log não recebe nada. Gerar de novo não cancela os anteriores; quem quer trocar revoga o velho.
 */
export const emitirTokenMcp: CasoDeUso<{ nome: unknown }, { token: string; dados: TokenMcpDto }> = async (deps, input) => {
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  if (nome.length === 0 || nome.length > NOME_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "nome do token MCP" });
  const vivos = (await deps.repos.mcpTokens.listar()).filter((t) => t.revogadoEm === null).length;
  if (vivos >= TOKENS_MCP_VIVOS_MAX) throw new ErroDeDominio("limite_atingido", { cause: "tokens MCP vivos" });
  const cunhado = cunharTokenMcp(deps.escopo);
  const dados = await deps.repos.mcpTokens.criar({ nome, prefixo: cunhado.prefixo, hash: cunhado.hash });
  if (!dados) throw new ErroDeDominio("estado_invalido", { cause: "token MCP não gravado" });
  return { data: { token: cunhado.chave, dados } };
};

/** Revoga um token da própria pessoa; o próximo pedido do cliente com ele já cai em 401. O de outra pessoa é 404. */
export const revogarTokenMcp: CasoDeUso<{ id: string }, { ok: true }> = async (deps, input) => {
  if (!(await deps.repos.mcpTokens.revogar(input.id, deps.agora()))) throw new ErroDeDominio("nao_encontrado", { cause: "token MCP" });
  return { data: { ok: true } };
};

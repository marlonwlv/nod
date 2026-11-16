import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * Servidor MCP do Nod (0173): o token que um cliente MCP de fora usa para pilotar o Nod em nome da pessoa. Gerar nunca
 * passa pelo chat (o token cru é segredo e sai uma vez, como a chave de máquina); revogar fica para a Onda 3 (conta e
 * segurança), como a revogação da chave de máquina.
 */
export const ACOES_MCP = [
  { id: "mcp.criar_token", titulo: "Gerar um token para conectar um cliente MCP", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "o token cru sai uma vez e é segredo: não pode ir para a conversa" } },
  { id: "mcp.revogar_token", titulo: "Revogar um token de cliente MCP", risco: "arriscada", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-395" } },
] as const satisfies readonly DefinicaoAcao[];

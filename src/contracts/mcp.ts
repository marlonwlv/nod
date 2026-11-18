import type { EpochMs } from "./ids.ts";

/**
 * Servidor MCP do Nod (0173): o token que um cliente MCP de fora usa no endpoint /api/mcp. A lista nunca traz o token;
 * `cliente` é o nome que o cliente anunciou no último uso (clientInfo.name do initialize), null = ainda não usado.
 */
export type TokenMcpDto = { id: string; nome: string; prefixo: string; cliente: string | null; criadoEm: EpochMs; ultimoUsoEm: EpochMs | null; revogadoEm: EpochMs | null };

/** Resposta da emissão: o token cru aparece AQUI e em mais lugar nenhum. `endpoint`: o endereço a colar no cliente. */
export type TokenMcpEmitidoDto = { token: string; dados: TokenMcpDto; endpoint: string };

/** GET mcp/tokens: os tokens da pessoa e o endpoint deste servidor. */
export type TokensMcpDto = { tokens: TokenMcpDto[]; endpoint: string };

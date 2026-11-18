import { abrirTxEscopada } from "../../db/tx.ts";
import { mcpTokensRepo } from "../../repositories/mcp-tokens.repo.ts";
import { escopoAlegadoMcp, hashDoTokenMcp } from "../../services/token-mcp.ts";
import { casaHash } from "../../services/token-maquina.ts";
import type { Db, Escopo } from "../../shared/types.ts";

export type IdentidadeMcp = Escopo & { tokenId: string };

/**
 * Valida o token do servidor MCP ANTES de existir sessão, como a chave de máquina (autorizar-chave-maquina.ts, ADR-031):
 * o escopo alegado abre a tx escopada, o hash do token INTEIRO acha a linha viva, timingSafeEqual confirma. Revogado não
 * volta. `cliente` (o clientInfo.name do initialize) vai junto com a marca de uso.
 */
export async function autorizarTokenMcp(db: Db, token: unknown, agora: number, cliente: string | null = null): Promise<IdentidadeMcp | null> {
  const escopo = escopoAlegadoMcp(token);
  if (!escopo || typeof token !== "string") return null;
  const hash = hashDoTokenMcp(token);
  return abrirTxEscopada(db, escopo)(async (trx) => {
    const repo = mcpTokensRepo(trx, escopo);
    const achado = await repo.buscarVivoPorHash(hash);
    if (!achado || !casaHash(achado.hash, hash)) return null;
    await repo.marcarUso(achado.id, agora, cliente);
    return { ...escopo, tokenId: achado.id };
  });
}

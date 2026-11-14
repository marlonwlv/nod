import type { Escopo } from "../shared/types.ts";
import { cunharChaveMaquina, escopoAlegado as escopoDaChave, hashDaChave, type ChaveCunhada } from "./token-maquina.ts";

/**
 * Token do servidor MCP do Nod (0173). Puro: só criptografia, SEM banco (src/services).
 *
 *   token = "nod_mcp_" + base64url(JSON{t, p}) "." base64url(randomBytes(32))
 *
 * O mesmo desenho da chave de máquina (token-maquina.ts, ADR-031): o escopo viaja dentro do token só para dizer em que
 * tx procurar o hash, e o hash cobre o token INTEIRO (o prefixo junto). O prefixo `nod_mcp_` serve a quem lê o token num
 * arquivo de configuração e às varreduras de segredo; uma chave de máquina colada no lugar dele não passa (sem o prefixo),
 * e o token MCP colado como chave de máquina também não (o hash não está naquela tabela).
 */
export const PREFIXO_TOKEN_MCP = "nod_mcp_";

export function cunharTokenMcp(escopo: Escopo): ChaveCunhada {
  const base = cunharChaveMaquina(escopo);
  const chave = `${PREFIXO_TOKEN_MCP}${base.chave}`;
  return { chave, hash: hashDaChave(chave), prefixo: base.prefixo };
}

/** O escopo que o token DIZ ter. Não autoriza nada sozinho: só diz em qual escopo procurar o hash. */
export function escopoAlegadoMcp(token: unknown): Escopo | null {
  if (typeof token !== "string" || !token.startsWith(PREFIXO_TOKEN_MCP)) return null;
  return escopoDaChave(token.slice(PREFIXO_TOKEN_MCP.length));
}

export { hashDaChave as hashDoTokenMcp } from "./token-maquina.ts";

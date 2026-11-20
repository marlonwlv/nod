import type { CofreDto, CredencialNoCofre } from "../contracts/cofre.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O nome que a pessoa lê de cada alvo: a chave do conector, ou o nome fixo do token do GitHub e da chave do Composio. */
export function nomeDaCredencial(c: { alvo: string; chave: string | null }): string {
  if (c.chave) return c.chave;
  return c.alvo === "github_token" ? "Token do GitHub" : c.alvo === "composio" ? "Chave do Composio" : "Chave";
}

/**
 * GET /cofre (Paper 07, rodada 2): as credenciais guardadas pela pessoa, da mais nova para a mais velha, uma por (app,
 * nome). Lê só o que o cartão já tinha à vista (nome, app, data): o valor não está na consulta.
 */
export const listarCofre: CasoDeUso<Record<string, never>, CofreDto> = async (deps) => {
  const linhas = await deps.repos.propostas.credenciaisGuardadas();
  const vistas = new Set<string>();
  const credenciais: CredencialNoCofre[] = [];
  for (const l of [...linhas].sort((a, b) => b.guardadaEm - a.guardadaEm)) {
    const nome = nomeDaCredencial(l);
    const chave = `${l.app}\u0000${nome}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    credenciais.push({ nome, app: l.app, guardadaEm: l.guardadaEm });
  }
  return { data: { credenciais } };
};

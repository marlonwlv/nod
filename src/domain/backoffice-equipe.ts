/**
 * Quem entra no backoffice interno (definido em 2026-11-24, ADR-194). Puro: o servidor lê a linha da pessoa em
 * `equipe_backoffice`, se a tabela está vazia e o e-mail dela, e decide aqui. Nunca reaproveita papel de workspace.
 */
export type PapelBackoffice = "dono" | "leitura";

export const PAPEIS_BACKOFFICE: readonly PapelBackoffice[] = ["dono", "leitura"];

export type FatosEquipe = {
  /** O papel da pessoa em `equipe_backoffice`, ou null se ela não tem linha. */
  papel: PapelBackoffice | null;
  /** A tabela inteira está vazia? (bootstrap pelo NOD_ADMINS) */
  equipeVazia: boolean;
};

/** Quem está em NOD_ADMINS: o id ou o e-mail da pessoa (a lista já em minúsculas). Lista vazia = ninguém. */
export function estaNaLista(admins: readonly string[], pessoa: { id: string; email: string | null } | null): boolean {
  if (!pessoa || admins.length === 0) return false;
  if (admins.includes(pessoa.id.toLowerCase())) return true;
  const email = pessoa.email?.toLowerCase();
  return !!email && admins.includes(email);
}

/**
 * O papel da pessoa no backoffice. Com a tabela preenchida, só ela vale (NOD_ADMINS deixa de dar acesso); vazia, quem
 * está em NOD_ADMINS é dono — o bootstrap do primeiro deploy, para ninguém ficar trancado fora.
 */
export function papelNoBackoffice(f: FatosEquipe, admins: readonly string[], pessoa: { id: string; email: string | null } | null): PapelBackoffice | null {
  if (!f.equipeVazia) return f.papel;
  return estaNaLista(admins, pessoa) ? "dono" : null;
}

export function ehPapelBackoffice(v: unknown): v is PapelBackoffice {
  return v === "dono" || v === "leitura";
}

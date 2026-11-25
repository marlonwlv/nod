import { ehPapelBackoffice, type FatosEquipe } from "../domain/backoffice-equipe.ts";
import type { Conn, Escopo } from "../shared/types.ts";

/**
 * Backoffice interno (definido em 2026-11-24, ADR-194, migração 0184).
 *
 * `equipe_backoffice` é global (sem RLS, exceção em gate-rls.ts): a guarda lê pelo pool, antes de qualquer escopo, numa
 * consulta só — o papel da pessoa e se a tabela está vazia (o bootstrap pelo NOD_ADMINS).
 */
export async function fatosDaEquipe(conn: Conn, pessoa: Escopo): Promise<FatosEquipe> {
  const [linha] = await conn<{ papel: string | null; tem: boolean }[]>`
    select (select e.papel from equipe_backoffice e where e.tenant_id = ${pessoa.tenantId} and e.pessoa_id = ${pessoa.pessoaId}) as papel,
           exists (select 1 from equipe_backoffice) as tem`;
  const papel = linha?.papel ?? null;
  return { papel: ehPapelBackoffice(papel) ? papel : null, equipeVazia: !(linha?.tem ?? false) };
}

export type AcessoBackoffice = {
  secao: string;
  /** O caminho da rota, sem query string (só `/api/backoffice/...`). */
  rota: string;
  alvo: Escopo | null;
};

/**
 * `acessos_backoffice` é escopada pela pessoa da equipe que acessou: grava na transação dela (RLS de sempre). nod_app só
 * insere e lê a própria linha; UPDATE e DELETE foram revogados na 0184.
 */
export function acessosBackofficeRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(a: AcessoBackoffice): Promise<void> {
      await conn`
        insert into acessos_backoffice (tenant_id, owner_id, secao, rota, alvo_tenant_id, alvo_pessoa_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.secao}, ${a.rota}, ${a.alvo?.tenantId ?? null}, ${a.alvo?.pessoaId ?? null})`;
    },
    async recentes(limite = 50): Promise<{ secao: string; rota: string; alvo: Escopo | null; em: Date }[]> {
      const linhas = await conn<{ secao: string; rota: string; alvo_tenant_id: string | null; alvo_pessoa_id: string | null; em: Date }[]>`
        select secao, rota, alvo_tenant_id, alvo_pessoa_id, em from acessos_backoffice
         where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
         order by em desc limit ${limite}`;
      return linhas.map((l) => ({ secao: l.secao, rota: l.rota, alvo: l.alvo_tenant_id && l.alvo_pessoa_id ? { tenantId: l.alvo_tenant_id, pessoaId: l.alvo_pessoa_id } : null, em: l.em }));
    },
  };
}

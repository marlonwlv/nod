import type { AppLiberado } from "../contracts/seu-computador.ts";
import type { PlataformaPessoa } from "../domain/seu-computador.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

/**
 * Os apps do computador da pessoa que cada bot pode usar (0187, ADR-197). Só a dona lê e grava (owner_id no filtro,
 * além do RLS; a tabela é `privado`).
 */
export type AppLiberadoDoBot = AppLiberado & { agenteId: string; plataforma: PlataformaPessoa; criadoEm: number };

type Linha = { agente_id: string; plataforma: PlataformaPessoa; app_id: string; app_nome: string; ate: Date | null; criado_em: Date };
const app = (l: Linha): AppLiberadoDoBot => ({ agenteId: l.agente_id, plataforma: l.plataforma, id: l.app_id, nome: l.app_nome, ate: l.ate ? ms(l.ate) : null, criadoEm: ms(l.criado_em) });

export function seuComputadorAppsRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Os apps do bot nesta plataforma (os vencidos também; quem filtra é `liberadosAgora`). */
    async doBot(agenteId: string, plataforma: PlataformaPessoa): Promise<AppLiberadoDoBot[]> {
      const linhas = await conn<Linha[]>`
        select agente_id, plataforma, app_id, app_nome, ate, criado_em from seu_computador_apps
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and plataforma = ${plataforma}
        order by app_nome`;
      return linhas.map(app);
    },

    /** Todos os apps de todos os bots da pessoa (Ajustes › Seu Mac). */
    async daPessoa(): Promise<AppLiberadoDoBot[]> {
      const linhas = await conn<Linha[]>`
        select agente_id, plataforma, app_id, app_nome, ate, criado_em from seu_computador_apps
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        order by agente_id, app_nome`;
      return linhas.map(app);
    },

    /**
     * Libera (ou renova) o app para o bot. "Sempre" (`ate` nulo) nunca volta a "desta vez": um pedido novo de "desta vez"
     * sobre um "Sempre" mantém o "Sempre". false = o bot não é da pessoa.
     */
    async liberar(p: { agenteId: string; plataforma: PlataformaPessoa; appId: string; appNome: string; ate: number | null }, agora: number): Promise<boolean> {
      const r = await conn`
        insert into seu_computador_apps (tenant_id, owner_id, agente_id, plataforma, app_id, app_nome, ate, criado_em)
        select ${escopo.tenantId}, ${escopo.pessoaId}, a.id, ${p.plataforma}, ${p.appId}, ${p.appNome.slice(0, 200)}, ${p.ate === null ? null : data(p.ate)}, ${data(agora)}
        from agentes a where a.tenant_id = ${escopo.tenantId} and a.id = ${p.agenteId} and a.owner_id = ${escopo.pessoaId}
        on conflict (tenant_id, agente_id, plataforma, app_id) do update set
          app_nome = excluded.app_nome,
          ate = case when seu_computador_apps.ate is null then null else excluded.ate end
        returning 1`;
      return r.length > 0;
    },

    /** "Tirar": o app (ou, sem `appId`, todos os apps do bot; sem `agenteId`, de todos os bots). Quantos saíram. */
    async tirar(p: { agenteId?: string; appId?: string }): Promise<number> {
      const r = await conn`
        delete from seu_computador_apps
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and (${p.agenteId ?? null}::uuid is null or agente_id = ${p.agenteId ?? null}::uuid)
          and (${p.appId ?? null}::text is null or app_id = ${p.appId ?? null}::text)
        returning 1`;
      return r.length;
    },
  };
}

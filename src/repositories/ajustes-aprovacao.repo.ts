import type { ListaRegra, NivelDeFerramenta, NivelFerramenta, OrigemRegra, RegraRevisor, TetoModo, TipoNivel } from "../contracts/ajustes-aprovacao.ts";
import { ehListaRegra, ehNivelFerramenta, ehTetoModo, ehTipoNivel, tetoMaisFechado } from "../domain/ajustes-aprovacao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

/**
 * definido em 2026-11-12 (ADR-164, 0165): as regras em texto do revisor, o nível por ferramenta e o teto do modo do admin.
 * Só primitivas: a regra mora em src/domain/ajustes-aprovacao.ts. Tudo da dona (owner_id), menos o teto, que o admin grava
 * como 'equipe' e todo o tenant lê.
 */

interface LinhaRegra { id: string; agente_id: string | null; lista: string; texto: string; origem: string; criado_em: Date }
interface LinhaNivel { agente_id: string | null; conector_slug: string; ferramenta: string; tipo: string; nivel: string }

const paraRegra = (l: LinhaRegra): RegraRevisor | null =>
  ehListaRegra(l.lista) ? { id: l.id, agenteId: l.agente_id, lista: l.lista, texto: l.texto, origem: l.origem === "sugestao" ? "sugestao" : "pessoa", criadoEm: ms(l.criado_em) } : null;

const paraNivel = (l: LinhaNivel): NivelDeFerramenta | null =>
  ehTipoNivel(l.tipo) && ehNivelFerramenta(l.nivel) ? { agenteId: l.agente_id, conector: l.conector_slug, ferramenta: l.ferramenta, tipo: l.tipo, nivel: l.nivel } : null;

const SEM_BOT = "00000000-0000-0000-0000-000000000000";

export function ajustesAprovacaoRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /** Todas as regras da dona (padrão e de todos os bots); o domínio escolhe as que valem (`regrasQueValem`). */
    async regras(): Promise<RegraRevisor[]> {
      const ls = await conn<LinhaRegra[]>`select id, agente_id, lista, texto, origem, criado_em from regras_revisor where ${dona()} order by criado_em, id`;
      return ls.flatMap((l) => paraRegra(l) ?? []);
    },
    /** As regras de um alcance (padrão = null) e lista, travadas até o fim da tx (o limite de 20 conta sob a trava). */
    async regrasDaLista(agenteId: string | null, lista: ListaRegra): Promise<RegraRevisor[]> {
      // Trava por dona e alcance: duas inclusões ao mesmo tempo não passam juntas do limite (FOR UPDATE não trava o que não existe).
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`regras:${escopo.pessoaId}:${agenteId ?? "padrao"}:${lista}`}))`;
      const ls = await conn<LinhaRegra[]>`select id, agente_id, lista, texto, origem, criado_em from regras_revisor
        where ${dona()} and lista = ${lista} and ${agenteId === null ? conn`agente_id is null` : conn`agente_id = ${agenteId}`} order by criado_em, id`;
      return ls.flatMap((l) => paraRegra(l) ?? []);
    },
    async buscarRegra(id: string): Promise<RegraRevisor | null> {
      const [l] = await conn<LinhaRegra[]>`select id, agente_id, lista, texto, origem, criado_em from regras_revisor where ${dona()} and id = ${id}`;
      return l ? paraRegra(l) : null;
    },
    async criarRegra(r: { agenteId: string | null; lista: ListaRegra; texto: string; origem: OrigemRegra }): Promise<RegraRevisor> {
      const [l] = await conn<LinhaRegra[]>`insert into regras_revisor (tenant_id, owner_id, agente_id, lista, texto, origem)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${r.agenteId}, ${r.lista}, ${r.texto}, ${r.origem})
        returning id, agente_id, lista, texto, origem, criado_em`;
      const regra = l ? paraRegra(l) : null;
      if (!regra) throw new Error("regra_nao_gravada");
      return regra;
    },
    async editarRegra(id: string, texto: string): Promise<RegraRevisor | null> {
      const [l] = await conn<LinhaRegra[]>`update regras_revisor set texto = ${texto}, atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id} returning id, agente_id, lista, texto, origem, criado_em`;
      return l ? paraRegra(l) : null;
    },
    async apagarRegra(id: string): Promise<boolean> {
      const ls = await conn`delete from regras_revisor where ${dona()} and id = ${id} returning id`;
      return ls.length > 0;
    },

    /** Os níveis da dona (padrão e de todos os bots); o domínio escolhe o que vale (`nivelDaFerramenta`). */
    async niveis(): Promise<NivelDeFerramenta[]> {
      const ls = await conn<LinhaNivel[]>`select agente_id, conector_slug, ferramenta, tipo, nivel from niveis_ferramenta where ${dona()}`;
      return ls.flatMap((l) => paraNivel(l) ?? []);
    },
    /** Grava o nível; `revisor` apaga a linha (é o padrão, sem linha). */
    async definirNivel(n: { agenteId: string | null; conector: string; ferramenta: string; tipo: TipoNivel; nivel: NivelFerramenta }): Promise<void> {
      if (n.nivel === "revisor") {
        await conn`delete from niveis_ferramenta where ${dona()} and coalesce(agente_id, ${SEM_BOT}::uuid) = ${n.agenteId ?? SEM_BOT}::uuid
          and conector_slug = ${n.conector} and ferramenta = ${n.ferramenta} and tipo = ${n.tipo}`;
        return;
      }
      await conn`insert into niveis_ferramenta (tenant_id, owner_id, agente_id, conector_slug, ferramenta, tipo, nivel)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conector}, ${n.ferramenta}, ${n.tipo}, ${n.nivel})
        on conflict (tenant_id, owner_id, coalesce(agente_id, '00000000-0000-0000-0000-000000000000'::uuid), conector_slug, ferramenta, tipo)
        do update set nivel = excluded.nivel, atualizado_em = clock_timestamp()`;
    },

    /** O teto que vale no tenant: o mais fechado entre os que os admins gravaram. */
    async teto(): Promise<TetoModo | null> {
      const ls = await conn<{ teto: string }[]>`select teto from tetos_modo where tenant_id = ${escopo.tenantId} and visibility = 'equipe'`;
      return tetoMaisFechado(ls.map((l) => l.teto).filter(ehTetoModo));
    },
    /** O admin grava (ou tira, com null) o teto dele; a linha é 'equipe' para todo o tenant ler. Quem é admin, a rota diz. */
    async definirTeto(teto: TetoModo | null): Promise<void> {
      if (teto === null) {
        await conn`delete from tetos_modo where ${dona()}`;
        return;
      }
      await conn`insert into tetos_modo (tenant_id, owner_id, visibility, teto) values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${teto})
        on conflict (tenant_id, owner_id) do update set teto = excluded.teto, atualizado_em = clock_timestamp()`;
    },
  };
}

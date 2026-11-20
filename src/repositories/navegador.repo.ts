import type { EpochMs } from "../contracts/ids.ts";
import type { TarefaEnsinada } from "../contracts/navegador-do-bot.ts";
import { lerLiberacoes, SEM_LIBERACOES, type LiberacoesNavegador } from "../domain/navegador-aprovacao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb, ms } from "./conversao.ts";

/**
 * O navegador do bot no banco (0180, ADR-190): as preferências de cada bot e as tarefas ensinadas. Só a dona lê e grava
 * (owner_id no filtro, além do RLS; as tabelas são `privado`).
 */
export type PreferenciasNavegador = {
  agenteId: string;
  continuaSemMac: boolean;
  maquinaId: string | null;
  /** 0181: "Volta para o nod", a escolha explícita (maquinaId nulo sem isto = a máquina automática). */
  noNod: boolean;
  soNaMaquina: boolean;
  liberacoes: LiberacoesNavegador;
  /** 0182: quando o cartão-pergunta foi à conversa (vem uma vez por bot); null = nunca. */
  perguntadoEm: EpochMs | null;
  /** 0182: quando a pessoa respondeu "Continuar com o Mac desligado" (M2/J1); null = nunca respondeu. */
  respondidoEm: EpochMs | null;
  /** 0182: o turno que espera o Mac ligar ("Quando o Mac ligar", K1); null = nenhum. */
  retomarTurnoId: string | null;
  atualizadoEm: EpochMs;
};

type LinhaPreferencias = { agente_id: string; continua_sem_mac: boolean; maquina_id: string | null; no_nod: boolean; so_na_maquina: boolean; liberacoes: unknown; lugar_perguntado_em: Date | null; lugar_respondido_em: Date | null; retomar_turno_id: string | null; atualizado_em: Date };
const preferencias = (l: LinhaPreferencias): PreferenciasNavegador => ({
  agenteId: l.agente_id, continuaSemMac: l.continua_sem_mac, maquinaId: l.maquina_id, noNod: l.no_nod, soNaMaquina: l.so_na_maquina, liberacoes: lerLiberacoes(l.liberacoes),
  perguntadoEm: l.lugar_perguntado_em ? ms(l.lugar_perguntado_em) : null, respondidoEm: l.lugar_respondido_em ? ms(l.lugar_respondido_em) : null, retomarTurnoId: l.retomar_turno_id, atualizadoEm: ms(l.atualizado_em),
});
const COLUNAS = "agente_id, continua_sem_mac, maquina_id, no_nod, so_na_maquina, liberacoes, lugar_perguntado_em, lugar_respondido_em, retomar_turno_id, atualizado_em";

export function navegadorPreferenciasRepo(conn: Conn, escopo: Escopo) {
  async function buscar(agenteId: string): Promise<PreferenciasNavegador | null> {
    const [l] = await conn<LinhaPreferencias[]>`
      select ${conn.unsafe(COLUNAS)} from navegador_preferencias
      where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId}`;
    return l ? preferencias(l) : null;
  }
  return {
    buscar,

    /** As preferências de todos os bots da pessoa (os avisos de quando uma máquina entra ou sai da conta, quadro N). */
    async daPessoa(): Promise<PreferenciasNavegador[]> {
      const linhas = await conn<LinhaPreferencias[]>`
        select ${conn.unsafe(COLUNAS)} from navegador_preferencias
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} order by agente_id`;
      return linhas.map(preferencias);
    },

    /** O que o portão usa (A2/A3); sem linha, nenhuma liberação. */
    async liberacoes(agenteId: string): Promise<LiberacoesNavegador> {
      return (await buscar(agenteId))?.liberacoes ?? SEM_LIBERACOES;
    },

    /** Grava o que veio (o resto fica como está, ou no padrão na primeira vez). null = o bot não é da pessoa (RLS/FK). */
    async gravar(agenteId: string, p: Partial<Omit<PreferenciasNavegador, "agenteId" | "atualizadoEm">>, agora: EpochMs): Promise<PreferenciasNavegador | null> {
      const lib = p.liberacoes ? jsonb(conn, lerLiberacoes(p.liberacoes)) : null;
      const [l] = await conn<LinhaPreferencias[]>`
        insert into navegador_preferencias (tenant_id, owner_id, agente_id, continua_sem_mac, maquina_id, no_nod, so_na_maquina, liberacoes, lugar_perguntado_em, lugar_respondido_em, retomar_turno_id, atualizado_em)
        select ${escopo.tenantId}, ${escopo.pessoaId}, a.id, ${p.continuaSemMac ?? false}, ${p.maquinaId ?? null}, ${p.noNod ?? false}, ${p.soNaMaquina ?? false},
          coalesce(${lib}::jsonb, '{"pagar":[],"enviar":[]}'::jsonb), ${p.perguntadoEm ? data(p.perguntadoEm) : null}, ${p.respondidoEm ? data(p.respondidoEm) : null}, ${p.retomarTurnoId ?? null}, ${data(agora)}
        from agentes a where a.tenant_id = ${escopo.tenantId} and a.id = ${agenteId} and a.owner_id = ${escopo.pessoaId}
        on conflict (tenant_id, agente_id) do update set
          continua_sem_mac = case when ${p.continuaSemMac !== undefined} then excluded.continua_sem_mac else navegador_preferencias.continua_sem_mac end,
          maquina_id = case when ${p.maquinaId !== undefined} then excluded.maquina_id else navegador_preferencias.maquina_id end,
          no_nod = case when ${p.noNod !== undefined} then excluded.no_nod else navegador_preferencias.no_nod end,
          so_na_maquina = case when ${p.soNaMaquina !== undefined} then excluded.so_na_maquina else navegador_preferencias.so_na_maquina end,
          liberacoes = case when ${p.liberacoes !== undefined} then excluded.liberacoes else navegador_preferencias.liberacoes end,
          lugar_perguntado_em = case when ${p.perguntadoEm !== undefined} then excluded.lugar_perguntado_em else navegador_preferencias.lugar_perguntado_em end,
          lugar_respondido_em = case when ${p.respondidoEm !== undefined} then excluded.lugar_respondido_em else navegador_preferencias.lugar_respondido_em end,
          retomar_turno_id = case when ${p.retomarTurnoId !== undefined} then excluded.retomar_turno_id else navegador_preferencias.retomar_turno_id end,
          atualizado_em = excluded.atualizado_em
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? preferencias(l) : null;
    },
  };
}

/** definido em 2026-11-20: a lista que `navegador_tarefa_ensinada` devolve; as mais novas primeiro. */
export const TAREFAS_POR_BOT = 50;

type LinhaTarefa = { id: string; nome: string; passos: unknown; criada_em: Date };
const tarefa = (l: LinhaTarefa): TarefaEnsinada => ({ id: l.id, nome: l.nome, passos: Array.isArray(l.passos) ? l.passos.filter((p): p is string => typeof p === "string") : [], criadaEm: ms(l.criada_em) });

export function navegadorTarefasRepo(conn: Conn, escopo: Escopo) {
  return {
    /** null = o bot não é da pessoa. */
    async criar(t: { agenteId: string; nome: string; passos: readonly string[] }): Promise<TarefaEnsinada | null> {
      const [l] = await conn<LinhaTarefa[]>`
        insert into navegador_tarefas (tenant_id, owner_id, agente_id, nome, passos)
        select ${escopo.tenantId}, ${escopo.pessoaId}, a.id, ${t.nome.trim()}, ${jsonb(conn, [...t.passos])}
        from agentes a where a.tenant_id = ${escopo.tenantId} and a.id = ${t.agenteId} and a.owner_id = ${escopo.pessoaId}
        returning id, nome, passos, criada_em`;
      return l ? tarefa(l) : null;
    },

    async doAgente(agenteId: string): Promise<TarefaEnsinada[]> {
      const linhas = await conn<LinhaTarefa[]>`
        select id, nome, passos, criada_em from navegador_tarefas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId}
        order by criada_em desc, id limit ${TAREFAS_POR_BOT}`;
      return linhas.map(tarefa);
    },

    /** Habilidades (Ajustes do bot): apaga uma tarefa ensinada da dona. false = não existe ou não é dela. */
    async apagar(agenteId: string, id: string): Promise<boolean> {
      const linhas = await conn`
        delete from navegador_tarefas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and id = ${id}
        returning id`;
      return linhas.length > 0;
    },
  };
}

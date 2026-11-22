import type { AutorTipoTarefa, EstadoTarefa, EventoTarefa, TarefaObjetivo, Thread, TipoEventoTarefa, TipoThread } from "../contracts/tarefa.ts";
import type { LinhaTarefa } from "../domain/tarefa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface LinhaT {
  id: string;
  owner_id: string;
  agente_id: string;
  titulo: string;
  estado: EstadoTarefa;
  estado_antes_de_arquivar: Exclude<EstadoTarefa, "arquivada"> | null;
  entregue_em: Date | null;
  entregue_por_tipo: AutorTipoTarefa | null;
  entregue_por_id: string | null;
  resolvida_em: Date | null;
  resolvida_por: string | null;
  arquivada_em: Date | null;
  versao: number;
  chave_idempotencia: string | null;
  origem_chave: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS_T =
  "id, owner_id, agente_id, titulo, estado, estado_antes_de_arquivar, entregue_em, entregue_por_tipo, entregue_por_id, resolvida_em, resolvida_por, arquivada_em, versao, chave_idempotencia, origem_chave, criado_em, atualizado_em";

const paraTarefa = (l: LinhaT): TarefaObjetivo => ({
  id: l.id,
  ownerId: l.owner_id,
  agenteId: l.agente_id,
  titulo: l.titulo,
  estado: l.estado,
  estadoAntesDeArquivar: l.estado_antes_de_arquivar,
  entregueEm: msOuNull(l.entregue_em),
  entreguePorTipo: l.entregue_por_tipo,
  entreguePorId: l.entregue_por_id,
  resolvidaEm: msOuNull(l.resolvida_em),
  resolvidaPor: l.resolvida_por,
  arquivadaEm: msOuNull(l.arquivada_em),
  versao: l.versao,
  chaveIdempotencia: l.chave_idempotencia,
  origemChave: l.origem_chave,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
});

interface LinhaTh { id: string; tarefa_id: string; conversa_id: string; tipo: TipoThread; criado_em: Date; fechada_em: Date | null }
const COLUNAS_TH = "id, tarefa_id, conversa_id, tipo, criado_em, fechada_em";
const paraThread = (l: LinhaTh): Thread => ({ id: l.id, tarefaId: l.tarefa_id, conversaId: l.conversa_id, tipo: l.tipo, criadoEm: ms(l.criado_em), fechadaEm: msOuNull(l.fechada_em) });

interface LinhaE { id: string; tarefa_id: string; tipo: TipoEventoTarefa; autor_tipo: AutorTipoTarefa; autor_id: string; turno_id: string | null; dados: Record<string, string | number | boolean | null>; criado_em: Date }
const paraEvento = (l: LinhaE): EventoTarefa => ({ id: l.id, tarefaId: l.tarefa_id, tipo: l.tipo, autorTipo: l.autor_tipo, autorId: l.autor_id, turnoId: l.turno_id, dados: l.dados, criadoEm: ms(l.criado_em) });

export type NovaTarefa = {
  id?: string;
  agenteId: string;
  titulo: string;
  estado: EstadoTarefa;
  chaveIdempotencia?: string | null;
  origemChave?: string | null;
  /** Backfill (etapa 4): a hora de criação do trabalho de origem; senão, agora. */
  criadoEm?: number;
  /** Backfill: a projeção da entrega de quando o trabalho terminou. */
  entregueEm?: number | null;
  entreguePorTipo?: AutorTipoTarefa | null;
  entreguePorId?: string | null;
};

export type NovoEventoTarefa = { tarefaId: string; tipo: TipoEventoTarefa; autorTipo: AutorTipoTarefa; autorId: string; turnoId?: string | null; dados?: Record<string, string | number | boolean | null>; criadoEm?: number };

export type FiltroTarefas = { agenteId?: string; estado?: EstadoTarefa; comArquivadas?: boolean; limite?: number };

/**
 * ADR-192 (definido em 2026-11-22, etapa 1): Tarefas, a trilha delas e as Threads. Toda escrita é da dona (RLS e
 * `owner_id`). O estado só muda por `aplicar`, com a versão lida (o ETag de Resolver): a corrida de dois cliques muda uma
 * vez, e quem perdeu relê.
 */
export function tarefasRepo(conn: Conn, escopo: Escopo) {
  return {
    /** null = já existe uma Tarefa com a mesma chave de idempotência (desta dona) ou a mesma chave de origem (backfill). */
    async criar(t: NovaTarefa): Promise<TarefaObjetivo | null> {
      const criadoEm = t.criadoEm !== undefined ? data(t.criadoEm) : null;
      const [l] = await conn<LinhaT[]>`
        insert into tarefas (id, tenant_id, owner_id, agente_id, titulo, estado, chave_idempotencia, origem_chave, entregue_em, entregue_por_tipo, entregue_por_id, criado_em, atualizado_em)
        values (${t.id ?? conn`gen_random_uuid()`}, ${escopo.tenantId}, ${escopo.pessoaId}, ${t.agenteId}, ${t.titulo}, ${t.estado}, ${t.chaveIdempotencia ?? null}, ${t.origemChave ?? null},
          ${t.entregueEm != null ? data(t.entregueEm) : null}, ${t.entreguePorTipo ?? null}, ${t.entreguePorId ?? null},
          coalesce(${criadoEm}::timestamptz, clock_timestamp()), coalesce(${criadoEm}::timestamptz, clock_timestamp()))
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS_T)}`;
      return l ? paraTarefa(l) : null;
    },

    async buscar(id: string): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`select ${conn.unsafe(COLUNAS_T)} from tarefas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ? paraTarefa(l) : null;
    },

    /** A linha travada: Resolver, Continuar, Reabrir e Arquivar decidem um de cada vez. */
    async buscarTravado(id: string): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`select ${conn.unsafe(COLUNAS_T)} from tarefas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? paraTarefa(l) : null;
    },

    async buscarPorChave(chave: string): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`select ${conn.unsafe(COLUNAS_T)} from tarefas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and chave_idempotencia = ${chave}`;
      return l ? paraTarefa(l) : null;
    },

    async buscarPorOrigem(origemChave: string): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`select ${conn.unsafe(COLUNAS_T)} from tarefas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and origem_chave = ${origemChave}`;
      return l ? paraTarefa(l) : null;
    },

    /** Grava a linha nova de uma transição se a versão ainda for a lida; null = alguém mudou antes (relê e decide de novo). */
    async aplicar(id: string, linha: LinhaTarefa, versaoLida: number, agora: number): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`
        update tarefas set estado = ${linha.estado}, estado_antes_de_arquivar = ${linha.estadoAntesDeArquivar},
          entregue_em = ${linha.entregueEm != null ? data(linha.entregueEm) : null}, entregue_por_tipo = ${linha.entreguePorTipo}, entregue_por_id = ${linha.entreguePorId},
          resolvida_em = ${linha.resolvidaEm != null ? data(linha.resolvidaEm) : null}, resolvida_por = ${linha.resolvidaPor},
          arquivada_em = ${linha.arquivadaEm != null ? data(linha.arquivadaEm) : null},
          versao = ${linha.versao}, atualizado_em = greatest(${data(agora)}, atualizado_em)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and versao = ${versaoLida}
        returning ${conn.unsafe(COLUNAS_T)}`;
      return l ? paraTarefa(l) : null;
    },

    async renomear(id: string, titulo: string, agora: number): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`
        update tarefas set titulo = ${titulo}, versao = versao + 1, atualizado_em = greatest(${data(agora)}, atualizado_em)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS_T)}`;
      return l ? paraTarefa(l) : null;
    },

    /** Marca que algo da Tarefa mudou (uma mensagem nova, a atividade) sem mudar o estado: a lista ordena por aqui. */
    async tocar(id: string, agora: number): Promise<void> {
      await conn`update tarefas set atualizado_em = greatest(${data(agora)}, atualizado_em) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },

    /** A lista da dona (por bot ou todas), mais recentes primeiro; sem `comArquivadas`, esconde as arquivadas. */
    async listar(f: FiltroTarefas = {}): Promise<TarefaObjetivo[]> {
      const limite = Math.min(Math.max(f.limite ?? 200, 1), 500);
      const linhas = await conn<LinhaT[]>`
        select ${conn.unsafe(COLUNAS_T)} from tarefas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          ${f.agenteId ? conn`and agente_id = ${f.agenteId}` : conn``}
          ${f.estado ? conn`and estado = ${f.estado}` : f.comArquivadas ? conn`` : conn`and estado <> 'arquivada'`}
        order by atualizado_em desc, id desc limit ${limite}`;
      return linhas.map(paraTarefa);
    },

    async registrarEvento(e: NovoEventoTarefa): Promise<EventoTarefa> {
      const criadoEm = e.criadoEm !== undefined ? data(e.criadoEm) : null;
      const [l] = await conn<LinhaE[]>`
        insert into tarefa_eventos (tenant_id, owner_id, tarefa_id, tipo, autor_tipo, autor_id, turno_id, dados, criado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.tarefaId}, ${e.tipo}, ${e.autorTipo}, ${e.autorId}, ${e.turnoId ?? null}, ${conn.json(e.dados ?? {})}, coalesce(${criadoEm}::timestamptz, clock_timestamp()))
        returning id, tarefa_id, tipo, autor_tipo, autor_id, turno_id, dados, criado_em`;
      return paraEvento(l!);
    },

    async eventos(tarefaId: string): Promise<EventoTarefa[]> {
      const linhas = await conn<LinhaE[]>`
        select id, tarefa_id, tipo, autor_tipo, autor_id, turno_id, dados, criado_em from tarefa_eventos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_id = ${tarefaId}
        order by criado_em, id`;
      return linhas.map(paraEvento);
    },

    async criarThread(t: { tarefaId: string; conversaId: string; tipo?: TipoThread; criadoEm?: number }): Promise<Thread | null> {
      const criadoEm = t.criadoEm !== undefined ? data(t.criadoEm) : null;
      const [l] = await conn<LinhaTh[]>`
        insert into threads (tenant_id, owner_id, tarefa_id, conversa_id, tipo, criado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.tarefaId}, ${t.conversaId}, ${t.tipo ?? "primaria"}, coalesce(${criadoEm}::timestamptz, clock_timestamp()))
        on conflict do nothing
        returning ${conn.unsafe(COLUNAS_TH)}`;
      return l ? paraThread(l) : null;
    },

    async buscarThread(id: string): Promise<Thread | null> {
      const [l] = await conn<LinhaTh[]>`select ${conn.unsafe(COLUNAS_TH)} from threads where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ? paraThread(l) : null;
    },

    async threadPrimaria(tarefaId: string): Promise<Thread | null> {
      const [l] = await conn<LinhaTh[]>`select ${conn.unsafe(COLUNAS_TH)} from threads where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_id = ${tarefaId} and tipo = 'primaria'`;
      return l ? paraThread(l) : null;
    },

    async threadsDaTarefa(tarefaId: string): Promise<Thread[]> {
      const linhas = await conn<LinhaTh[]>`select ${conn.unsafe(COLUNAS_TH)} from threads where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_id = ${tarefaId} order by criado_em, id`;
      return linhas.map(paraThread);
    },

    /** As Threads primárias de várias Tarefas (a lista monta numa consulta). */
    async primariasDe(tarefaIds: readonly string[]): Promise<Map<string, Thread>> {
      if (tarefaIds.length === 0) return new Map();
      const linhas = await conn<LinhaTh[]>`select ${conn.unsafe(COLUNAS_TH)} from threads where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_id = any(${tarefaIds as string[]}::uuid[]) and tipo = 'primaria'`;
      return new Map(linhas.map((l) => [l.tarefa_id, paraThread(l)]));
    },

    /** Liga o trabalho runtime à Tarefa (dual-write e backfill). false = o trabalho não é desta dona. */
    async ligarTrabalho(trabalhoId: string, tarefaId: string): Promise<boolean> {
      const r = await conn`update trabalhos set tarefa_objetivo_id = ${tarefaId} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${trabalhoId} returning id`;
      return r.length > 0;
    },

    /** Põe o turno na Thread (um turno pertence a no máximo uma Thread: só liga quem ainda não tem). */
    async ligarTurno(turnoId: string, threadId: string): Promise<boolean> {
      const r = await conn`update turnos set thread_id = ${threadId} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${turnoId} and (thread_id is null or thread_id = ${threadId}) returning id`;
      return r.length > 0;
    },

    /** A Tarefa ligada a um trabalho runtime, se houver. */
    async doTrabalho(trabalhoId: string): Promise<TarefaObjetivo | null> {
      const [l] = await conn<LinhaT[]>`
        select ${conn.unsafe(COLUNAS_T.split(", ").map((c) => `t.${c}`).join(", "))} from trabalhos w
        join tarefas t on t.tenant_id = w.tenant_id and t.id = w.tarefa_objetivo_id
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.id = ${trabalhoId}`;
      return l ? paraTarefa(l) : null;
    },

    /** Os trabalhos runtime de uma Tarefa (MVP: um; o backfill de Card pode ligar vários), mais recente primeiro. */
    async trabalhosDa(tarefaId: string): Promise<string[]> {
      const linhas = await conn<{ id: string }[]>`
        select id from trabalhos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_objetivo_id = ${tarefaId}
        order by criado_em desc, id desc`;
      return linhas.map((l) => l.id);
    },

    /** Os trabalhos e Cards ligados a várias Tarefas (para o DTO da lista). */
    async vinculosDe(tarefaIds: readonly string[]): Promise<Map<string, { trabalhoId: string | null; cardId: string | null }>> {
      const m = new Map<string, { trabalhoId: string | null; cardId: string | null }>();
      if (tarefaIds.length === 0) return m;
      const ids = tarefaIds as string[];
      const trabalhos = await conn<{ tarefa_objetivo_id: string; id: string }[]>`
        select distinct on (tarefa_objetivo_id) tarefa_objetivo_id, id from trabalhos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_objetivo_id = any(${ids}::uuid[])
        order by tarefa_objetivo_id, criado_em desc, id desc`;
      const cards = await conn<{ tarefa_objetivo_id: string; id: string }[]>`
        select distinct on (tarefa_objetivo_id) tarefa_objetivo_id, id from quadro_tarefas
        where tenant_id = ${escopo.tenantId} and tarefa_objetivo_id = any(${ids}::uuid[])
        order by tarefa_objetivo_id, id`;
      for (const id of tarefaIds) m.set(id, { trabalhoId: null, cardId: null });
      for (const t of trabalhos) m.get(t.tarefa_objetivo_id)!.trabalhoId = t.id;
      for (const c of cards) m.get(c.tarefa_objetivo_id)!.cardId = c.id;
      return m;
    },

    /** Liga um Card à Tarefa (ponte explícita; nunca automática no primeiro rollout). */
    async ligarCard(cardId: string, tarefaId: string): Promise<boolean> {
      const r = await conn`update quadro_tarefas set tarefa_objetivo_id = ${tarefaId} where tenant_id = ${escopo.tenantId} and id = ${cardId} returning id`;
      return r.length > 0;
    },
  };
}

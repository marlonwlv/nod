import type { FonteProblema, PessoaRefDto } from "../contracts/backoffice.ts";
import type { CasoFato, FatosPessoa } from "../domain/backoffice-uso.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

/**
 * Os fatos de UMA pessoa para o painel de uso do backoffice (definido em 2026-11-23, ADR-193; backoffice no ADR-194). Roda na transação escopada da
 * própria pessoa (RLS por pessoa intacta: o painel abre uma por pessoa, como os laços de fundo), e cada consulta ainda
 * filtra pelo dono explicitamente (a política também deixa ver o que é compartilhado). Só lê metadados: nunca
 * `mensagens.texto`, `turno_diagnosticos.erro_cru`, payload de proposta ou valor de credencial.
 *
 * Limites: a janela (`ini`, no máximo 90 dias) e um teto de linhas por fonte, para uma pessoa barulhenta não pesar o
 * painel inteiro.
 */

/** Sem a primeira fala do bot em 2 min, a resposta conta como lenta. */
export const RESPOSTA_LENTA_MS = 120_000;
/** Turno vivo sem lease renovado, ou vivo há mais de 30 min, conta como travado. */
export const TRAVADA_MS = 30 * 60_000;
/** Mac visto nos últimos 30 dias e calado há mais de 10 min conta como sem contato. */
export const MAC_CALADO_MS = 10 * 60_000;
const MAC_RECENTE_MS = 30 * 86_400_000;
const TETO_POR_FONTE = 1000;

const toMs = (d: Date | null): number | null => (d ? ms(d) : null);

export function backofficeUsoRepo(conn: Conn, escopo: Escopo) {
  const t = escopo.tenantId;
  const p = escopo.pessoaId;

  async function turnosComProblema(ini: Date): Promise<CasoFato[]> {
    const linhas = await conn<{ id: string; conversa_id: string; criado_em: Date; estado: string; origem: string; produced_output: boolean; motivo_falha: string | null; motivo_interrupcao: string | null; tarefa_id: string | null; primeira: Date | null }[]>`
      select t.id, t.conversa_id, t.criado_em, t.estado::text as estado, t.origem::text as origem, t.produced_output,
             t.motivo_falha::text as motivo_falha, t.motivo_interrupcao::text as motivo_interrupcao, w.tarefa_objetivo_id as tarefa_id,
             case when t.origem = 'conversa' and t.estado = 'concluido' then
               (select min(m.criado_em) from mensagens m where m.tenant_id = t.tenant_id and m.turno_id = t.id and m.autor_tipo = 'agente')
             end as primeira
        from turnos t
        left join trabalhos w on w.tenant_id = t.tenant_id and w.id = t.trabalho_id
       where t.tenant_id = ${t} and t.owner_id = ${p} and t.criado_em >= ${ini}
         and (t.estado = 'interrompido' or t.motivo_falha is not null or (t.origem = 'conversa' and t.estado = 'concluido'))
       order by t.criado_em desc
       limit ${TETO_POR_FONTE * 4}`;
    const casos: CasoFato[] = [];
    for (const l of linhas) {
      const base = { em: ms(l.criado_em), conversaId: l.conversa_id, turnoId: l.id, tarefaId: l.tarefa_id, alvo: null };
      if (l.motivo_falha) casos.push({ ...base, fonte: "turno_falhou", motivo: l.motivo_falha });
      else if (l.estado === "interrompido") {
        const motivo = l.motivo_interrupcao ?? "geral";
        if (motivo === "absorvido") continue;
        casos.push({ ...base, fonte: motivo === "parado_pela_pessoa" ? "tarefa_cancelada" : "turno_interrompido", motivo });
      } else if (!l.produced_output) casos.push({ ...base, fonte: "sem_resposta", motivo: "geral" });
      else if (l.primeira && ms(l.primeira) - ms(l.criado_em) > RESPOSTA_LENTA_MS) casos.push({ ...base, em: ms(l.primeira), fonte: "resposta_lenta", motivo: "geral" });
    }
    return casos;
  }

  async function negacoes(ini: Date): Promise<CasoFato[]> {
    const linhas = await conn<{ turno_id: string | null; conversa_id: string | null; ferramenta: string; motivo: string | null; em: Date }[]>`
      select tr.turno_id, tu.conversa_id, tr.ferramenta, tr.motivo, tr.em
        from trilha tr
        left join turnos tu on tu.tenant_id = tr.tenant_id and tu.id = tr.turno_id
       where tr.tenant_id = ${t} and tr.owner_id = ${p} and tr.kind = 'negacao' and tr.em >= ${ini}
       order by tr.em desc limit ${TETO_POR_FONTE}`;
    return linhas.map((l) => ({ fonte: "ferramenta_negada", motivo: l.motivo ?? "geral", em: ms(l.em), conversaId: l.conversa_id, turnoId: l.turno_id, tarefaId: null, alvo: l.ferramenta }));
  }

  async function decisoes(ini: Date): Promise<CasoFato[]> {
    const vencidas = await conn<{ id: string; tipo: string; conversa_id: string; turno_id: string | null; em: Date }[]>`
      select id, tipo::text as tipo, conversa_id, turno_id, coalesce(decidida_em, prazo_decisao_em) as em
        from decisoes
       where tenant_id = ${t} and decisor_id = ${p} and criado_em >= ${ini}
         and (estado = 'vencida' or desfecho->>'tipo' in ('expirou_sem_ninguem_ver', 'expirou_com_alguem_ciente'))
       order by criado_em desc limit ${TETO_POR_FONTE}`;
    const itens = await conn<{ desfecho: string; tipo: string; conversa_id: string; turno_id: string | null; em: Date }[]>`
      select i.desfecho::text as desfecho, d.tipo::text as tipo, d.conversa_id, d.turno_id, coalesce(i.marcado_em, d.decidida_em, d.criado_em) as em
        from itens_aprovacao i
        join decisoes d on d.tenant_id = i.tenant_id and d.id = i.decisao_id
       where i.tenant_id = ${t} and d.decisor_id = ${p} and d.criado_em >= ${ini}
         and i.desfecho in ('retirado_pela_pessoa', 'sensivel_nao_aprovado', 'falhou_na_execucao')
       order by d.criado_em desc limit ${TETO_POR_FONTE}`;
    const recusadas = await conn<{ kind: string; conversa_id: string; em: Date }[]>`
      select kind::text as kind, conversa_id, criado_em as em
        from propostas
       where tenant_id = ${t} and owner_id = ${p} and estado = 'recusada' and criado_em >= ${ini}
       order by criado_em desc limit ${TETO_POR_FONTE}`;
    return [
      ...vencidas.map((l): CasoFato => ({ fonte: "decisao_expirou", motivo: l.tipo, em: ms(l.em), conversaId: l.conversa_id, turnoId: l.turno_id, tarefaId: null, alvo: null })),
      ...itens.map((l): CasoFato => ({ fonte: l.desfecho === "falhou_na_execucao" ? "item_falhou" : "aprovacao_recusada", motivo: l.desfecho, em: ms(l.em), conversaId: l.conversa_id, turnoId: l.turno_id, tarefaId: null, alvo: l.tipo })),
      ...recusadas.map((l): CasoFato => ({ fonte: "pedido_recusado", motivo: l.kind, em: ms(l.em), conversaId: l.conversa_id, turnoId: null, tarefaId: null, alvo: null })),
    ];
  }

  async function conectoresComFalha(ini: Date): Promise<CasoFato[]> {
    const linhas = await conn<{ slug: string; motivo: string | null; causa: string | null; em: string | null }[]>`
      select slug, ultima_falha->>'motivo' as motivo, ultima_falha->>'causa' as causa, ultima_falha->>'em' as em
        from conectores
       where tenant_id = ${t} and owner_id = ${p} and ultima_falha is not null`;
    const casos: CasoFato[] = [];
    for (const l of linhas) {
      const em = Number(l.em);
      if (!Number.isFinite(em) || em < ms(ini)) continue;
      const auth = l.causa === "acesso_recusado";
      const fonte: FonteProblema = auth ? "conector_auth" : "conector_falha";
      casos.push({ fonte, motivo: auth ? "acesso_recusado" : (l.motivo ?? "geral"), em, conversaId: null, turnoId: null, tarefaId: null, alvo: l.slug });
    }
    return casos;
  }

  async function rotinasComFalha(ini: Date): Promise<CasoFato[]> {
    const linhas = await conn<{ rotina_id: string; turno_id: string | null; conversa_id: string | null; desfecho: string; motivo: string | null; em: Date }[]>`
      select e.rotina_id, e.turno_id, tu.conversa_id, e.desfecho::text as desfecho, e.motivo, e.em
        from rotina_execucoes e
        left join turnos tu on tu.tenant_id = e.tenant_id and tu.id = e.turno_id
       where e.tenant_id = ${t} and e.owner_id = ${p} and e.em >= ${ini} and e.desfecho in ('falhou', 'interrompida', 'bloqueada')
       order by e.em desc limit ${TETO_POR_FONTE}`;
    return linhas.map((l) => ({ fonte: "rotina_falhou", motivo: l.motivo ?? l.desfecho, em: ms(l.em), conversaId: l.conversa_id, turnoId: l.turno_id, tarefaId: null, alvo: null, grupo: l.rotina_id }));
  }

  async function outrosProblemas(ini: Date): Promise<CasoFato[]> {
    const incidentes = await conn<{ em: Date }[]>`
      select comecou_em as em from incidentes
       where tenant_id = ${t} and owner_id = ${p} and tipo = 'mac_sem_contato' and comecou_em >= ${ini}
       order by comecou_em desc limit ${TETO_POR_FONTE}`;
    const relatos = await conn<{ categoria: string; conversa_id: string; turno_id: string | null; em: Date }[]>`
      select categoria::text as categoria, conversa_id, turno_id, criado_em as em from relatos
       where tenant_id = ${t} and owner_id = ${p} and criado_em >= ${ini}
       order by criado_em desc limit ${TETO_POR_FONTE}`;
    return [
      ...incidentes.map((l): CasoFato => ({ fonte: "mac_sem_contato", motivo: "geral", em: ms(l.em), conversaId: null, turnoId: null, tarefaId: null, alvo: null })),
      ...relatos.map((l): CasoFato => ({ fonte: "relato", motivo: l.categoria, em: ms(l.em), conversaId: l.conversa_id, turnoId: l.turno_id, tarefaId: null, alvo: null })),
    ];
  }

  return {
    async fatos(ref: PessoaRefDto, ini: Date, agora: Date): Promise<FatosPessoa> {
      const [marcos] = await conn<{ criada_em: Date | null; primeira_msg: Date | null; ultima_msg: Date | null; primeiro_agente: Date | null; primeira_entrega: Date | null; primeiro_turno_ok: Date | null }[]>`
        select (select coalesce(pe.criada_em, cp.criada_em) from pessoas pe
                  left join conta_pessoas cp on cp.tenant_id = pe.tenant_id and cp.pessoa_id = pe.id
                 where pe.tenant_id = ${t} and pe.id = ${p}) as criada_em,
               (select min(criado_em) from mensagens where tenant_id = ${t} and owner_id = ${p} and autor_tipo = 'pessoa') as primeira_msg,
               (select max(criado_em) from mensagens where tenant_id = ${t} and owner_id = ${p} and autor_tipo = 'pessoa') as ultima_msg,
               (select min(criado_em) from agentes where tenant_id = ${t} and owner_id = ${p}) as primeiro_agente,
               (select min(entregue_em) from tarefas where tenant_id = ${t} and owner_id = ${p}) as primeira_entrega,
               (select min(criado_em) from turnos where tenant_id = ${t} and owner_id = ${p} and estado = 'concluido' and produced_output) as primeiro_turno_ok`;
      const [onb] = await conn<{ onboarding_etapa: string | null; onboarding_concluido_em: Date | null }[]>`
        select onboarding_etapa::text as onboarding_etapa, onboarding_concluido_em from preferencias where tenant_id = ${t} and owner_id = ${p} limit 1`;
      const dias = await conn<{ dia: string; n: number }[]>`
        select to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD') as dia, count(*)::int as n
          from mensagens where tenant_id = ${t} and owner_id = ${p} and autor_tipo = 'pessoa' and criado_em >= ${ini}
         group by 1`;
      const [cont] = await conn<{ turnos: number; rotinas_ativas: number; travadas: number; macs: number }[]>`
        select (select count(*)::int from turnos where tenant_id = ${t} and owner_id = ${p} and criado_em >= ${ini}) as turnos,
               (select count(*)::int from rotinas where tenant_id = ${t} and owner_id = ${p} and estado = 'ativa' and excluido_em is null) as rotinas_ativas,
               (select count(*)::int from turnos where tenant_id = ${t} and owner_id = ${p} and estado in ('pendente', 'despachando')
                  and ((lease_ate is not null and lease_ate < ${agora}) or criado_em < ${new Date(agora.getTime() - TRAVADA_MS)})) as travadas,
               (select count(*)::int from maquinas where tenant_id = ${t} and owner_id = ${p}
                  and visto_em < ${new Date(agora.getTime() - MAC_CALADO_MS)} and visto_em >= ${new Date(agora.getTime() - MAC_RECENTE_MS)}) as macs`;
      const bots = await conn<{ tipo: string; criado_em: Date }[]>`
        select coalesce(nullif(harness, ''), 'auto') as tipo, criado_em from agentes
         where tenant_id = ${t} and owner_id = ${p} and papel is distinct from 'nod' order by criado_em`;
      const apps = await conn<{ slug: string; criado_em: Date }[]>`
        select slug, criado_em from conectores where tenant_id = ${t} and owner_id = ${p} order by criado_em`;
      const tarefas = await conn<{ id: string; criado_em: Date; entregue_em: Date | null }[]>`
        select id, criado_em, entregue_em from tarefas where tenant_id = ${t} and owner_id = ${p} and criado_em >= ${ini}
         order by criado_em desc limit ${TETO_POR_FONTE}`;
      const rotinas = await conn<{ id: string; criado_em: Date }[]>`
        select id, criado_em from rotinas where tenant_id = ${t} and owner_id = ${p} and criado_em >= ${ini}
         order by criado_em desc limit ${TETO_POR_FONTE}`;
      const problemas = [
        ...(await turnosComProblema(ini)),
        ...(await negacoes(ini)),
        ...(await decisoes(ini)),
        ...(await conectoresComFalha(ini)),
        ...(await rotinasComFalha(ini)),
        ...(await outrosProblemas(ini)),
      ];

      const primeiroSinal = [toMs(marcos?.primeira_msg ?? null), toMs(marcos?.primeiro_agente ?? null)].filter((x): x is number => x !== null);
      const cadastroEm = toMs(marcos?.criada_em ?? null) ?? (primeiroSinal.length ? Math.min(...primeiroSinal) : null);
      const tarefaOk = [toMs(marcos?.primeira_entrega ?? null), toMs(marcos?.primeiro_turno_ok ?? null)].filter((x): x is number => x !== null);
      return {
        ref,
        cadastroEm,
        ultimoUsoEm: toMs(marcos?.ultima_msg ?? null),
        onboardingEtapa: onb?.onboarding_etapa ?? null,
        onboardingConcluidoEm: toMs(onb?.onboarding_concluido_em ?? null),
        diasAtivos: dias.map((d) => d.dia).sort(),
        mensagens: dias.reduce((s, d) => s + d.n, 0),
        turnos: cont?.turnos ?? 0,
        rotinasAtivas: cont?.rotinas_ativas ?? 0,
        bots: bots.map((b) => ({ tipo: b.tipo, criadoEm: ms(b.criado_em) })),
        apps: apps.map((a) => ({ slug: a.slug, criadoEm: ms(a.criado_em) })),
        primeiraTarefaEm: tarefaOk.length ? Math.min(...tarefaOk) : null,
        tarefas: tarefas.map((x) => ({ id: x.id, criadoEm: ms(x.criado_em), entregueEm: toMs(x.entregue_em) })),
        rotinas: rotinas.map((x) => ({ id: x.id, criadoEm: ms(x.criado_em) })),
        problemas,
        travadas: cont?.travadas ?? 0,
        macsSemContato: cont?.macs ?? 0,
      };
    },
  };
}

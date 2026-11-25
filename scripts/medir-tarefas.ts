import { fileURLToPath } from "node:url";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import type { Escopo, Tx } from "../src/shared/types.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 0 da especificação "Tarefa com Thread"): a régua da migração das Tarefas. Só
 * leitura (transação read-only) e só contagens — nenhum título, pedido ou resumo sai do processo.
 *
 *   node scripts/medir-tarefas.ts
 *
 * Mede, somando as pessoas:
 *  - trabalhos por `origem` × `forma` × `estado` (o que o backfill da etapa 4 vai encontrar);
 *  - Cards do quadro: quantos, quantos com algum trabalho ligado por `trabalhos.tarefa_id`;
 *  - as antigas Tarefas terminais (frente de pessoa/rede): terminadas — que o backfill leva a `entregue`, nunca a
 *    `resolvida` — e, entre elas, as que devolveram `falta` no resumo (o falso "concluída" do diagnóstico de 20/11);
 *  - frentes filhas (com `trabalho_mae_id`) e de rotina, que não viram Tarefa por execução;
 *  - depois da etapa 1, as Tarefas e Threads já gravadas e os trabalhos ligados a elas (`tarefa_objetivo_id`).
 */

export type ContagemTrabalhos = { origem: string; forma: string; estado: string; n: number };

export type MedidaDeTarefas = {
  trabalhos: ContagemTrabalhos[];
  cards: number;
  cardsComTrabalho: number;
  tarefasTerminadas: number;
  tarefasTerminadasComFalta: number;
  tarefasParadasOuFalhas: number;
  frentesFilhas: number;
  trabalhosDeRotina: number;
  /** Etapa 1 em diante (null quando o schema ainda não tem as tabelas). */
  tarefas: { estado: string; n: number }[] | null;
  threads: number | null;
  trabalhosLigados: number | null;
};

export function medidaVazia(): MedidaDeTarefas {
  return { trabalhos: [], cards: 0, cardsComTrabalho: 0, tarefasTerminadas: 0, tarefasTerminadasComFalta: 0, tarefasParadasOuFalhas: 0, frentesFilhas: 0, trabalhosDeRotina: 0, tarefas: null, threads: null, trabalhosLigados: null };
}

/** Soma `b` em `a` (as contagens por chave se juntam). */
export function somarMedidas(a: MedidaDeTarefas, b: MedidaDeTarefas): MedidaDeTarefas {
  const porChave = new Map<string, ContagemTrabalhos>();
  for (const c of [...a.trabalhos, ...b.trabalhos]) {
    const k = `${c.origem}|${c.forma}|${c.estado}`;
    const atual = porChave.get(k);
    porChave.set(k, atual ? { ...atual, n: atual.n + c.n } : { ...c });
  }
  const somaOuNulo = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
  const tarefas = a.tarefas === null && b.tarefas === null ? null : (() => {
    const m = new Map<string, number>();
    for (const t of [...(a.tarefas ?? []), ...(b.tarefas ?? [])]) m.set(t.estado, (m.get(t.estado) ?? 0) + t.n);
    return [...m].map(([estado, n]) => ({ estado, n })).sort((x, y) => x.estado.localeCompare(y.estado));
  })();
  return {
    trabalhos: [...porChave.values()].sort((x, y) => `${x.origem}|${x.forma}|${x.estado}`.localeCompare(`${y.origem}|${y.forma}|${y.estado}`)),
    cards: a.cards + b.cards,
    cardsComTrabalho: a.cardsComTrabalho + b.cardsComTrabalho,
    tarefasTerminadas: a.tarefasTerminadas + b.tarefasTerminadas,
    tarefasTerminadasComFalta: a.tarefasTerminadasComFalta + b.tarefasTerminadasComFalta,
    tarefasParadasOuFalhas: a.tarefasParadasOuFalhas + b.tarefasParadasOuFalhas,
    frentesFilhas: a.frentesFilhas + b.frentesFilhas,
    trabalhosDeRotina: a.trabalhosDeRotina + b.trabalhosDeRotina,
    tarefas,
    threads: somaOuNulo(a.threads, b.threads),
    trabalhosLigados: somaOuNulo(a.trabalhosLigados, b.trabalhosLigados),
  };
}

/** As medidas da pessoa do escopo (lê só o que é dela: owner_id). */
export async function medirTarefasDaPessoa(trx: Tx, escopo: Escopo): Promise<MedidaDeTarefas> {
  const trabalhos = await trx<ContagemTrabalhos[]>`
    select origem, forma, estado, count(*)::int as n from trabalhos
    where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
    group by origem, forma, estado order by origem, forma, estado`;
  const [r] = await trx<{ cards: number; cards_com_trabalho: number; terminadas: number; com_falta: number; paradas: number; filhas: number; rotina: number }[]>`
    select
      (select count(*)::int from quadro_tarefas q where q.tenant_id = ${escopo.tenantId} and q.owner_id = ${escopo.pessoaId}) as cards,
      (select count(*)::int from quadro_tarefas q where q.tenant_id = ${escopo.tenantId} and q.owner_id = ${escopo.pessoaId}
        and exists (select 1 from trabalhos t where t.tenant_id = q.tenant_id and t.tarefa_id = q.id)) as cards_com_trabalho,
      (select count(*)::int from trabalhos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.forma = 'frente' and t.origem in ('pessoa', 'rede') and t.estado = 'terminado') as terminadas,
      (select count(*)::int from trabalhos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.forma = 'frente' and t.origem in ('pessoa', 'rede') and t.estado = 'terminado'
        and nullif(btrim(t.resumo->>'falta'), '') is not null) as com_falta,
      (select count(*)::int from trabalhos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.forma = 'frente' and t.origem in ('pessoa', 'rede') and t.estado in ('parado', 'falhou')) as paradas,
      (select count(*)::int from trabalhos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.trabalho_mae_id is not null) as filhas,
      (select count(*)::int from trabalhos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.origem = 'rotina') as rotina`;
  const medida: MedidaDeTarefas = {
    ...medidaVazia(),
    trabalhos: [...trabalhos],
    cards: r?.cards ?? 0,
    cardsComTrabalho: r?.cards_com_trabalho ?? 0,
    tarefasTerminadas: r?.terminadas ?? 0,
    tarefasTerminadasComFalta: r?.com_falta ?? 0,
    tarefasParadasOuFalhas: r?.paradas ?? 0,
    frentesFilhas: r?.filhas ?? 0,
    trabalhosDeRotina: r?.rotina ?? 0,
  };
  // As tabelas da etapa 1 podem não existir ainda (o script roda antes e depois da migração).
  const [temTarefas] = await trx<{ existe: boolean }[]>`select to_regclass('public.tarefas') is not null as existe`;
  if (!temTarefas?.existe) return medida;
  const tarefas = await trx<{ estado: string; n: number }[]>`
    select estado, count(*)::int as n from tarefas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} group by estado order by estado`;
  const [ligacoes] = await trx<{ threads: number; ligados: number }[]>`
    select
      (select count(*)::int from threads where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}) as threads,
      (select count(*)::int from trabalhos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and tarefa_objetivo_id is not null) as ligados`;
  return { ...medida, tarefas: [...tarefas], threads: ligacoes?.threads ?? 0, trabalhosLigados: ligacoes?.ligados ?? 0 };
}

/** O relatório em texto (só números). */
export function relatorioDeTarefas(m: MedidaDeTarefas, cabecalho: string): string[] {
  const linhas = [cabecalho, ""];
  linhas.push(`${"origem".padEnd(10)} ${"forma".padEnd(8)} ${"estado".padEnd(16)} ${"trabalhos".padStart(10)}`);
  for (const c of m.trabalhos) linhas.push(`${c.origem.padEnd(10)} ${c.forma.padEnd(8)} ${c.estado.padEnd(16)} ${String(c.n).padStart(10)}`);
  linhas.push("");
  linhas.push(`Cards do quadro: ${m.cards} (com trabalho ligado: ${m.cardsComTrabalho})`);
  linhas.push(`Tarefas (frente de pessoa/rede) terminadas: ${m.tarefasTerminadas} (com "falta" no resumo: ${m.tarefasTerminadasComFalta})`);
  linhas.push(`Tarefas paradas ou que falharam: ${m.tarefasParadasOuFalhas}`);
  linhas.push(`Frentes filhas: ${m.frentesFilhas} · trabalhos de rotina: ${m.trabalhosDeRotina}`);
  if (m.tarefas !== null) {
    linhas.push("");
    linhas.push(`Tarefas (ADR-192) por estado: ${m.tarefas.length === 0 ? "nenhuma" : m.tarefas.map((t) => `${t.estado} ${t.n}`).join(" · ")}`);
    linhas.push(`Threads: ${m.threads ?? 0} · trabalhos ligados a uma Tarefa: ${m.trabalhosLigados ?? 0}`);
  }
  return linhas;
}

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "medir_tarefas_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const db = criarDb(url, { max: 1 });
  let total = medidaVazia();
  let pessoas = 0;
  try {
    await paraCadaPessoa(
      db,
      (escopo, tx) => tx(async (trx) => {
        await trx`set local transaction_read_only = on`;
        total = somarMedidas(total, await medirTarefasDaPessoa(trx, escopo));
        pessoas += 1;
      }),
      { aoFalhar: (_escopo, erro) => { throw erro; }, sortearInicio: () => 0 },
    );
  } finally {
    await db.end({ timeout: 2 });
  }
  const banco = new URL(url);
  for (const l of relatorioDeTarefas(total, `Banco: ${banco.host}${banco.pathname} · ${pessoas} pessoas · só leitura, só contagens`)) process.stdout.write(`${l}\n`);
  log("info", "medir_tarefas", { pessoas, terminadas: total.tarefasTerminadas, com_falta: total.tarefasTerminadasComFalta, cards: total.cards, tarefas: total.tarefas?.reduce((s, t) => s + t.n, 0) ?? null });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();

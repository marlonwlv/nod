import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Relogio } from "../../shared/types.ts";
import { backfillTarefasLote, LOTE_DO_BACKFILL, type ResultadoDoLote } from "../../use-cases/backfill-tarefas.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 4): o backfill das Tarefas antigas, por pessoa, um lote por transação (o que
 * caiu no meio é refeito; o que já foi gravado fica — a chave de origem não deixa duplicar). Roda pelo script
 * (`scripts/backfill-tarefas.ts`, simulação por padrão) e, no servidor, uma vez por boot (`iniciarBackfillTarefas`),
 * desligável com `NOD_TAREFAS_BACKFILL=0`.
 */

export type TotalDoBackfill = Omit<ResultadoDoLote, "cursor"> & { pessoas: number; falhas: number };

export function totalVazio(): TotalDoBackfill {
  return { lidos: 0, criadas: 0, ligados: 0, cards: 0, herdados: 0, turnosLigados: 0, fora: {}, pessoas: 0, falhas: 0 };
}

function somar(t: TotalDoBackfill, r: ResultadoDoLote): void {
  t.lidos += r.lidos;
  t.criadas += r.criadas;
  t.ligados += r.ligados;
  t.cards += r.cards;
  t.herdados += r.herdados;
  t.turnosLigados += r.turnosLigados;
  for (const [k, n] of Object.entries(r.fora)) t.fora[k] = (t.fora[k] ?? 0) + n;
}

export async function rodarBackfillTarefas(db: Db, o: { aplicar: boolean; agora?: Relogio; limite?: number; listarPessoas?: OpcoesLaco["listarPessoas"]; deveParar?: () => boolean }): Promise<TotalDoBackfill> {
  const agora = o.agora ?? (() => Date.now());
  const total = totalVazio();
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      total.pessoas += 1;
      let cursor: ResultadoDoLote["cursor"] = null;
      do {
        if (o.deveParar?.()) return;
        // Cada lote numa transação própria da pessoa (o `tx` abre uma nova a cada chamada).
        const r: ResultadoDoLote = await tx((trx) => backfillTarefasLote({ repos: criarRepos(trx, escopo), escopo, agora }, { depois: cursor, limite: o.limite ?? LOTE_DO_BACKFILL, aplicar: o.aplicar }));
        somar(total, r);
        cursor = r.cursor;
      } while (cursor);
    },
    {
      ...(o.listarPessoas ? { listarPessoas: o.listarPessoas } : {}),
      sortearInicio: () => 0,
      aoFalhar: (escopo, erro) => {
        total.falhas += 1;
        log("erro", "backfill_tarefas_falhou", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId, erro: erro instanceof Error ? erro.name : "desconhecido" });
      },
    },
  );
  return total;
}

/** Os números do backfill no log (só contagens). */
export function logarBackfill(evento: string, t: TotalDoBackfill, extra: Record<string, string | number | boolean> = {}): void {
  log("info", evento, { ...extra, pessoas: t.pessoas, lidos: t.lidos, criadas: t.criadas, ligados: t.ligados, cards: t.cards, herdados: t.herdados, turnos_ligados: t.turnosLigados, falhas: t.falhas, fora: JSON.stringify(t.fora) });
}

/** definido em 2026-11-22: espera depois de ligar os laços, para o backfill não disputar o banco com o boot. */
export const ATRASO_DO_BACKFILL_MS = 120_000;

/**
 * Uma passada por boot, depois de `atrasoMs`: as Tarefas novas já nascem ligadas (etapa 2), então só o histórico precisa
 * dela, e rodar de novo é barato (os já ligados saem da consulta). `parar()` cancela o que ainda não começou e interrompe
 * entre lotes.
 */
export function iniciarBackfillTarefas(db: Db, o: { atrasoMs?: number; agora?: Relogio; listarPessoas?: OpcoesLaco["listarPessoas"] } = {}): { parar(): Promise<void> } {
  let parado = false;
  let rodando: Promise<void> | null = null;
  const timer = setTimeout(() => {
    rodando = (async () => {
      const inicio = Date.now();
      try {
        const t = await rodarBackfillTarefas(db, { aplicar: true, ...(o.agora ? { agora: o.agora } : {}), ...(o.listarPessoas ? { listarPessoas: o.listarPessoas } : {}), deveParar: () => parado });
        logarBackfill("backfill_tarefas", t, { duracao_ms: Date.now() - inicio, interrompido: parado });
      } catch (e) {
        log("erro", "backfill_tarefas_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
      }
    })();
  }, o.atrasoMs ?? ATRASO_DO_BACKFILL_MS);
  timer.unref?.();
  return {
    async parar() {
      parado = true;
      clearTimeout(timer);
      await rodando;
    },
  };
}

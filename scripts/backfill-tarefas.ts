import { fileURLToPath } from "node:url";
import { logarBackfill, rodarBackfillTarefas } from "../src/adapters/fundo/backfill-tarefas.ts";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import type { Db } from "../src/shared/types.ts";
import { medidaVazia, medirTarefasDaPessoa, relatorioDeTarefas, somarMedidas, type MedidaDeTarefas } from "./medir-tarefas.ts";

/**
 * ADR-192 (definido em 2026-11-22, etapa 4): o backfill das Tarefas antigas, com o relatório de contagens antes e depois.
 *
 *   node scripts/backfill-tarefas.ts            # simulação: diz o que faria, não grava nada
 *   node scripts/backfill-tarefas.ts --aplicar  # grava (idempotente: rodar de novo não duplica)
 *
 * O servidor roda a mesma passada uma vez por boot (NOD_TAREFAS_BACKFILL=0 desliga); este script é para medir e para
 * rodar fora do boot. Só contagens saem do processo.
 */

async function medir(db: Db): Promise<MedidaDeTarefas> {
  let total = medidaVazia();
  await paraCadaPessoa(db, (escopo, tx) => tx(async (trx) => {
    await trx`set local transaction_read_only = on`;
    total = somarMedidas(total, await medirTarefasDaPessoa(trx, escopo));
  }), { aoFalhar: (_e, erro) => { throw erro; }, sortearInicio: () => 0 });
  return total;
}

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "backfill_tarefas_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const aplicar = process.argv.includes("--aplicar");
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  const db = criarDb(url, { max: 1 });
  try {
    const banco = new URL(url);
    for (const l of relatorioDeTarefas(await medir(db), `ANTES — ${banco.host}${banco.pathname}`)) escrever(l);
    const t = await rodarBackfillTarefas(db, { aplicar });
    escrever("");
    escrever(`${aplicar ? "APLICADO" : "SIMULAÇÃO (nada gravado; use --aplicar)"}: ${t.pessoas} pessoas · ${t.lidos} trabalhos lidos · ${t.criadas} Tarefas novas (${t.cards} de Card) · ${t.ligados} trabalhos ligados · ${t.herdados} herdaram da mãe · ${t.turnosLigados} turnos na Thread · falhas ${t.falhas}`);
    escrever(`Fora: ${Object.entries(t.fora).map(([k, n]) => `${k} ${n}`).join(" · ") || "nenhum"}`);
    escrever("");
    if (aplicar) for (const l of relatorioDeTarefas(await medir(db), "DEPOIS")) escrever(l);
    logarBackfill("backfill_tarefas_script", t, { aplicar });
    if (t.falhas > 0) process.exitCode = 1;
  } finally {
    await db.end({ timeout: 2 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();

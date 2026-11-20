// Resumo de um trace do Chrome gravado com CARGA_TRACE_S (scripts/carga-tela/medir.ts): os recálculos de estilo
// (UpdateLayoutTree) por tamanho — quantos elementos cada um visitou — e o que os invalidou (o seletor ou o motivo, e
// o nó). Use para achar por que um recálculo custa caro: um só nó mudando não devia visitar a página inteira.
//
//   node scripts/carga-tela/trace.ts <arquivo.trace.json>
import { readFileSync } from "node:fs";

type Evento = { name: string; ph: string; ts: number; dur?: number; args?: { data?: Record<string, unknown>; elementCount?: number; beginData?: Record<string, unknown> } };
const arquivo = process.argv[2];
if (!arquivo) throw new Error("uso: node scripts/carga-tela/trace.ts <arquivo.trace.json>");
const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as { traceEvents?: Evento[] } | Evento[];
const eventos = Array.isArray(bruto) ? bruto : bruto.traceEvents ?? [];

const recalc = eventos.filter((e) => e.name === "UpdateLayoutTree" && e.ph === "X");
const total = recalc.reduce((a, e) => a + (e.dur ?? 0), 0) / 1000;
const elementos = recalc.map((e) => Number(e.args?.elementCount ?? 0));
process.stdout.write(`UpdateLayoutTree: ${recalc.length}× · ${Math.round(total)} ms · elementos por recálculo p50/p90/max ${pct(elementos, 50)}/${pct(elementos, 90)}/${Math.max(0, ...elementos)}\n`);

const motivos = new Map<string, { n: number }>();
for (const e of eventos) {
  if (!/InvalidationTracking/.test(e.name)) continue;
  const d = e.args?.data ?? {};
  const chave = `${e.name.replace("InvalidationTracking", "")} · ${String(d.reason ?? d.changedClass ?? d.changedAttribute ?? d.changedId ?? d.changedPseudo ?? d.invalidatedSelectorId ?? "")} · ${String(d.nodeName ?? "")}`.slice(0, 200);
  const x = motivos.get(chave) ?? { n: 0 };
  x.n++;
  motivos.set(chave, x);
}
process.stdout.write("invalidações mais frequentes:\n");
for (const [k, v] of [...motivos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) process.stdout.write(`  ${v.n}  ${k}\n`);

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))] ?? 0;
}

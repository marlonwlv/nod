// XUM-11: agrega os resultados.jsonl do eval (avaliar.ts) numa tabela antes x depois por modelo: acerto (média e
// variação entre rodadas), argumento certo, passos, erros, chamadas de app erradas, tokens de entrada e latência; e o
// placar por pedido, para achar o caso que piorou.
// Uso: npx tsx scripts/catalogo-apps/relatorio.ts <resultados.jsonl> [<outro.jsonl> ...] [--md saida.md]
import { readFileSync, writeFileSync } from "node:fs";

type Linha = { harness: string; modelo: string; condicao: "antes" | "depois"; pedido: string; tipo: string; rodada: number; acerto: boolean; argOk: boolean | null; passos: number; erros: number; escritaErrada: number; buscas: number; ms: number; tokensEntrada: number; falha: string | null };
const args = process.argv.slice(2);
const iMd = args.indexOf("--md");
const arquivos = args.filter((a, i) => a !== "--md" && (iMd < 0 || i !== iMd + 1));
const linhas = arquivos.flatMap((a) => readFileSync(a, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Linha));

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mil = (x: number) => Math.round(x).toLocaleString("pt-BR");
const saida: string[] = [];
const grupos = [...new Set(linhas.map((l) => `${l.harness}/${l.modelo}`))];

saida.push("| Modelo | Condição | Acerto (média) | Acerto por rodada | Argumento certo | Passos (média) | Erros/exec | Escrita errada | Tokens de entrada (média) | Latência (média) | Execuções |", "|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|");
for (const g of grupos) {
  for (const condicao of ["antes", "depois"] as const) {
    const ls = linhas.filter((l) => `${l.harness}/${l.modelo}` === g && l.condicao === condicao);
    if (!ls.length) continue;
    const rodadas = [...new Set(ls.map((l) => l.rodada))].sort();
    const porRodada = rodadas.map((r) => media(ls.filter((l) => l.rodada === r).map((l) => Number(l.acerto))));
    const comArg = ls.filter((l) => l.argOk !== null);
    saida.push(`| ${g} | ${condicao} | ${pct(media(ls.map((l) => Number(l.acerto))))} | ${porRodada.map(pct).join(" · ")} (±${Math.round((Math.max(...porRodada) - Math.min(...porRodada)) * 50)} p.p.) | ${pct(media(comArg.map((l) => Number(l.argOk))))} | ${media(ls.map((l) => l.passos)).toFixed(1)} | ${media(ls.map((l) => l.erros)).toFixed(2)} | ${ls.reduce((s, l) => s + l.escritaErrada, 0)} | ${mil(media(ls.map((l) => l.tokensEntrada)))} | ${(media(ls.map((l) => l.ms)) / 1000).toFixed(1)} s | ${ls.length}${ls.some((l) => l.falha) ? ` (${ls.filter((l) => l.falha).length} com falha do CLI)` : ""} |`);
  }
}

saida.push("", "Acerto por tipo de pedido:", "", "| Modelo | Tipo | Antes | Depois |", "|---|---|---:|---:|");
for (const g of grupos) for (const tipo of ["comum", "raro", "sem_ferramenta", "lugar"]) {
  const de = (c: string) => linhas.filter((l) => `${l.harness}/${l.modelo}` === g && l.condicao === c && l.tipo === tipo);
  const a = de("antes"); const d = de("depois");
  if (a.length || d.length) saida.push(`| ${g} | ${tipo} | ${a.filter((l) => l.acerto).length}/${a.length} | ${d.filter((l) => l.acerto).length}/${d.length} |`);
}

saida.push("", "Por pedido (acertos antes → depois; os que pioraram primeiro):", "", "| Modelo | Pedido | Tipo | Antes | Depois | Passos antes → depois |", "|---|---|---|---:|---:|---|");
const porPedido: { g: string; pedido: string; tipo: string; a: number; d: number; na: number; nd: number; pa: number; pd: number }[] = [];
for (const g of grupos) for (const pedido of [...new Set(linhas.map((l) => l.pedido))]) {
  const de = (c: string) => linhas.filter((l) => `${l.harness}/${l.modelo}` === g && l.condicao === c && l.pedido === pedido);
  const a = de("antes"); const d = de("depois");
  if (!a.length && !d.length) continue;
  porPedido.push({ g, pedido, tipo: (a[0] ?? d[0])!.tipo, a: a.filter((l) => l.acerto).length, d: d.filter((l) => l.acerto).length, na: a.length, nd: d.length, pa: media(a.map((l) => l.passos)), pd: media(d.map((l) => l.passos)) });
}
porPedido.sort((x, y) => (x.d / Math.max(1, x.nd) - x.a / Math.max(1, x.na)) - (y.d / Math.max(1, y.nd) - y.a / Math.max(1, y.na)));
for (const p of porPedido) saida.push(`| ${p.g} | ${p.pedido} | ${p.tipo} | ${p.a}/${p.na} | ${p.d}/${p.nd} | ${p.pa.toFixed(1)} → ${p.pd.toFixed(1)} |`);

const texto = saida.join("\n");
process.stdout.write(`${texto}\n`);
if (iMd >= 0 && args[iMd + 1]) writeFileSync(args[iMd + 1]!, `${texto}\n`);

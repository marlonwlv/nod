// XUM-11: mede o que o plano de um turno manda ao modelo para os bots típicos (bots.ts): número de ferramentas,
// caracteres de esquema (o que o proxy lista em tools/list), o prompt e a seção apps, e tokens estimados (chars / 4).
// Uso: npx tsx scripts/catalogo-apps/medir.ts [antes|depois] [--json saida.json]
//   antes  = o catálogo inteiro (NOD_APPS_SOB_DEMANDA=0)
//   depois = diretas por app + apps_buscar/apps_usar (o padrão)
import { writeFileSync } from "node:fs";
import { montarPlano } from "../../src/domain/plano-turno.ts";
import { composicaoDoPlano } from "../../src/domain/raio-x.ts";
import { CENARIOS, entradaDoCenario } from "./bots.ts";

const modo = process.argv[2] === "antes" ? "antes" : "depois";
const iJson = process.argv.indexOf("--json");
const TOKENS = (chars: number) => Math.round(chars / 4);

type Linha = { cenario: string; titulo: string; ferramentas: number; esquemaChars: number; promptChars: number; appsChars: number; tokensTurno: number; grupos: { grupo: string; quantidade: number; chars: number; sobDemanda?: number }[] };
const linhas: Linha[] = [];
for (const c of CENARIOS) {
  const rotina = Object.entries(c.rotina ?? {}).map(([conector, capacidades]) => ({ conector, capacidades }));
  const plano = montarPlano(entradaDoCenario(c, { extra: { appsSobDemanda: modo === "antes" ? null : { teto: 12, usadas: {}, rotina } } }));
  const comp = composicaoDoPlano({ ...plano, machineId: "m", tokenDeTurno: "t" }, { modo: "conversa", comTexto: false });
  const esquemaChars = comp.ferramentas.reduce((s, g) => s + g.chars, 0);
  const appsChars = comp.prompt.find((p) => p.secao === "apps")?.chars ?? 0;
  linhas.push({ cenario: c.id, titulo: c.titulo, ferramentas: plano.catalogo.ferramentas.length, esquemaChars, promptChars: plano.promptSistema.length, appsChars, tokensTurno: TOKENS(esquemaChars + plano.promptSistema.length), grupos: comp.ferramentas.map((g) => ({ grupo: g.grupo, quantidade: g.quantidade, chars: g.chars, ...(g.sobDemanda ? { sobDemanda: g.sobDemanda } : {}) })) });
}
const fmt = (n: number) => n.toLocaleString("pt-BR");
process.stdout.write(`\n## ${modo === "antes" ? "Antes (catálogo inteiro)" : "Depois (sob demanda)"}\n\n| Cenário | Ferramentas | Esquemas (chars) | Prompt (chars) | Seção apps | Tokens/turno (≈) |\n|---|---:|---:|---:|---:|---:|\n`);
for (const l of linhas) process.stdout.write(`| ${l.titulo} | ${fmt(l.ferramentas)} | ${fmt(l.esquemaChars)} | ${fmt(l.promptChars)} | ${fmt(l.appsChars)} | ${fmt(l.tokensTurno)} |\n`);
process.stdout.write("\nGrupos (cenário assistente):\n");
for (const g of linhas.find((l) => l.cenario === "assistente")?.grupos ?? []) process.stdout.write(`  ${g.grupo}: ${g.quantidade} ferramentas, ${fmt(g.chars)} chars${g.sobDemanda ? `, ${g.sobDemanda} sob demanda` : ""}\n`);
if (iJson > 0 && process.argv[iJson + 1]) writeFileSync(process.argv[iJson + 1]!, JSON.stringify({ modo, linhas }, null, 2));

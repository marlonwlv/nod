import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aplicarShellVisual, recuperarShellVisual, verificarShellVisual } from "../../infra/computador/shell-visual.mjs";

function valor(args: string[], nome: string): string | null { const i = args.indexOf(nome); return i >= 0 ? (args[i + 1] ?? null) : null; }
function obrigatorio(args: string[], nome: string): string { const v = valor(args, nome); if (!v) throw new Error(`falta ${nome}`); return resolve(v); }

export async function main(args = process.argv.slice(2)): Promise<number> {
  const comando = args[0]; const estado = obrigatorio(args, "--estado"); let resultado: unknown;
  if (comando === "preparar") resultado = await aplicarShellVisual({ origem: obrigatorio(args, "--origem"), estado, versao: valor(args, "--versao") ?? "" });
  else if (comando === "verificar") resultado = await verificarShellVisual({ estado });
  else if (comando === "recuperar") resultado = await recuperarShellVisual({ estado });
  else throw new Error("use preparar, verificar ou recuperar");
  process.stdout.write(`${JSON.stringify(resultado)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });

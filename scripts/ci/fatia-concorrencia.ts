/**
 * definido em 2026-11-04: a CI divide os testes de concorrência (que rodam em série, singleFork) em jobs paralelos. Este
 * script imprime, um por linha, os arquivos de uma fatia, para o `vitest run --project concurrency <arquivos>`:
 *
 *   node scripts/ci/fatia-concorrencia.ts 1/2     # a metade 1 de 2, sem os arquivos de navegador
 *   node scripts/ci/fatia-concorrencia.ts navegador  # só os que precisam do Chromium (todos)
 *   node scripts/ci/fatia-concorrencia.ts navegador:1/2  # a metade 1 deles (jobs `navegador N/2`)
 *
 * Os arquivos de navegador (`*-chrome`, a tela.capturar e o bot de QA) ficam fora das fatias numeradas porque pedem a
 * web montada e o Chromium. A distribuição é gulosa pelo tamanho do arquivo (do maior para o menor, cada um na fatia
 * mais leve): determinística e, medido em 2026-11-04 contra os tempos reais da main, equilibra melhor que o rodízio
 * alfabético (6,9 min × 4,3 min, contra 3,4 × 7,8; o tamanho correlaciona 0,67 com o tempo). Por que um script e não
 * `--exclude`/`--shard` do vitest: com projetos, o `--exclude` da linha de comando não entra no `include` do projeto,
 * e a lista explícita é conferível (`vitest list`).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const PASTA = "tests/concurrency";

/** Precisam do Chromium (NOD_CHROME) e da web montada: rodam só no job `navegador`. */
export function ehDeNavegador(arquivo: string): boolean {
  return /-chrome\.test\.ts$/.test(arquivo) || /\/(tela-capturar|qa-pelas-acoes)\.test\.ts$/.test(arquivo);
}

export type Arquivo = { caminho: string; bytes: number };

export function listarArquivos(raiz: string): Arquivo[] {
  return readdirSync(join(raiz, PASTA))
    .filter((n) => n.endsWith(".test.ts"))
    .sort()
    .map((n) => ({ caminho: `${PASTA}/${n}`, bytes: statSync(join(raiz, PASTA, n)).size }));
}

/**
 * A fatia `n` de `total` (1-based) dos arquivos sem navegador: do maior para o menor, cada arquivo vai para a fatia
 * mais leve até ali (empate: a de menor índice). "navegador" devolve os outros; "navegador:N/TOTAL" divide esses do
 * mesmo jeito (definido em 2026-11-17: o job navegador era o mais lento da CI, 8,5 min, e passou a duas fatias). A
 * saída vem em ordem alfabética.
 */
export function fatia(arquivos: Arquivo[], pedido: string): string[] {
  const deNavegador = arquivos.filter((a) => ehDeNavegador(a.caminho));
  if (pedido === "navegador") return deNavegador.map((a) => a.caminho);
  const m = /^(navegador:)?([1-9]\d*)\/([1-9]\d*)$/.exec(pedido);
  if (!m) throw new Error(`fatia inválida: ${pedido} (use N/TOTAL, ex. 1/2, navegador ou navegador:N/TOTAL)`);
  const n = Number(m[2]);
  const total = Number(m[3]);
  if (n > total) throw new Error(`fatia ${n} maior que o total ${total}`);
  return distribuir(m[1] ? deNavegador : arquivos.filter((a) => !ehDeNavegador(a.caminho)), total)[n - 1]!.sort();
}

/** Gulosa pelo tamanho: do maior para o menor, cada arquivo vai para a fatia mais leve até ali (empate: a de menor índice). */
function distribuir(arquivos: Arquivo[], total: number): string[][] {
  const carga = new Array<number>(total).fill(0);
  const fatias = Array.from({ length: total }, () => [] as string[]);
  const porTamanho = [...arquivos].sort((a, b) => b.bytes - a.bytes || a.caminho.localeCompare(b.caminho));
  for (const a of porTamanho) {
    const i = carga.indexOf(Math.min(...carga));
    fatias[i]!.push(a.caminho);
    carga[i]! += a.bytes;
  }
  return fatias;
}

if (process.argv[1]?.endsWith("fatia-concorrencia.ts")) {
  const pedido = process.argv[2] ?? "";
  const lista = fatia(listarArquivos(process.cwd()), pedido);
  if (lista.length === 0) {
    process.stderr.write(`fatia ${pedido} vazia\n`);
    process.exit(1);
  }
  process.stdout.write(lista.join("\n") + "\n");
}

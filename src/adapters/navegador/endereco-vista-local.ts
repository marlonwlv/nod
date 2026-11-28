import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARQUIVO_VISTA_LOCAL, type EnderecoVistaLocal } from "../../contracts/navegador-local.ts";

/**
 * 2026-11-28: no PC o navegador do bot roda no motor e a janela é do app (dois processos). O motor grava onde a vista
 * local ouve num arquivo da pasta do executor (só da pessoa, como `atividade.json` do computador dela); o app lê a cada
 * vista aberta (o motor pode ter reiniciado com outra porta e outro token). No Mac é o mesmo processo e nada disto roda.
 */
export async function gravarEnderecoVistaLocal(pasta: string, e: EnderecoVistaLocal): Promise<void> {
  const arquivo = join(pasta, ARQUIVO_VISTA_LOCAL);
  const temp = `${arquivo}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ porta: e.porta, token: e.token, pid: process.pid }), { mode: 0o600 });
  await rename(temp, arquivo);
}

export async function lerEnderecoVistaLocal(pasta: string): Promise<EnderecoVistaLocal | null> {
  try {
    const d = JSON.parse(await readFile(join(pasta, ARQUIVO_VISTA_LOCAL), "utf8")) as { porta?: unknown; token?: unknown };
    if (typeof d.porta !== "number" || !Number.isInteger(d.porta) || d.porta < 1 || d.porta > 65535) return null;
    if (typeof d.token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(d.token)) return null;
    return { porta: d.porta, token: d.token };
  } catch {
    return null;
  }
}

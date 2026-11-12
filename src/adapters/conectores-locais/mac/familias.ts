import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FAMILIAS_MAC, type FamiliaMac, type FamiliasMacLigadas } from "../../../contracts/desktop-mac.ts";

/**
 * ADR-171 (definido em 2026-11-12): os liga/desliga das famílias de ferramentas do Mac. Quem grava é o app do Mac
 * (Ajustes > Computador); quem lê, a cada chamada, é o proxy MCP do turno, que roda no mesmo Mac. O arquivo mora no
 * HOME da pessoa (`~/.nod/ferramentas-mac.json`, 0600), num caminho fixo: o proxy recebe do CLI só NOD_URL e o token
 * do turno (mcp-config.ts), não o userData do Electron nem o NOD_HOME do executor do app.
 *
 * Fail-closed: sem arquivo, arquivo corrompido ou chave ausente = DESLIGADA. Só `true` literal liga.
 */
export const ARQUIVO_FAMILIAS_MAC = "ferramentas-mac.json";

export const TODAS_DESLIGADAS: FamiliasMacLigadas = Object.freeze(Object.fromEntries(FAMILIAS_MAC.map((f) => [f, false])) as Record<FamiliaMac, boolean>);

export function lerFamiliasMac(conteudo: string | null): FamiliasMacLigadas {
  let lido: unknown = null;
  try {
    lido = conteudo === null ? null : JSON.parse(conteudo);
  } catch {
    // corrompido: tudo desligado
  }
  const obj = typeof lido === "object" && lido !== null && !Array.isArray(lido) ? (lido as Record<string, unknown>) : {};
  return Object.fromEntries(FAMILIAS_MAC.map((f) => [f, obj[f] === true])) as Record<FamiliaMac, boolean>;
}

export function ehFamiliaMac(x: unknown): x is FamiliaMac {
  return typeof x === "string" && (FAMILIAS_MAC as readonly string[]).includes(x);
}

export function caminhoFamiliasMac(home: string): string {
  return join(home, ".nod", ARQUIVO_FAMILIAS_MAC);
}

export async function carregarFamiliasMac(home: string): Promise<FamiliasMacLigadas> {
  return lerFamiliasMac(await readFile(caminhoFamiliasMac(home), "utf8").catch(() => null));
}

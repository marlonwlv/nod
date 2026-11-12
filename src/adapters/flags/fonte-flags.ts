import { readFileSync, statSync } from "node:fs";
import { avaliarFlags, lerRegras, type RegraFlag, type ValorFlag } from "../../domain/flags-remotas.ts";
import { log } from "../../obs/log.ts";

/**
 * ADR-170 (definido em 2026-11-12): de onde vêm as regras das flags remotas. `NOD_FLAGS_ARQUIVO` (um JSON no servidor,
 * relido quando o mtime muda, conferido no máximo a cada 5 s) ganha de `NOD_FLAGS` (o JSON no env, lido no boot).
 * Arquivo inválido NÃO apaga as regras: fica a última válida e um aviso `flags_invalidas` no log (um erro de digitação
 * não pode desligar a versão de teste de todo mundo de uma vez).
 */
export type FonteDeFlags = { avaliar(escopo: { tenantId: string; pessoaId: string }): Record<string, ValorFlag>; regras(): readonly RegraFlag[] };

const INTERVALO_MS = 5000;

export function criarFonteDeFlags(o: {
  env: Readonly<Record<string, string | undefined>>;
  agora?: () => number;
  ler?: (caminho: string) => string;
  mtime?: (caminho: string) => number | null;
}): FonteDeFlags {
  const agora = o.agora ?? Date.now;
  const ler = o.ler ?? ((c: string) => readFileSync(c, "utf8"));
  const mtime = o.mtime ?? ((c: string) => { try { return statSync(c).mtimeMs; } catch { return null; } });
  const arquivo = o.env.NOD_FLAGS_ARQUIVO?.trim() || null;
  let regras: RegraFlag[] = [];
  if (o.env.NOD_FLAGS?.trim()) {
    try {
      regras = lerRegras(o.env.NOD_FLAGS);
    } catch (e) {
      log("aviso", "flags_invalidas", { origem: "env", causa: e instanceof Error && typeof e.cause === "string" ? e.cause : "invalido" });
    }
  }
  let visto: number | null = null;
  let conferidoEm = -Infinity;
  function atualizar() {
    if (!arquivo || agora() - conferidoEm < INTERVALO_MS) return;
    conferidoEm = agora();
    const m = mtime(arquivo);
    if (m === null || m === visto) return;
    visto = m;
    try {
      regras = lerRegras(ler(arquivo));
      log("info", "flags_recarregadas", { regras: regras.length });
    } catch (e) {
      log("aviso", "flags_invalidas", { origem: "arquivo", causa: e instanceof Error && typeof e.cause === "string" ? e.cause : "invalido" });
    }
  }
  return {
    regras() { atualizar(); return regras; },
    avaliar(escopo) {
      atualizar();
      return avaliarFlags(regras, { pessoaId: escopo.pessoaId, tenantId: escopo.tenantId, agora: agora() });
    },
  };
}

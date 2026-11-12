import { ErroDeDominio } from "./erro.ts";

/**
 * ADR-170 (definido em 2026-11-12): flags remotas por pessoa, sem publicar versão. O Grok Bot usa o Statsig (gates e
 * configs dinâmicas); o nod começa com regras num JSON do servidor (`NOD_FLAGS` ou o arquivo `NOD_FLAGS_ARQUIVO`, relido
 * quando muda) e as entrega por `GET /api/t/:t/flags` a web e ao app. Trocar uma regra vale no próximo pedido de cada
 * pessoa — sem build, sem release, sem reiniciar o servidor.
 *
 * Uma regra liga um VALOR numa flag para um público: pessoas, tenants, uma porcentagem estável (o mesmo balde para a
 * mesma pessoa e flag) e um prazo. A PRIMEIRA regra que casa ganha; nenhuma casa, vale o padrão do catálogo.
 * Puro: o relógio vem de fora e o balde é um hash FNV-1a (sem node:crypto).
 */
export type ValorFlag = boolean | string | number;
export type RegraFlag = { flag: string; valor: ValorFlag; pessoas?: string[]; tenants?: string[]; porcentagem?: number; ate?: number };
export type ContextoFlags = { pessoaId: string; tenantId: string; agora: number };

/** As flags que o código conhece, com o padrão. Flag fora daqui também é entregue (experimentos da web), mas sem padrão. */
export const FLAGS_CONHECIDAS = {
  /** O canal de atualização do app: `estavel` ou `teste` (a versão de teste do ADR-170). */
  "app.canal": "estavel",
  /** A web mostra as telas novas do estilo Grok (frentes, pílula, quadro) a quem está no teste. */
  "web.telas_novas": false,
} as const satisfies Record<string, ValorFlag>;

const NOME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const TETO_REGRAS = 500;

/** As regras do JSON; o que não é regra válida derruba o arquivo inteiro (erro de digitação não vira meia configuração). */
export function lerRegras(bruto: string): RegraFlag[] {
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    throw new ErroDeDominio("entrada_invalida", { cause: "NOD_FLAGS não é JSON" });
  }
  const lista = Array.isArray(lido) ? lido : (lido && typeof lido === "object" && Array.isArray((lido as { regras?: unknown }).regras) ? (lido as { regras: unknown[] }).regras : null);
  if (!lista || lista.length > TETO_REGRAS) throw new ErroDeDominio("entrada_invalida", { cause: "NOD_FLAGS deve ser uma lista de regras" });
  return lista.map((r, i) => {
    const x = r as Record<string, unknown>;
    const ok = !!x && typeof x === "object" && typeof x.flag === "string" && NOME.test(x.flag) && x.flag.length <= 64
      && (typeof x.valor === "boolean" || typeof x.valor === "number" || (typeof x.valor === "string" && x.valor.length <= 200))
      && (x.pessoas === undefined || (Array.isArray(x.pessoas) && x.pessoas.every((p) => typeof p === "string")))
      && (x.tenants === undefined || (Array.isArray(x.tenants) && x.tenants.every((p) => typeof p === "string")))
      && (x.porcentagem === undefined || (typeof x.porcentagem === "number" && x.porcentagem >= 0 && x.porcentagem <= 100))
      && (x.ate === undefined || typeof x.ate === "string" || typeof x.ate === "number");
    if (!ok) throw new ErroDeDominio("entrada_invalida", { cause: `NOD_FLAGS: regra ${i} inválida` });
    const ate = x.ate === undefined ? undefined : typeof x.ate === "number" ? x.ate : Date.parse(x.ate as string);
    if (ate !== undefined && !Number.isFinite(ate)) throw new ErroDeDominio("entrada_invalida", { cause: `NOD_FLAGS: regra ${i} com prazo inválido` });
    return {
      flag: x.flag as string,
      valor: x.valor as ValorFlag,
      ...(x.pessoas ? { pessoas: (x.pessoas as string[]).map((p) => p.toLowerCase()) } : {}),
      ...(x.tenants ? { tenants: (x.tenants as string[]).map((p) => p.toLowerCase()) } : {}),
      ...(x.porcentagem !== undefined ? { porcentagem: x.porcentagem as number } : {}),
      ...(ate !== undefined ? { ate } : {}),
    };
  });
}

/** 0–99, estável por pessoa e flag. */
export function baldeDe(pessoaId: string, flag: string): number {
  let h = 0x811c9dc5;
  for (const c of `${flag}:${pessoaId.toLowerCase()}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

function casa(r: RegraFlag, c: ContextoFlags): boolean {
  if (r.ate !== undefined && c.agora > r.ate) return false;
  if (r.pessoas && !r.pessoas.includes(c.pessoaId.toLowerCase())) return false;
  if (r.tenants && !r.tenants.includes(c.tenantId.toLowerCase())) return false;
  if (r.porcentagem !== undefined && baldeDe(c.pessoaId, r.flag) >= r.porcentagem) return false;
  return true;
}

export function avaliarFlags(regras: readonly RegraFlag[], c: ContextoFlags): Record<string, ValorFlag> {
  const saida: Record<string, ValorFlag> = { ...FLAGS_CONHECIDAS };
  const decididas = new Set<string>();
  for (const r of regras) {
    if (decididas.has(r.flag) || !casa(r, c)) continue;
    // Uma flag do catálogo só aceita valor do mesmo tipo do padrão (um "true" em texto não vira canal).
    const padrao = (FLAGS_CONHECIDAS as Record<string, ValorFlag>)[r.flag];
    if (padrao !== undefined && typeof padrao !== typeof r.valor) continue;
    if (r.flag === "app.canal" && r.valor !== "estavel" && r.valor !== "teste") continue;
    saida[r.flag] = r.valor;
    decididas.add(r.flag);
  }
  return saida;
}

export type CanalDoApp = "estavel" | "teste";
export const canalDasFlags = (f: Record<string, ValorFlag>): CanalDoApp => (f["app.canal"] === "teste" ? "teste" : "estavel");

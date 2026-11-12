import type { ModoAprovacao } from "../contracts/agente.ts";

/**
 * A configuração gerenciada por MDM (ADR-178; user defaults `DeploymentBackendUrl`/`DeploymentWebsiteUrl` e
 * `policy.json`). A empresa instala o app apontado para o servidor dela e trava o que o admin decidiu. O app do Mac lê os
 * valores (desktop/mdm.ts, atrás de `NOD_MDM=1`) e esta função decide o que vale. Só ORIGEM https (sem caminho, consulta,
 * usuário ou senha): uma URL com caminho viraria um lugar para injetar rota, e http mandaria a sessão em claro.
 * O que não serve é ignorado com o erro escrito (o app sobe com o padrão, nunca com meia política). Puro.
 */
export type PoliticaMdm = {
  backendUrl?: string;
  websiteUrl?: string;
  /** O teto do modo de aprovação (teto local de permissão): nenhum bot passa dele. */
  tetoModoAprovacao?: ModoAprovacao;
  /** As ferramentas do Mac (Mail, Mensagens, tela) ficam desligadas e a pessoa não liga. */
  ferramentasDoMacTravadas?: boolean;
  /** O teste grátis não aparece (a empresa paga). */
  semTesteGratis?: boolean;
};

const MODOS: readonly ModoAprovacao[] = ["manual", "automatico", "total"];

/** "https://nod.empresa.com" (com porta opcional), ou null. Barra final aceita e tirada. */
export function origemHttps(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\/$/, "");
  const m = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::(\d{1,5}))?$/i.exec(t);
  if (!m) return null;
  if (m[2] && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return null;
  return `https://${m[1]!.toLowerCase()}${m[2] ? `:${Number(m[2])}` : ""}`;
}

export function lerPoliticaMdm(e: { defaults: Readonly<Record<string, unknown>>; policyJson: unknown }): { politica: PoliticaMdm; erros: string[] } {
  const erros: string[] = [];
  const politica: PoliticaMdm = {};
  for (const [chave, campo] of [["DeploymentBackendUrl", "backendUrl"], ["DeploymentWebsiteUrl", "websiteUrl"]] as const) {
    const v = e.defaults[chave];
    if (v === undefined) continue;
    const o = origemHttps(v);
    if (o) politica[campo] = o;
    else erros.push(`${chave}: só origem https (https://host[:porta]), sem caminho`);
  }
  const p = e.policyJson;
  if (p !== null && p !== undefined) {
    if (typeof p !== "object" || Array.isArray(p)) erros.push("policy.json: não é um objeto");
    else {
      const o = p as Record<string, unknown>;
      if (o.tetoModoAprovacao !== undefined) {
        if (typeof o.tetoModoAprovacao === "string" && (MODOS as readonly string[]).includes(o.tetoModoAprovacao)) politica.tetoModoAprovacao = o.tetoModoAprovacao as ModoAprovacao;
        else erros.push("policy.json: tetoModoAprovacao é manual, automatico ou total");
      }
      for (const k of ["ferramentasDoMacTravadas", "semTesteGratis"] as const) {
        if (o[k] === undefined) continue;
        if (typeof o[k] === "boolean") politica[k] = o[k];
        else erros.push(`policy.json: ${k} é true ou false`);
      }
      const conhecidas = new Set(["tetoModoAprovacao", "ferramentasDoMacTravadas", "semTesteGratis"]);
      for (const k of Object.keys(o)) if (!conhecidas.has(k)) erros.push(`policy.json: chave desconhecida ${k} (ignorada)`);
    }
  }
  return { politica, erros };
}

/** O modo que vale: o pedido, limitado pelo teto do admin (manual < automatico < total). */
export function modoComTeto(pedido: ModoAprovacao, teto: ModoAprovacao | undefined): ModoAprovacao {
  if (!teto) return pedido;
  return MODOS.indexOf(pedido) <= MODOS.indexOf(teto) ? pedido : teto;
}

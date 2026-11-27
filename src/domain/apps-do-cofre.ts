import { variavelDeSistema } from "./credenciais-conector.ts";

import type { AppDoCofre, IdAppDoCofre } from "../contracts/apps-do-cofre.ts";

export type { AppDoCofre, IdAppDoCofre };

export const APPS_DO_COFRE: Readonly<Record<IdAppDoCofre, AppDoCofre>> = {
  orgo: {
    id: "orgo",
    nome: "Orgo",
    artigo: "a",
    variavel: "ORGO_API_KEY",
    para: "Controlar o computador da Orgo: tirar print, clicar, digitar e rodar comandos.",
    ondeAchar: { rotulo: "orgo.ai › API keys", url: "https://www.orgo.ai/api-keys" },
    dica: "sk_live_…",
  },
};

export const IDS_APPS_DO_COFRE = Object.keys(APPS_DO_COFRE) as IdAppDoCofre[];

export function appDoCofre(id: unknown): AppDoCofre | null {
  return typeof id === "string" && Object.hasOwn(APPS_DO_COFRE, id) ? APPS_DO_COFRE[id as IdAppDoCofre] : null;
}

/** O app pelo nome legível gravado no item ("Orgo"), para a tela saber se a chave é testável. */
export function appPeloNome(nome: string | null | undefined): AppDoCofre | null {
  return IDS_APPS_DO_COFRE.map((id) => APPS_DO_COFRE[id]).find((a) => a.nome === nome) ?? null;
}

/**
 * O título do cartão de credencial e do recibo dele (NOD-50; Paper O1: "Chave da Orgo"). Mora aqui para o servidor (recibo,
 * "Sua vez") e a tela dizerem o mesmo.
 */
export function tituloDoPedidoDeChave(p: { alvo: string; app: string; appId?: string | undefined }): string {
  if (p.alvo === "github_token") return "Token do GitHub";
  if (p.alvo === "composio") return "Chave do Composio do time";
  if (p.alvo === "app") return `Chave d${appDoCofre(p.appId)?.artigo ?? "o"} ${p.app}`;
  return `Chave para ${p.app}`;
}

/**
 * O nome da variável de uma chave do Cofre: maiúsculas, dígitos e _, como ORGO_API_KEY (é o que o programa lê no
 * ambiente). Variável de sistema (PATH, NODE_*, LD_*…) nunca: ela mudaria o processo, não o app.
 */
export function nomeDeVariavelDoCofre(nome: string): boolean {
  return /^[A-Z_][A-Z0-9_]{0,127}$/.test(nome) && !variavelDeSistema(nome);
}

/** Dicas da chave (Paper C3, "Diga ao bot quando usar esta chave"): o bot as lê; curtas de propósito. */
export const TETO_DICAS_DA_CHAVE = 200;

import { CAMINHO_BACKOFFICE, CAMINHO_BACKOFFICE_PADRAO, PARAMETRO_VOLTA } from "../../lib/backoffice.ts";

/**
 * As rotas da tela do backoffice (ADR-194), pelo caminho (history API, sem hash): `/backoffice/<secao>` e
 * `/backoffice/pessoas/:tenantId/:pessoaId`. O servidor serve o mesmo app em todas e confere a sessão antes.
 */
export type IdSecao = "uso" | "problemas" | "pessoas";

export type Rota = { secao: IdSecao; pessoa: null } | { secao: "pessoas"; pessoa: { tenantId: string; pessoaId: string } } | { secao: null; pessoa: null };

const SECOES: readonly IdSecao[] = ["uso", "problemas", "pessoas"];

export function lerRota(caminho: string): Rota {
  const partes = caminho.replace(/\/+$/, "").split("/").slice(1);
  if (partes[0] !== CAMINHO_BACKOFFICE.slice(1)) return { secao: null, pessoa: null };
  const [, secao, tenantId, pessoaId, ...resto] = partes;
  if (secao === undefined) return { secao: "uso", pessoa: null };
  if (!SECOES.includes(secao as IdSecao) || resto.length > 0) return { secao: null, pessoa: null };
  if (secao === "pessoas" && tenantId && pessoaId) return { secao: "pessoas", pessoa: { tenantId: decodeURIComponent(tenantId), pessoaId: decodeURIComponent(pessoaId) } };
  if (tenantId !== undefined) return { secao: null, pessoa: null };
  return { secao: secao as IdSecao, pessoa: null };
}

export const caminhoDaSecao = (id: IdSecao) => `${CAMINHO_BACKOFFICE}/${id}`;
export const caminhoDaPessoa = (p: { tenantId: string; pessoaId: string }) => `${CAMINHO_BACKOFFICE}/pessoas/${encodeURIComponent(p.tenantId)}/${encodeURIComponent(p.pessoaId)}`;

/** O login com volta para o caminho atual (o servidor faz o mesmo quando a página abre sem sessão). */
export const caminhoDoLogin = (atual: string) => `/?${new URLSearchParams({ [PARAMETRO_VOLTA]: atual.startsWith(CAMINHO_BACKOFFICE) ? atual : CAMINHO_BACKOFFICE_PADRAO }).toString()}`;

export const JANELAS = [7, 30, 90] as const;
export type Janela = (typeof JANELAS)[number];
export function lerJanela(busca: string): Janela {
  const n = Number(new URLSearchParams(busca).get("dias"));
  return (JANELAS as readonly number[]).includes(n) ? (n as Janela) : 30;
}

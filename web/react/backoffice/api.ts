import type { BackofficeEuDto, BackofficePessoasDto, BackofficeProblemasDto, PainelPessoaDto, PainelUsoDto } from "../../../src/contracts/backoffice.ts";

/**
 * A API do backoffice interno (ADR-194): tudo sob /api/backoffice, sem tenant na URL (a equipe olha todos os espaços).
 * O servidor confere a sessão e o papel a cada pedido: 401 = a sessão caiu (a tela manda ao login), 404 = não é da equipe.
 */
export class NaoEncontrado extends Error {}
export class SemSessao extends Error {}

export type ApiBackoffice = {
  eu: () => Promise<BackofficeEuDto>;
  uso: (dias: number) => Promise<PainelUsoDto>;
  problemas: (dias: number) => Promise<BackofficeProblemasDto>;
  pessoas: (dias: number) => Promise<BackofficePessoasDto>;
  pessoa: (tenantId: string, pessoaId: string, dias: number) => Promise<PainelPessoaDto>;
};

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (r.status === 401) throw new SemSessao();
  if (r.status === 404) throw new NaoEncontrado();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export function apiDoServidor(): ApiBackoffice {
  const base = "/api/backoffice";
  const e = encodeURIComponent;
  return {
    eu: () => json(`${base}/eu`),
    uso: (dias) => json(`${base}/uso?dias=${dias}`),
    problemas: (dias) => json(`${base}/problemas?dias=${dias}`),
    pessoas: (dias) => json(`${base}/pessoas?dias=${dias}`),
    pessoa: (tid, pid, dias) => json(`${base}/pessoas/${e(tid)}/${e(pid)}?dias=${dias}`),
  };
}

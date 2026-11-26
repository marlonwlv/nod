import type { IdAppDoCofre } from "../../domain/apps-do-cofre.ts";
import { BASE_ORGO } from "../computador/provedores/orgo.ts";

/**
 * O teste da chave de um app conhecido antes de guardar (ADR-195 §6, Paper C3 e O2/O3): uma chamada só de leitura com a
 * chave candidata. Roda FORA de transação (rede). O valor vai só no cabeçalho da chamada; nem ele nem a resposta do app
 * vão a log, erro ou retorno: o retorno é o veredito.
 *   - aceita: o app respondeu 2xx;
 *   - recusada: 401/403 (a chave não vale ou não tem permissão);
 *   - indisponivel: sem resposta, prazo, 429 ou 5xx (o cartão mostra "Tentar de novo").
 */
export type VereditoDaChave = "aceita" | "recusada" | "indisponivel";

export type TestarChave = (app: IdAppDoCofre, valor: string) => Promise<VereditoDaChave>;

export const PRAZO_TESTE_MS = 10_000;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; body?: { cancel(): Promise<void> } | null }>;

const CHAMADAS: Record<IdAppDoCofre, (valor: string) => { url: string; headers: Record<string, string> }> = {
  // A mesma rota que o provedor do computador usa primeiro (src/adapters/computador/provedores/orgo.ts).
  orgo: (valor) => ({ url: `${BASE_ORGO}/workspaces`, headers: { authorization: `Bearer ${valor}`, accept: "application/json" } }),
};

export function criarTestarChave(o: { fetchImpl?: Fetch; prazoMs?: number } = {}): TestarChave {
  const fetchImpl: Fetch = o.fetchImpl ?? ((url, init) => fetch(url, init));
  return async (app, valor) => {
    const chamada = CHAMADAS[app](valor);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.prazoMs ?? PRAZO_TESTE_MS);
    try {
      const r = await fetchImpl(chamada.url, { method: "GET", headers: chamada.headers, signal: ctl.signal });
      // O corpo é do app: não se lê (pode ecoar dados da conta). Só libera a conexão.
      await r.body?.cancel().catch(() => undefined);
      if (r.status >= 200 && r.status < 300) return "aceita";
      if (r.status === 401 || r.status === 403) return "recusada";
      return "indisponivel";
    } catch {
      return "indisponivel";
    } finally {
      clearTimeout(timer);
    }
  };
}

import { montarRegiao, type Montada } from "../regioes.tsx";
import { Marketplace, type PropsDoMarketplace } from "./marketplace.tsx";

export { criarApiReal, type DepsDoMarketplaceReal } from "./real.ts";

/**
 * ADR-179: a região `#marketplace` no React. O main.ts carrega este módulo só quando o Marketplace abre (import
 * dinâmico, como o onboarding): quem não abre o Marketplace não baixa o modal. A região é montada na primeira vez e
 * fica montada; fechado, desenha nada. `vez` muda a cada abertura: o modal reabre do zero (a tela e a busca de antes
 * não voltam), mas sem remontar a região.
 */
let montada: Montada | null = null;

export type DesenhoDoMarketplace = PropsDoMarketplace & { vez: number };

export function desenharMarketplace(p: DesenhoDoMarketplace | null, doc: Document = document): void {
  if (!doc.getElementById("marketplace") || (!p && !montada)) return;
  montada ??= montarRegiao("marketplace", null, doc);
  montada.desenhar(p ? <Marketplace key={p.vez} api={p.api} aoFechar={p.aoFechar} inicial={p.inicial} extra={p.extra} /> : null);
}

/** Só para os testes: devolve a região ao estado de antes de montar. */
export function desmontarMarketplace(): void {
  montada?.desmontar();
  montada = null;
}

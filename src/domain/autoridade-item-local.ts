import type { DesfechoDecisao } from "../contracts/decisao.ts";
import { REGRA_APROVACAO_PERMANENTE, REGRA_CONSULTA_SEM_DECISAO } from "./aprovacao-permanente.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR } from "./modo-aprovacao.ts";

/**
 * NOD-423 (ADR-048): a autoridade que libera um item a sair pelo gh do Mac. Decisão fechada NÃO é aprovação: o Parar do
 * trabalho (`regra:trabalho_parado`) e o × do card (`dispensada`) também fecham a decisão, e o item deles nunca sai.
 *
 * Fail-closed: só a pessoa (`decidida`) ou uma destas regras de lote autoriza. Regra nova não entra sozinha — precisa ser
 * posta aqui de propósito, com teste de autorização, porque o efeito no Mac é real. A mesma lista é a das regras que
 * gravam o item na trilha já na autorização (trilha-decisoes.ts) e o filtro do SQL de itens-aprovacao.repo.ts.
 */
export const REGRAS_QUE_AUTORIZAM_ITEM_LOCAL: readonly `regra:${string}`[] = [
  REGRA_CONSULTA_SEM_DECISAO,
  REGRA_APROVACAO_PERMANENTE,
  REGRA_MODO_AUTOMATICO,
  REGRA_MODO_TOTAL,
  REGRA_REVISOR,
];

const AUTORIZAM: ReadonlySet<string> = new Set(REGRAS_QUE_AUTORIZAM_ITEM_LOCAL);

/** A regra fecha a decisão autorizando o lote (e não só tirando o card da tela). */
export function regraAutorizaItemLocal(regra: string): boolean {
  return AUTORIZAM.has(regra);
}

/** O desfecho da decisão dá autoridade para o item sair pelo Mac. Nulo, expirado, dispensado ou regra desconhecida: não. */
export function desfechoAutorizaItemLocal(d: DesfechoDecisao | null | undefined): boolean {
  if (!d) return false;
  if (d.tipo === "decidida") return true;
  return d.tipo === "decidida_por_regra" && regraAutorizaItemLocal(d.regra);
}

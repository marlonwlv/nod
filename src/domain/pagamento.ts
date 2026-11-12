import type { Carrinho, Compra, Dinheiro, MotivoRecusaCompra } from "../contracts/assistente.ts";

/**
 * Gastar dinheiro (ADR-175; Grok Bot: "gasto exige passkey", `BeginGrokBotSpendApproval` → asserção WebAuthn). Duas travas
 * que não dependem uma da outra: a aprovação de sempre (o item `finalizar_compra` é `destructiveHint`, e o cartão mostra o
 * total) e a passkey no Mac da pessoa para (compra, total). A segunda vale em QUALQUER modo de aprovação, inclusive no
 * "Ignorar todas": quem a produz é o Mac, nunca o bot, e a cobrança só sai com a confirmação do MESMO total.
 *
 * Puro: o servidor do conector chama `decidirCompra` com o carrinho lido do driver e a resposta do verificador.
 */

/** definido em 2026-11-12: teto padrão de uma compra pelo bot (R$ 500), trocado por `NOD_ASSISTENTE_TETO_CENTAVOS`. */
export const TETO_PADRAO_CENTAVOS = 50_000;

export function somar(itens: readonly { quantidade: number; unitario: Dinheiro }[]): Dinheiro | null {
  const moeda = itens[0]?.unitario.moeda;
  if (!moeda) return null;
  if (itens.some((i) => i.unitario.moeda !== moeda)) return null;
  return { centavos: itens.reduce((n, i) => n + i.quantidade * i.unitario.centavos, 0), moeda };
}

/** "R$ 1.234,56" (definido em 2026-11-12: só BRL ganha o símbolo; outra moeda sai com o código, "USD 12,00"). */
export function formatarDinheiro(d: Dinheiro): string {
  const inteiro = Math.trunc(Math.abs(d.centavos) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = String(Math.abs(d.centavos) % 100).padStart(2, "0");
  return `${d.centavos < 0 ? "-" : ""}${d.moeda === "BRL" ? "R$" : d.moeda} ${inteiro},${cents}`;
}

export type EntradaCompra = {
  compraId: string;
  carrinho: Carrinho;
  /** O total que a compra tinha quando a passkey foi pedida (null = primeira chamada). */
  totalPedido: Dinheiro | null;
  tetoCentavos: number;
  /** A passkey confirmou ESTA compra com `totalPedido`; null = não há verificador (falha fechada). */
  confirmada: boolean | null;
};

export type DecisaoCompra = { cobrar: false; compra: Compra } | { cobrar: true; compra: Compra };

export function decidirCompra(e: EntradaCompra): DecisaoCompra {
  const recusa = (motivo: MotivoRecusaCompra, total: Dinheiro = e.carrinho.total): DecisaoCompra => ({ cobrar: false, compra: { id: e.compraId, carrinhoId: e.carrinho.id, total, estado: "recusada", motivo } });
  if (e.carrinho.itens.length === 0) return recusa("carrinho_vazio");
  const total = somar(e.carrinho.itens);
  if (!total) return recusa("moedas_diferentes");
  if (total.centavos > e.tetoCentavos) return recusa("acima_do_teto", total);
  if (e.confirmada === null) return recusa("sem_verificador", total);
  // O carrinho mudou depois de a passkey ser pedida: a confirmação era de outro valor. Pede de novo (nova compra).
  if (e.totalPedido && (e.totalPedido.centavos !== total.centavos || e.totalPedido.moeda !== total.moeda)) return recusa("valor_mudou", total);
  const compra: Compra = { id: e.compraId, carrinhoId: e.carrinho.id, total, estado: e.confirmada ? "paga" : "aguardando_passkey" };
  return e.confirmada ? { cobrar: true, compra } : { cobrar: false, compra };
}

/** A frase do motivo, para o modelo (fixa: nunca ecoa dado do provedor). */
export const FRASE_RECUSA_COMPRA: Readonly<Record<MotivoRecusaCompra, string>> = {
  acima_do_teto: "o total passa do teto de compra do bot; diga o total à pessoa e não tente de novo",
  carrinho_vazio: "o carrinho está vazio",
  moedas_diferentes: "o carrinho tem moedas diferentes; separe em duas compras",
  valor_mudou: "o total mudou depois do pedido de passkey; chame finalizar_compra de novo sem compra_id para pedir a confirmação do valor novo",
  sem_verificador: "este nod não tem a confirmação por passkey ligada; nenhuma compra sai. Diga isso à pessoa",
};

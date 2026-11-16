/**
 * O corpo do "Agora não" de uma aprovação (definido em 2026-10-18, QA do PR 4 do chat limpo). Recusar uma aprovação em
 * lista é mandar todos os itens desmarcados (como a ligação faz, decisoes.ts). O cartão de UM item (`ap-unico`, na
 * conversa e em "Sua vez") não tem caixa de marcar: a leitura do DOM voltava vazia, a web mandava `itens: []` e o
 * servidor decidia com a marca padrão — o item selecionado era executado. "Agora não" enviava o e-mail.
 *
 * Os itens vêm das caixas do cartão (quando há) ou da fila "Sua vez" (o item de cartão único); sem nenhum dos dois,
 * null: melhor não decidir do que decidir aprovando.
 */
export type MarcaDeItem = { id: string; selecionado: boolean; textoFinal?: string };

export function itensDaRecusa(doCartao: readonly MarcaDeItem[], daFila: readonly { id: string }[]): { id: string; selecionado: false }[] | null {
  const ids = doCartao.length > 0 ? doCartao.map((m) => m.id) : daFila.map((i) => i.id);
  return ids.length > 0 ? ids.map((id) => ({ id, selecionado: false })) : null;
}

/**
 * Mensagem nova com aprovação aberta (item 10 dos acessos devolvidos, rodada 2, 2026-11-16). O servidor fecha as
 * aprovações abertas da conversa como substituídas no envio (src/use-cases/substituir-aprovacoes.ts) — como o app de
 * referência e o bot-hq; não é recusa. Aqui só o que a tela precisa: saber se há alguma, para o placeholder avisar.
 */
export type AprovacaoAberta = { decisao: { id: string; conversaId: string; tipo: string }; estadoColuna: string; itensAprovacao: readonly { id: string }[] };

export function aprovacoesAbertasDaConversa<T extends AprovacaoAberta>(itens: readonly T[] | undefined, conversaId: string): T[] {
  return (itens ?? []).filter((i) => i.decisao.conversaId === conversaId && i.decisao.tipo === "aprovacao" && i.estadoColuna !== "vencido" && i.itensAprovacao.length > 0);
}

/** O placeholder do campo com aprovação aberta: diz o que mandar mensagem faz agora. Sem nome (a tela não sabe o gênero). */
export const PLACEHOLDER_COM_APROVACAO = "Ou diga o que fazer em vez disso";

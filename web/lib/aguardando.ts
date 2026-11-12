/**
 * ADR-165 (telas 16 e 16b do Paper "nod x Grok Bot"): o "Aguardando você" do jeito do Grok Bot. Não há caixa nem sino
 * separados: o pedido aberto aparece NA LINHA do bot — a prévia vira "Aguardando você: {motivo}" em laranja, com o ponto
 * laranja à direita —, o avatar da grade ganha o ponto laranja, e a linha fixa "Trabalhos" diz "N aguardando". O azul fica
 * só para o não lido. Clicar na linha abre a conversa rolada até o cartão pendente.
 *
 * Puro e sem DOM nem framework: recebe os pedidos já filtrados (pedidosAbertos, web/lib/avisos.ts) e devolve dados; quem
 * desenha é a barra (web/main.ts), e a mesma regra serve a qualquer camada de tela.
 */

/** O mínimo de um pedido aberto que a regra lê (um item de `SuaVezDto.itens`). */
export type PedidoAberto = {
  decisao: { id: string; agenteId: string; conversaId: string; frase: string };
};

export type Aguardando = {
  agenteId: string;
  conversaId: string;
  /** O pedido mais urgente do bot (o primeiro da fila: o servidor já ordena, ADR-007): é para ele que o clique rola. */
  decisaoId: string;
  /** A frase do pedido numa linha, sem quebras nem espaços repetidos. */
  motivo: string;
  /** Quantos pedidos esse bot tem abertos. */
  total: number;
};

/** definido em 2026-11-12: a linha da barra trunca no CSS; o texto inteiro vai ao title e ao leitor de tela, até aqui. */
export const MOTIVO_MAX = 120;

/** A frase em uma linha: "Quer enviar 2 e-mails\npara a Lipe" → "Quer enviar 2 e-mails para a Lipe". */
export function motivoDaFrase(frase: string): string {
  const uma = frase.replace(/\s+/g, " ").trim();
  return uma.length > MOTIVO_MAX ? `${uma.slice(0, MOTIVO_MAX - 1).trimEnd()}…` : uma;
}

/** Um por bot, na ordem da fila: o primeiro pedido de cada bot decide o motivo e o alvo do clique. */
export function aguardandoPorAgente(pedidos: readonly PedidoAberto[]): Map<string, Aguardando> {
  const out = new Map<string, Aguardando>();
  for (const p of pedidos) {
    const d = p.decisao;
    const ja = out.get(d.agenteId);
    if (ja) {
      ja.total += 1;
      continue;
    }
    out.set(d.agenteId, { agenteId: d.agenteId, conversaId: d.conversaId, decisaoId: d.id, motivo: motivoDaFrase(d.frase), total: 1 });
  }
  return out;
}

/** O texto da prévia: "Aguardando você: {motivo}"; sem frase, só "Aguardando você". */
export function textoAguardando(a: Pick<Aguardando, "motivo">): string {
  // Paper 16/16b (rodada 3): a pergunta do cartão vira o motivo — "Quer enviar 2 e-mails…" → "enviar 2 e-mails…".
  const motivo = a.motivo.replace(/^Quer\s+(?=\S)/, "").replace(/\?$/, "");
  return motivo ? `Aguardando você: ${motivo}` : "Aguardando você";
}

/**
 * O lado direito da linha fixa "Trabalhos": com pedido aberto, "N aguardando" em laranja (o que pede a pessoa ganha do
 * resto); senão, o número discreto de trabalhos abertos; sem nada, vazio.
 */
export function contadorDosTrabalhos(o: { abertos: number; aguardando: number }): { texto: string; tom: "aguardando" | "neutro" } | null {
  if (o.aguardando > 0) return { texto: `${o.aguardando} aguardando`, tom: "aguardando" };
  if (o.abertos > 0) return { texto: String(o.abertos), tom: "neutro" };
  return null;
}

/** O nome acessível da linha "Trabalhos": "Trabalhos, 3 abertos, 2 aguardando você". */
export function rotuloDosTrabalhos(o: { abertos: number; aguardando: number }): string {
  const partes = ["Trabalhos"];
  if (o.abertos > 0) partes.push(`${o.abertos} ${o.abertos === 1 ? "aberto" : "abertos"}`);
  if (o.aguardando > 0) partes.push(`${o.aguardando} aguardando você`);
  return partes.join(", ");
}

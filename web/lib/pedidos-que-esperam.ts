import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { TIPOS_DISPENSADOS_AO_SEGUIR, TipoDecisao } from "../../src/contracts/decisao.ts";
import { motivoDoPedidoDeTela } from "./computador.ts";
import { esc } from "./render.ts";

/**
 * Os pedidos que esperam a pessoa numa conversa (definido em 2026-11-20, ADR-191, pedido do dono): os cartões que a
 * mensagem nova fecha como dispensados (src/use-cases/seguir-conversando.ts) e a aprovação, que ela substitui (ADR-184).
 * Daqui saem o placeholder do campo ("Responda à Ada ou fale de outra coisa"), a marca que a pílula "A Ada espera você"
 * procura nos cartões e a frase curta que ela diz. Nada lê o DOM.
 */

/**
 * O espelho de TIPOS_DISPENSADOS_AO_SEGUIR (a web só importa tipos de src/): um Record sobre TipoDecisao, então um tipo
 * novo não compila até alguém decidir. `true` = a mensagem nova fecha; 'pergunta' só vale para a ajuda do computador.
 * O teste unitário compara com a lista do contrato.
 */
export const FECHA_AO_SEGUIR: Readonly<Record<TipoDecisao, boolean>> = {
  acesso: true, app: true, credencial: true, perfil: true, bot: true, lote_bots: true, rotina: true, rotina_atualizacao: true, rotina_exclusao: true,
  rotina_execucao: true, colunas_quadro: true, quadro_exclusao: true, importacao_linear: true, assumir_quadro: true, retomar_turno: true, pergunta: true,
  aprovacao: false, gate_rotina: false, decisoes_exportacao: false, falta_de_dado: false, permissao: false,
};

/** Só para o tipo checar a lista do contrato sem importar o valor. */
export type TipoQueFechaAoSeguir = (typeof TIPOS_DISPENSADOS_AO_SEGUIR)[number];

type Item = SuaVezDto["itens"][number];

/** Um pedido que espera a pessoa: o id do cartão, o bot que pediu e a frase curta (minúscula, para "espera você: …"). */
export type PedidoQueEspera = { id: string; agenteId: string; nome: string; frase: string; tipo: TipoDecisao | "aprovacao" };

/** "Entrar no Drive" → "entrar no Drive": a frase entra no meio de "A Ada espera você: …". */
export function minusculaInicial(s: string): string {
  return s.charAt(0).toLocaleLowerCase("pt-BR") + s.slice(1);
}

/** A frase curta de um pedido: o motivo da ajuda do computador; a frase da decisão, sem o ponto final, nos outros. */
export function fraseCurta(frase: string): string {
  const motivo = motivoDoPedidoDeTela(frase);
  const t = (motivo ?? frase).replace(/\s+/gu, " ").trim().replace(/[.\s]+$/u, "");
  return [...t].length > 80 ? `${[...t].slice(0, 79).join("").trimEnd()}…` : t;
}

/**
 * A decisão aberta é do escopo? A da pessoa (decisora), aberta, sem tarefa do quadro e de um tipo que a mensagem nova
 * fecha (ou a aprovação, que ela substitui); a pergunta só quando é a ajuda do computador (`ajuda`), que não se responde
 * com texto.
 */
export function esperaPelaPessoa(item: Pick<Item, "decisao" | "estadoColuna">, pessoaId: string | undefined, ajuda: boolean): boolean {
  const d = item.decisao;
  if (item.estadoColuna === "vencido" || (d.estado !== "pendente" && d.estado !== "reaberta")) return false;
  if (d.tarefaId !== undefined || (pessoaId !== undefined && d.decisorId !== pessoaId)) return false;
  if (d.tipo === "aprovacao") return true;
  if (d.tipo === "pergunta") return ajuda;
  return FECHA_AO_SEGUIR[d.tipo];
}

/**
 * Os pedidos que esperam a pessoa nesta conversa, do mais antigo ao mais novo: as decisões de "Sua vez" do escopo e o
 * card de conexão (a proposta de acesso sem decisão). `ajudaDe` diz se a pergunta é a ajuda do computador (o balão).
 * `nomeDoApp` dá o nome do app do card de conexão.
 */
export function pedidosQueEsperam(p: {
  itens: readonly Item[] | undefined;
  propostas: readonly Proposta[];
  conversaId: string;
  pessoaId: string | undefined;
  ajudaDe: (item: Item) => boolean;
  nomeDoBot: (agenteId: string) => string;
  nomeDoApp: (slug: string) => string;
}): PedidoQueEspera[] {
  const daFila = (p.itens ?? []).filter((i) => i.decisao.conversaId === p.conversaId && esperaPelaPessoa(i, p.pessoaId, i.decisao.tipo === "pergunta" && p.ajudaDe(i)));
  const comDecisao = new Set(daFila.map((i) => i.decisao.id));
  const decisoes = daFila.map((i): PedidoQueEspera & { em: number } => ({ id: i.decisao.id, agenteId: i.decisao.agenteId, nome: i.agenteNome, frase: fraseCurta(i.pedido?.texto ?? i.decisao.frase), tipo: i.decisao.tipo, em: Date.parse(i.decisao.criadoEm) }));
  const conexoes = p.propostas
    .filter((x) => x.conversaId === p.conversaId && x.estado === "pendente" && x.payload.kind === "acesso" && x.payload.conectar === true && !comDecisao.has(x.id))
    .map((x): PedidoQueEspera & { em: number } => ({ id: x.id, agenteId: x.agenteId, nome: p.nomeDoBot(x.agenteId), frase: `Conectar o ${x.payload.kind === "acesso" ? p.nomeDoApp(x.payload.conector) : ""}`, tipo: "acesso", em: x.criadoEm }));
  return [...decisoes, ...conexoes].sort((a, b) => a.em - b.em).map(({ em: _em, ...resto }) => resto);
}

/**
 * O placeholder do campo com um pedido do escopo aberto (definido em 2026-11-20, ADR-191, pedido do dono): diz que dá para
 * responder ao cartão OU seguir com outro assunto — e seguir dispensa o cartão. A aprovação aberta mantém o dela
 * (PLACEHOLDER_COM_APROVACAO, ADR-184), que diz o mesmo para a aprovação.
 */
export function placeholderComPedido(nomeDoBot: string): string {
  return `Responda à ${nomeDoBot} ou fale de outra coisa`;
}

/**
 * A marca que a pílula procura (web/lib/rolagem-na-tela.ts): o id do cartão, o nome do bot e a frase curta, como atributos
 * do elemento de fora do cartão. Escapados aqui.
 */
export function atributosDaEspera(p: Pick<PedidoQueEspera, "id" | "nome" | "frase">): string {
  return ` data-pedido-espera="${esc(p.id)}" data-nome="${esc(p.nome)}" data-frase="${esc(minusculaInicial(p.frase))}"`;
}

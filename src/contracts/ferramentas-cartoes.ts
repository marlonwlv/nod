import type { Dinheiro } from "./assistente.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * mostrar_cartoes (ADR-175, respostas ricas): o bot mostra na conversa cartões padronizados — voo, hotel, carro, mapa,
 * clima, carrinho e arquivo (PDF ou planilha) — em vez de descrever em texto o que achou. Grava uma fala `texto` com o
 * resumo e o payload `cartoes`; a web desenha cada cartão (web/telas/cartoes-ricos.ts). Os campos são dado: o domínio
 * (src/domain/cartoes-ricos.ts) corta, limpa e só aceita link https. Mora fora de ferramentas-nod.ts (gatilho de 200 linhas).
 */
export const MAX_CARTOES = 10;

export type CartaoVoo = { tipo: "voo"; companhia: string; numero: string; origem: string; destino: string; partida: string; chegada: string; paradas: number; preco?: Dinheiro; link?: string };
export type CartaoHotel = { tipo: "hotel"; nome: string; endereco: string; nota?: number; diaria?: Dinheiro; entrada: string; saida: string; link?: string };
export type CartaoCarro = { tipo: "carro"; locadora: string; modelo: string; local: string; retirada: string; devolucao: string; total?: Dinheiro; link?: string };
export type PontoNoMapa = { nome: string; endereco?: string; lat: number; lng: number; nota?: number };
export type CartaoMapa = { tipo: "mapa"; titulo: string; pontos: PontoNoMapa[] };
export type CartaoClima = { tipo: "clima"; local: string; dias: { data: string; minimaC: number; maximaC: number; chuvaPct: number; resumo: string }[] };
export type CartaoCarrinho = { tipo: "carrinho"; loja?: string; itens: { nome: string; quantidade: number; unitario: Dinheiro }[]; total: Dinheiro; estado: "aberto" | "aguardando_passkey" | "pago" };
export type CartaoArquivo = { tipo: "arquivo"; formato: "pdf" | "planilha"; nome: string; paginas?: number; previa?: string[][]; link?: string };
export type CartaoRico = CartaoVoo | CartaoHotel | CartaoCarro | CartaoMapa | CartaoClima | CartaoCarrinho | CartaoArquivo;
export type TipoCartao = CartaoRico["tipo"];

export const TIPOS_CARTAO = ["voo", "hotel", "carro", "mapa", "clima", "carrinho", "arquivo"] as const satisfies readonly TipoCartao[];

/** O payload da fala: os cartões já limpos pelo domínio. */
export type PayloadCartoes = { kind: "cartoes"; cartoes: CartaoRico[] };

const DINHEIRO = "dinheiro = {centavos: inteiro, moeda: \"BRL\"}";

export const FERRAMENTAS_CARTOES = {
  mostrar_cartoes: {
    type: "object",
    description:
      `Mostra na conversa cartões de voo, hotel, carro, mapa, clima, carrinho ou arquivo (PDF, planilha), com os dados que você já tem (de uma busca, de um app). Use no lugar de descrever em texto opções de viagem, lugares, previsão, compra ou um arquivo pronto. Até ${MAX_CARTOES} por chamada; o texto final do turno não repete o que os cartões mostram.`,
    properties: {
      resumo: { type: "string", description: "Uma frase que apresenta os cartões (\"Achei dois voos para sexta.\").", minLength: 1, maxLength: 200 },
      cartoes: {
        type: "array",
        minItems: 1,
        maxItems: MAX_CARTOES,
        description:
          `Cada cartão tem tipo e os campos do tipo. voo: companhia, numero, origem, destino, partida e chegada (AAAA-MM-DDTHH:MM), paradas, preco?, link?. hotel: nome, endereco, entrada e saida (AAAA-MM-DD), nota?, diaria?, link?. carro: locadora, modelo, local, retirada, devolucao, total?, link?. mapa: titulo, pontos [{nome, lat, lng, endereco?, nota?}]. clima: local, dias [{data, minimaC, maximaC, chuvaPct, resumo}]. carrinho: itens [{nome, quantidade, unitario}], total, estado (aberto, aguardando_passkey ou pago), loja?. arquivo: formato (pdf ou planilha), nome, paginas?, previa? (até 6 linhas de até 6 células), link?. ${DINHEIRO}; link só https.`,
        items: { type: "object", properties: { tipo: { type: "string", enum: TIPOS_CARTAO } }, required: ["tipo"] },
      },
    },
    required: ["resumo", "cartoes"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsMostrarCartoes = { resumo: string; cartoes: Record<string, unknown>[] };
export type ResultadoMostrarCartoes = { ok: true; mensagem_id: string; cartoes: number } | { ok: false; erro: "cartao_invalido" | "fora_do_turno"; instrucao: string };

export type ContratoFerramentasCartoes = {
  mostrar_cartoes: { args: ArgsMostrarCartoes; resultado: ResultadoMostrarCartoes };
};

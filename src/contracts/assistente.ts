import type { JsonSchema } from "./json-schema.ts";

/**
 * O conector local `assistente` (ADR-176): as ferramentas de vida real do assistente pessoal
 * (pesquisa de referência: "Vida real", "Reuniões", "Cofre e pagamento") — viagens, lugares e restaurantes,
 * clima, compras e reuniões —, num servidor MCP que o nod spawna como qualquer conector. Leitura é `readOnlyHint`;
 * reservar, comprar e falar na reunião passam pela aprovação de sempre; gastar pede ainda a passkey no Mac (ADR-177).
 *
 * Os resultados são dados para o modelo (JSON) e, quando viram cartão na conversa, o mesmo formato (`CartaoRico`).
 */

/** Dinheiro sempre em centavos inteiros com a moeda: ponto flutuante não soma preço (definido em 2026-11-12). */
export type Dinheiro = { centavos: number; moeda: string };

export type Voo = { id: string; companhia: string; numero: string; origem: string; destino: string; partida: string; chegada: string; paradas: number; preco: Dinheiro };
export type Hotel = { id: string; nome: string; endereco: string; nota: number | null; diaria: Dinheiro; entrada: string; saida: string };
export type Carro = { id: string; locadora: string; modelo: string; retirada: string; devolucao: string; local: string; total: Dinheiro };
export type Lugar = { id: string; nome: string; tipo: "restaurante" | "lugar"; endereco: string; nota: number | null; faixaDePreco: number | null; lat: number; lng: number; aberto: boolean | null };
export type PrevisaoDia = { data: string; minimaC: number; maximaC: number; chuvaPct: number; resumo: string };
export type Clima = { local: string; dias: PrevisaoDia[] };
export type Produto = { id: string; nome: string; loja: string; preco: Dinheiro; url: string | null };
export type ItemCarrinho = { produtoId: string; nome: string; quantidade: number; unitario: Dinheiro };
export type Carrinho = { id: string; itens: ItemCarrinho[]; total: Dinheiro };
export type Reuniao = { id: string; titulo: string; inicio: string; fim: string; participantes: string[]; link: string | null };

/**
 * A compra que espera a passkey (ADR-177; pedido de aprovação do gasto → asserção WebAuthn). `aguardando_passkey`
 * até a pessoa confirmar no Mac; `paga` só com a confirmação do mesmo valor; `recusada` com o motivo fixo.
 */
export type EstadoCompra = "aguardando_passkey" | "paga" | "recusada";
export type Compra = { id: string; carrinhoId: string; total: Dinheiro; estado: EstadoCompra; motivo?: MotivoRecusaCompra };
export type MotivoRecusaCompra = "acima_do_teto" | "carrinho_vazio" | "moedas_diferentes" | "valor_mudou" | "sem_verificador";

export type CartaoVirtual = { id: string; final: string; limite: Dinheiro; comerciante: string; estado: "aguardando_passkey" | "emitido" | "recusado" };

/** O driver: de teste (fixtures, padrão) ou real (atrás de `NOD_ASSISTENTE_REAL=1`). Nenhum método vê segredo da pessoa. */
export interface DriverAssistente {
  buscarVoos(a: { origem: string; destino: string; ida: string; volta?: string; adultos: number }): Promise<Voo[]>;
  buscarHoteis(a: { cidade: string; entrada: string; saida: string; hospedes: number }): Promise<Hotel[]>;
  buscarCarros(a: { local: string; retirada: string; devolucao: string }): Promise<Carro[]>;
  buscarLugares(a: { busca: string; pertoDe?: string; tipo?: Lugar["tipo"] }): Promise<Lugar[]>;
  reservarMesa(a: { lugarId: string; dataHora: string; pessoas: number }): Promise<{ reserva: string; lugar: string; dataHora: string; pessoas: number }>;
  previsao(a: { local: string; dias: number }): Promise<Clima>;
  buscarProdutos(a: { busca: string; precoMaxCentavos?: number }): Promise<Produto[]>;
  carrinho(): Promise<Carrinho>;
  adicionarAoCarrinho(a: { produtoId: string; quantidade: number }): Promise<Carrinho>;
  /** Cobra o carrinho. Só é chamado depois de a passkey confirmar o MESMO total (domain/pagamento.ts). */
  cobrar(a: { carrinhoId: string; total: Dinheiro }): Promise<{ recibo: string }>;
  emitirCartaoVirtual(a: { limite: Dinheiro; comerciante: string }): Promise<{ id: string; final: string }>;
  listarReunioes(a: { de?: string; ate?: string }): Promise<Reuniao[]>;
  resumoDaReuniao(a: { reuniaoId: string }): Promise<{ reuniaoId: string; resumo: string }>;
  entrarNaReuniao(a: { reuniaoId: string }): Promise<{ reuniaoId: string; entrou: boolean }>;
  enviarMensagemNaReuniao(a: { reuniaoId: string; texto: string }): Promise<{ reuniaoId: string; enviada: boolean }>;
}

/**
 * Quem confirma o gasto (ADR-177): a passkey assinada no Mac da pessoa para (compra, total). O bot nunca a produz: ela
 * chega por fora do turno (o Mac grava a asserção verificada). Sem verificador, nenhuma compra sai (falha fechada).
 */
export interface VerificadorDeGasto {
  confirmado(a: { compraId: string; total: Dinheiro }): Promise<boolean>;
}

/** Uma ferramenta do conector (o catálogo mora em src/domain/assistente.ts: contrato não tem lógica, EMENDA 26). */
export type CapacidadeAssistente = { nome: string; descricao: string; schema: JsonSchema; readOnlyHint: boolean; destructiveHint?: boolean };

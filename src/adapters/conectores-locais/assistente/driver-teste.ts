import type { Carrinho, DriverAssistente, ItemCarrinho, Produto, VerificadorDeGasto } from "../../../contracts/assistente.ts";
import { somar } from "../../../domain/pagamento.ts";

/**
 * O driver de teste do conector `assistente` (ADR-176): fixtures fixas, sem rede e sem custo, para o bot, o e2e e a tela.
 * É o padrão: o real só com `NOD_ASSISTENTE_REAL=1`. Os dados são inventados e dizem que são ("(teste)" no nome), para
 * ninguém confundir uma busca de teste com um voo de verdade. Estado (carrinho, reservas) vive no processo.
 */
const BRL = (centavos: number) => ({ centavos, moeda: "BRL" });

const PRODUTOS: readonly Produto[] = [
  { id: "prod-cafe", nome: "Café em grãos 1 kg (teste)", loja: "Loja Teste", preco: BRL(8990), url: null },
  { id: "prod-fone", nome: "Fone sem fio (teste)", loja: "Loja Teste", preco: BRL(29900), url: null },
  { id: "prod-caneca", nome: "Caneca térmica (teste)", loja: "Loja Teste", preco: BRL(5990), url: null },
];

export function criarDriverTeste(): DriverAssistente {
  let itens: ItemCarrinho[] = [];
  let cartoes = 0;
  const carrinho = (): Carrinho => ({ id: "carrinho-teste", itens: itens.map((i) => ({ ...i })), total: somar(itens) ?? BRL(0) });
  return {
    async buscarVoos(a) {
      return [
        { id: "voo-1", companhia: "Aérea Teste", numero: "AT 1203", origem: a.origem, destino: a.destino, partida: `${a.ida}T07:10`, chegada: `${a.ida}T08:25`, paradas: 0, preco: BRL(48900 * a.adultos) },
        { id: "voo-2", companhia: "Voa Teste", numero: "VT 455", origem: a.origem, destino: a.destino, partida: `${a.ida}T18:40`, chegada: `${a.ida}T21:05`, paradas: 1, preco: BRL(39900 * a.adultos) },
      ];
    },
    async buscarHoteis(a) {
      return [
        { id: "hotel-1", nome: `Hotel Centro ${a.cidade} (teste)`, endereco: "Rua das Flores, 100", nota: 8.7, diaria: BRL(42000), entrada: a.entrada, saida: a.saida },
        { id: "hotel-2", nome: `Pousada Jardim ${a.cidade} (teste)`, endereco: "Av. Brasil, 2000", nota: 9.1, diaria: BRL(31000), entrada: a.entrada, saida: a.saida },
      ];
    },
    async buscarCarros(a) {
      return [{ id: "carro-1", locadora: "Locadora Teste", modelo: "Compacto automático", retirada: a.retirada, devolucao: a.devolucao, local: a.local, total: BRL(36000) }];
    },
    async buscarLugares(a) {
      const tipo = a.tipo ?? "restaurante";
      return [
        { id: "lugar-1", nome: `${a.busca} da Esquina (teste)`, tipo, endereco: a.pertoDe ?? "Centro", nota: 4.6, faixaDePreco: 2, lat: -23.5614, lng: -46.6559, aberto: true },
        { id: "lugar-2", nome: `Casa ${a.busca} (teste)`, tipo, endereco: a.pertoDe ?? "Centro", nota: 4.3, faixaDePreco: 3, lat: -23.5629, lng: -46.6544, aberto: false },
      ];
    },
    async reservarMesa(a) {
      return { reserva: `reserva-${a.lugarId}-${a.dataHora}`, lugar: a.lugarId, dataHora: a.dataHora, pessoas: a.pessoas };
    },
    async previsao(a) {
      const base = Date.UTC(2026, 10, 12);
      return { local: a.local, dias: Array.from({ length: a.dias }, (_, i) => ({ data: new Date(base + i * 86_400_000).toISOString().slice(0, 10), minimaC: 17 + (i % 3), maximaC: 26 + (i % 4), chuvaPct: [10, 60, 30][i % 3] ?? 0, resumo: ["Sol entre nuvens", "Pancadas à tarde", "Nublado"][i % 3] ?? "" })) };
    },
    async buscarProdutos(a) {
      const busca = a.busca.toLowerCase();
      const achados = PRODUTOS.filter((p) => p.nome.toLowerCase().includes(busca));
      return (achados.length ? achados : PRODUTOS).filter((p) => a.precoMaxCentavos === undefined || p.preco.centavos <= a.precoMaxCentavos);
    },
    async carrinho() {
      return carrinho();
    },
    async adicionarAoCarrinho(a) {
      const p = PRODUTOS.find((x) => x.id === a.produtoId);
      if (!p) throw new ErroDoDriver("produto_desconhecido");
      const ja = itens.find((i) => i.produtoId === p.id);
      itens = ja ? itens.map((i) => (i.produtoId === p.id ? { ...i, quantidade: i.quantidade + a.quantidade } : i)) : [...itens, { produtoId: p.id, nome: p.nome, quantidade: a.quantidade, unitario: p.preco }];
      return carrinho();
    },
    async cobrar(a) {
      itens = [];
      return { recibo: `recibo-teste-${a.carrinhoId}-${a.total.centavos}` };
    },
    async emitirCartaoVirtual() {
      cartoes += 1;
      return { id: `cartao-teste-${cartoes}`, final: String(4240 + cartoes).slice(-4) };
    },
    async listarReunioes() {
      return [
        { id: "reuniao-1", titulo: "Planejamento da semana (teste)", inicio: "2026-11-12T13:00", fim: "2026-11-12T13:30", participantes: ["marlon@exemplo.com", "ada@exemplo.com"], link: null },
        { id: "reuniao-2", titulo: "Revisão do produto (teste)", inicio: "2026-11-12T16:00", fim: "2026-11-12T17:00", participantes: ["marlon@exemplo.com"], link: null },
      ];
    },
    async resumoDaReuniao(a) {
      return { reuniaoId: a.reuniaoId, resumo: "Combinados (teste): revisar o onboarding até sexta; Ada abre as issues." };
    },
    async entrarNaReuniao(a) {
      return { reuniaoId: a.reuniaoId, entrou: true };
    },
    async enviarMensagemNaReuniao(a) {
      return { reuniaoId: a.reuniaoId, enviada: true };
    },
  };
}

/** Erro do driver com código fixo (a mensagem nunca vem do provedor). */
export class ErroDoDriver extends Error {
  readonly codigo: "produto_desconhecido" | "sem_provedor" | "provedor_falhou";
  constructor(codigo: ErroDoDriver["codigo"]) {
    super(codigo);
    this.codigo = codigo;
  }
}

/**
 * O verificador de teste: confirma as compras cujo id está no conjunto (o teste e o e2e o enchem). Nunca é usado com o
 * driver real: lá, sem o verificador do servidor (O que faltou, ADR-177), nenhuma compra sai.
 */
export function criarVerificadorTeste(confirmadas: Set<string> = new Set()): VerificadorDeGasto & { confirmar(compraId: string): void } {
  return {
    async confirmado(a) {
      return confirmadas.has(a.compraId);
    },
    confirmar(compraId) {
      confirmadas.add(compraId);
    },
  };
}

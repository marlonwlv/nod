import { randomUUID } from "node:crypto";
import type { Dinheiro, DriverAssistente, VerificadorDeGasto } from "../../../contracts/assistente.ts";
import { CAPACIDADES_ASSISTENTE, validarArgsAssistente, type ArgsAssistente } from "../../../domain/assistente.ts";
import { decidirCompra, FRASE_RECUSA_COMPRA, formatarDinheiro, TETO_PADRAO_CENTAVOS } from "../../../domain/pagamento.ts";
import { ehPontoDeEntrada } from "../../../shared/entrada.ts";
import { criarServidorMcpSimples, type ResultadoMcp, type ServidorMcpSimples } from "../mcp-simples.ts";
import { criarDriverTeste, criarVerificadorTeste, ErroDoDriver } from "./driver-teste.ts";

/**
 * Servidor MCP stdio do conector local `assistente` (ADR-174): viagens, lugares e restaurantes, clima, compras e reuniões.
 * Valida no domínio, chama o driver e devolve JSON. A compra e o cartão virtual têm a trava da passkey (ADR-175): a primeira
 * chamada devolve `aguardando_passkey` com o total; só depois de o verificador confirmar ESSE total a cobrança sai.
 *
 * Driver pelo ambiente (o modelo nunca escolhe): `NOD_ASSISTENTE_REAL=1` pede o real, que ainda não tem provedor
 * (O que faltou) — sem driver, tools/list volta vazio e a sonda registra o conector indisponível, como o `github` sem jeito.
 * Sem a variável, o driver de teste (fixtures).
 */
const json = (v: unknown): ResultadoMcp => ({ ok: true, texto: JSON.stringify(v) });
const falha = (motivo: string): ResultadoMcp => ({ ok: false, motivo });

type Pendente = { tipo: "compra"; carrinhoId: string; total: Dinheiro } | { tipo: "cartao"; limite: Dinheiro; comerciante: string };

export function criarServidorAssistente(o: { driver: DriverAssistente | null; verificador: VerificadorDeGasto | null; tetoCentavos?: number; novoId?: () => string }): ServidorMcpSimples {
  const teto = o.tetoCentavos ?? TETO_PADRAO_CENTAVOS;
  const novoId = o.novoId ?? randomUUID;
  const pendentes = new Map<string, Pendente>();

  async function finalizarCompra(d: DriverAssistente, a: Extract<ArgsAssistente, { nome: "finalizar_compra" }>): Promise<ResultadoMcp> {
    const carrinho = await d.carrinho();
    if (carrinho.id !== a.carrinhoId) return falha("carrinho_id não é o carrinho atual; chame ver_carrinho");
    const p = a.compraId ? pendentes.get(a.compraId) : undefined;
    if (a.compraId && (!p || p.tipo !== "compra")) return falha("compra_id desconhecido; chame finalizar_compra de novo sem compra_id");
    const compraId = a.compraId ?? novoId();
    const confirmada = o.verificador && p?.tipo === "compra" ? await o.verificador.confirmado({ compraId, total: p.total }) : o.verificador ? false : null;
    const decisao = decidirCompra({ compraId, carrinho, totalPedido: p?.tipo === "compra" ? p.total : null, tetoCentavos: teto, confirmada });
    const c = decisao.compra;
    if (c.estado === "recusada") {
      if (a.compraId) pendentes.delete(a.compraId);
      return falha(`compra recusada (${formatarDinheiro(c.total)}): ${FRASE_RECUSA_COMPRA[c.motivo ?? "sem_verificador"]}`);
    }
    if (!decisao.cobrar) {
      pendentes.set(compraId, { tipo: "compra", carrinhoId: carrinho.id, total: c.total });
      return json({ estado: c.estado, compra_id: compraId, total: c.total, total_texto: formatarDinheiro(c.total), instrucao: "diga o total à pessoa e encerre; ela confirma com a passkey no Mac, e você chama finalizar_compra de novo com este compra_id" });
    }
    pendentes.delete(compraId);
    const { recibo } = await d.cobrar({ carrinhoId: carrinho.id, total: c.total });
    return json({ estado: "paga", compra_id: compraId, total: c.total, total_texto: formatarDinheiro(c.total), recibo });
  }

  async function cartaoVirtual(d: DriverAssistente, a: Extract<ArgsAssistente, { nome: "pedir_cartao_virtual" }>): Promise<ResultadoMcp> {
    const limite: Dinheiro = { centavos: a.limiteCentavos, moeda: "BRL" };
    if (limite.centavos > teto) return falha(`cartão recusado: o limite ${formatarDinheiro(limite)} passa do teto de compra do bot; diga isso à pessoa`);
    if (!o.verificador) return falha(`cartão recusado: ${FRASE_RECUSA_COMPRA.sem_verificador}`);
    const p = a.cartaoId ? pendentes.get(a.cartaoId) : undefined;
    if (a.cartaoId && (!p || p.tipo !== "cartao" || p.limite.centavos !== limite.centavos || p.comerciante !== a.comerciante)) return falha("cartao_id desconhecido ou com outro limite; chame de novo sem cartao_id");
    const id = a.cartaoId ?? novoId();
    if (!a.cartaoId || !(await o.verificador.confirmado({ compraId: id, total: limite }))) {
      pendentes.set(id, { tipo: "cartao", limite, comerciante: a.comerciante });
      return json({ estado: "aguardando_passkey", cartao_id: id, limite, limite_texto: formatarDinheiro(limite), comerciante: a.comerciante, instrucao: "diga o limite à pessoa e encerre; ela confirma com a passkey no Mac" });
    }
    pendentes.delete(id);
    const c = await d.emitirCartaoVirtual({ limite, comerciante: a.comerciante });
    // Só o final: o número, a validade e o código ficam com quem preenche (o Mac), nunca com o bot (ADR-175).
    return json({ estado: "emitido", cartao_id: c.id, final: c.final, limite, comerciante: a.comerciante });
  }

  async function executar(nome: string, bruto: Record<string, unknown>): Promise<ResultadoMcp> {
    const d = o.driver;
    if (!d) return falha("conector sem provedor configurado");
    const v = validarArgsAssistente(nome, bruto);
    if (!v.ok) return falha(v.motivo);
    const a = v.valor;
    try {
      switch (a.nome) {
        case "buscar_voos": return json({ voos: await d.buscarVoos(a) });
        case "buscar_hoteis": return json({ hoteis: await d.buscarHoteis(a) });
        case "buscar_carros": return json({ carros: await d.buscarCarros(a) });
        case "buscar_lugares": return json({ lugares: await d.buscarLugares(a) });
        case "reservar_mesa": return json(await d.reservarMesa(a));
        case "previsao_do_tempo": return json(await d.previsao(a));
        case "buscar_produtos": return json({ produtos: await d.buscarProdutos(a) });
        case "ver_carrinho": return json(await d.carrinho());
        case "adicionar_ao_carrinho": return json(await d.adicionarAoCarrinho(a));
        case "finalizar_compra": return await finalizarCompra(d, a);
        case "pedir_cartao_virtual": return await cartaoVirtual(d, a);
        case "listar_reunioes": return json({ reunioes: await d.listarReunioes(a) });
        case "resumo_da_reuniao": return json(await d.resumoDaReuniao(a));
        case "entrar_na_reuniao": return json(await d.entrarNaReuniao(a));
        case "enviar_mensagem_na_reuniao": return json(await d.enviarMensagemNaReuniao(a));
      }
    } catch (e) {
      if (e instanceof ErroDoDriver) return falha(e.codigo === "produto_desconhecido" ? "produto_id desconhecido; use um id de buscar_produtos" : "o provedor não respondeu; tente de novo em instantes");
      throw e;
    }
  }

  return criarServidorMcpSimples({ nome: "nod-assistente", ferramentas: o.driver ? CAPACIDADES_ASSISTENTE : [], executar });
}

/** O driver e o verificador a partir do ambiente que o servidor do nod montou. */
export function doAmbiente(env: Readonly<Record<string, string | undefined>>): { driver: DriverAssistente | null; verificador: VerificadorDeGasto | null; tetoCentavos: number } {
  const teto = Number(env.NOD_ASSISTENTE_TETO_CENTAVOS);
  const tetoCentavos = Number.isInteger(teto) && teto > 0 ? teto : TETO_PADRAO_CENTAVOS;
  if (env.NOD_ASSISTENTE_REAL === "1") return { driver: null, verificador: null, tetoCentavos };
  return { driver: criarDriverTeste(), verificador: criarVerificadorTeste(), tetoCentavos };
}

export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  await criarServidorAssistente(doAmbiente(env)).ligar(process.stdin, process.stdout);
}

if (ehPontoDeEntrada(import.meta.url)) {
  void main().then(() => process.exit(0));
}

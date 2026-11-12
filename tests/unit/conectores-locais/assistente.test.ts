import { describe, expect, it } from "vitest";
import { criarDriverTeste, criarVerificadorTeste } from "../../../src/adapters/conectores-locais/assistente/driver-teste.ts";
import { criarServidorAssistente, doAmbiente } from "../../../src/adapters/conectores-locais/assistente/servidor.ts";
import { validarArgsAssistente } from "../../../src/domain/assistente.ts";
import { decidirCompra, formatarDinheiro, somar } from "../../../src/domain/pagamento.ts";

let seq = 0;
async function chamar(s: ReturnType<typeof criarServidorAssistente>, name: string, args: Record<string, unknown> = {}) {
  const linha = await s.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }));
  const r = JSON.parse(linha ?? "{}").result as { content: { text: string }[]; isError?: boolean };
  return { erro: r.isError === true, texto: r.content[0]?.text ?? "", json: r.isError ? null : JSON.parse(r.content[0]?.text ?? "null") };
}
function servidor(teto?: number) {
  const verificador = criarVerificadorTeste();
  let n = 0;
  const s = criarServidorAssistente({ driver: criarDriverTeste(), verificador, ...(teto ? { tetoCentavos: teto } : {}), novoId: () => `id-${++n}` });
  return { s, verificador };
}

describe("conector local assistente (ADR-174)", () => {
  it("tools/list: leitura marcada readOnly; finalizar_compra e cartão virtual destrutivos", async () => {
    const { s } = servidor();
    const r = JSON.parse((await s.tratarLinha('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')) ?? "{}");
    const porNome = new Map<string, { annotations: { readOnlyHint: boolean; destructiveHint?: boolean } }>(r.result.tools.map((t: { name: string }) => [t.name, t]));
    expect(porNome.get("buscar_voos")?.annotations.readOnlyHint).toBe(true);
    expect(porNome.get("reservar_mesa")?.annotations.readOnlyHint).toBe(false);
    expect(porNome.get("finalizar_compra")?.annotations.destructiveHint).toBe(true);
    expect(porNome.get("pedir_cartao_virtual")?.annotations.destructiveHint).toBe(true);
  });

  it("busca com o driver de teste e devolve JSON; argumento errado volta como texto para corrigir", async () => {
    const { s } = servidor();
    const voos = await chamar(s, "buscar_voos", { origem: "GRU", destino: "SDU", ida: "2026-12-01", adultos: 2 });
    expect(voos.json.voos[0]).toMatchObject({ origem: "GRU", destino: "SDU", preco: { centavos: 97800, moeda: "BRL" } });
    const ruim = await chamar(s, "buscar_voos", { origem: "GRU", destino: "SDU", ida: "2026-02-30" });
    expect(ruim.erro).toBe(true);
    expect(ruim.texto).toContain("ida tem de ser uma data AAAA-MM-DD");
    expect((await chamar(s, "buscar_hoteis", { cidade: "Rio", entrada: "2026-12-02", saida: "2026-12-01" })).texto).toContain("saida tem de ser depois da entrada");
    expect((await chamar(s, "previsao_do_tempo", { local: "São Paulo", hack: 1 })).texto).toContain("argumento fora do schema: hack");
  });

  it("compra: aguardando_passkey com o total → a passkey confirma → paga; sem confirmação não cobra", async () => {
    const { s, verificador } = servidor();
    await chamar(s, "adicionar_ao_carrinho", { produto_id: "prod-cafe", quantidade: 2 });
    const pedido = await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste" });
    expect(pedido.json).toMatchObject({ estado: "aguardando_passkey", compra_id: "id-1", total: { centavos: 17980 }, total_texto: "R$ 179,80" });
    const semPasskey = await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste", compra_id: "id-1" });
    expect(semPasskey.json.estado).toBe("aguardando_passkey");
    verificador.confirmar("id-1");
    const paga = await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste", compra_id: "id-1" });
    expect(paga.json).toMatchObject({ estado: "paga", recibo: "recibo-teste-carrinho-teste-17980" });
    expect((await chamar(s, "ver_carrinho")).json.itens).toEqual([]);
  });

  it("o carrinho que muda depois do pedido de passkey não é cobrado (valor_mudou); acima do teto, recusa", async () => {
    const { s, verificador } = servidor(30_000);
    await chamar(s, "adicionar_ao_carrinho", { produto_id: "prod-cafe" });
    await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste" });
    await chamar(s, "adicionar_ao_carrinho", { produto_id: "prod-caneca" });
    verificador.confirmar("id-1");
    const mudou = await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste", compra_id: "id-1" });
    expect(mudou.erro).toBe(true);
    expect(mudou.texto).toContain("o total mudou");
    await chamar(s, "adicionar_ao_carrinho", { produto_id: "prod-fone" });
    const caro = await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste" });
    expect(caro.texto).toContain("passa do teto");
  });

  it("cartão virtual: só o final volta, depois da passkey", async () => {
    const { s, verificador } = servidor();
    const p = await chamar(s, "pedir_cartao_virtual", { limite_centavos: 10_000, comerciante: "loja.exemplo" });
    expect(p.json.estado).toBe("aguardando_passkey");
    verificador.confirmar(p.json.cartao_id);
    const c = await chamar(s, "pedir_cartao_virtual", { limite_centavos: 10_000, comerciante: "loja.exemplo", cartao_id: p.json.cartao_id });
    expect(c.json).toMatchObject({ estado: "emitido", final: "4241" });
    expect(Object.keys(c.json)).not.toContain("numero");
  });

  it("sem verificador nenhuma compra sai; NOD_ASSISTENTE_REAL=1 sem provedor esvazia o catálogo", async () => {
    const s = criarServidorAssistente({ driver: criarDriverTeste(), verificador: null });
    await chamar(s, "adicionar_ao_carrinho", { produto_id: "prod-cafe" });
    expect((await chamar(s, "finalizar_compra", { carrinho_id: "carrinho-teste" })).texto).toContain("não tem a confirmação por passkey ligada");
    const real = criarServidorAssistente(doAmbiente({ NOD_ASSISTENTE_REAL: "1" }));
    const lista = JSON.parse((await real.tratarLinha('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')) ?? "{}");
    expect(lista.result.tools).toEqual([]);
  });
});

describe("domínio de pagamento (ADR-175)", () => {
  it("soma em centavos, recusa moedas misturadas e formata em reais", () => {
    expect(somar([{ quantidade: 3, unitario: { centavos: 10, moeda: "BRL" } }])).toEqual({ centavos: 30, moeda: "BRL" });
    expect(somar([{ quantidade: 1, unitario: { centavos: 1, moeda: "BRL" } }, { quantidade: 1, unitario: { centavos: 1, moeda: "USD" } }])).toBeNull();
    expect(formatarDinheiro({ centavos: 123456, moeda: "BRL" })).toBe("R$ 1.234,56");
    expect(formatarDinheiro({ centavos: 1200, moeda: "USD" })).toBe("USD 12,00");
  });

  it("decidirCompra: sem verificador recusa; confirmada com o mesmo total cobra", () => {
    const carrinho = { id: "c", itens: [{ produtoId: "p", nome: "x", quantidade: 1, unitario: { centavos: 500, moeda: "BRL" } }], total: { centavos: 500, moeda: "BRL" } };
    expect(decidirCompra({ compraId: "1", carrinho, totalPedido: null, tetoCentavos: 1000, confirmada: null }).compra.motivo).toBe("sem_verificador");
    expect(decidirCompra({ compraId: "1", carrinho, totalPedido: { centavos: 500, moeda: "BRL" }, tetoCentavos: 1000, confirmada: true }).cobrar).toBe(true);
  });

  it("validarArgsAssistente: data e hora da reserva, limites de inteiro", () => {
    expect(validarArgsAssistente("reservar_mesa", { lugar_id: "l", data_hora: "2026-12-01T25:00", pessoas: 2 }).ok).toBe(false);
    expect(validarArgsAssistente("reservar_mesa", { lugar_id: "l", data_hora: "2026-12-01T20:30", pessoas: 2 })).toMatchObject({ ok: true, valor: { lugarId: "l", pessoas: 2 } });
    expect(validarArgsAssistente("buscar_voos", { origem: "a", destino: "b", ida: "2026-12-01", adultos: 0 }).ok).toBe(false);
  });
});

import { createHash } from "node:crypto";
import type { ProvedorNuvem, RefInstancia, TamanhoMaquinaNuvem } from "../../contracts/provedor-nuvem.ts";
import type { PedidoVmDoNod, PrevisaoVmDoNod, ProvisionadorVmDoNod } from "../../contracts/vm-do-nod.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";

/**
 * ADR-167 (definido em 2026-11-12): o provisionador da VM do nod (opção 3). Dois drivers:
 *   - `seco` (o padrão): monta o pedido exato que iria ao Google e o devolve como PREVISÃO; nunca chama a rede. É o que
 *     roda com `NOD_VM_DO_NOD=1` até o Marlon decidir cobrança e projeto — nada pago nasce por engano.
 *   - `gcp`: o MESMO `ProvedorNuvem` da ADR-121 (criar, ligar, desligar, excluir, estado), só que com a conta de serviço do
 *     projeto do nod em vez da da pessoa. Só com `NOD_VM_DO_NOD_DRIVER=gcp` E um `provedor` montado no compor.
 * O resto do ciclo (acordar com trabalho, dormir ociosa, motor sem contato) é o reconciliador da ADR-121, que já sabe
 * fazer isso para qualquer `ProvedorNuvem`.
 */

/** O `requestId` do Google tem de ser UUID: derivado do pedido, para a segunda tentativa não criar outra VM. */
export function uuidDoPedido(chave: string): string {
  const h = createHash("sha256").update(`nod-vm-do-nod:${chave}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** O plano no tamanho que o gcp.ts conhece (TIPO_POR_TAMANHO); tipo fora disso não vai à nuvem. */
export function tamanhoDoPlano(tipo: string): TamanhoMaquinaNuvem {
  if (tipo === "e2-standard-4") return "menor";
  if (tipo === "e2-standard-8") return "padrao";
  throw new ErroDeDominio("entrada_invalida");
}

export function criarProvisionadorVmDoNod(o: { driver: "seco" } | { driver: "gcp"; provedor: ProvedorNuvem; startupScript: (p: PedidoVmDoNod) => string }): ProvisionadorVmDoNod {
  const chamadasDe = (p: PedidoVmDoNod) => [
    `compute.instances.insert ${p.ref.projeto}/${p.ref.zona}/${p.ref.nome} ${p.plano.tipo} requestId=${uuidDoPedido(p.requestId)}`,
    `labels ${Object.entries(p.rotulos).map(([k, v]) => `${k}=${v}`).join(",")}`,
  ];
  if (o.driver === "seco") {
    const nada = async (_ref: RefInstancia) => undefined;
    return {
      driver: "seco",
      async provisionar(pedido): Promise<PrevisaoVmDoNod> {
        tamanhoDoPlano(pedido.plano.tipo);
        log("info", "vm_do_nod_prevista", { plano: pedido.plano.id, zona: pedido.ref.zona });
        return { pedido, chamadas: chamadasDe(pedido), custoMensalCentavos: pedido.plano.precoMensalCentavos };
      },
      estado: async () => "inexistente",
      ligar: nada,
      desligar: nada,
      encerrar: nada,
    };
  }
  const { provedor } = o;
  return {
    driver: "gcp",
    async provisionar(pedido) {
      await provedor.criar({ ...pedido.ref, subrede: pedido.subrede, tamanho: tamanhoDoPlano(pedido.plano.tipo), startupScript: o.startupScript(pedido), maquinaNuvemId: pedido.ref.nome }, uuidDoPedido(pedido.requestId));
      log("info", "vm_do_nod_criada", { plano: pedido.plano.id, zona: pedido.ref.zona });
      return { pedido, chamadas: chamadasDe(pedido), custoMensalCentavos: pedido.plano.precoMensalCentavos };
    },
    estado: (ref) => provedor.estado(ref),
    ligar: (ref) => provedor.ligar(ref),
    desligar: (ref) => provedor.desligar(ref),
    encerrar: (ref) => provedor.excluir(ref),
  };
}

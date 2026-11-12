import type { EstadoInstancia, RefInstancia } from "./provedor-nuvem.ts";

/**
 * ADR-169 (definido em 2026-11-12, decisão 1 do Marlon sobre o Grok Bot): o agente roda em TRÊS lugares, todos suportados.
 *   1. `maquina_da_pessoa` — o padrão e o primeiro que quase todo mundo usa (o Mac, o Linux ou o Windows dela, ADR-090);
 *   2. `vm_da_pessoa`      — a VM que ela configura na conta de nuvem dela (ADR-121, caminho B: o custo é dela);
 *   3. `vm_do_nod`         — a VM gerenciada pelo nod, PAGA: o modelo da "box" do Grok Bot (uma VM por pessoa onde o
 *                            motor, o computador e as rotinas rodam com o laptop fechado).
 * A 3 só existe com `NOD_VM_DO_NOD=1`. O provisionador é uma interface com driver: `seco` (padrão — calcula o pedido e
 * nunca chama a nuvem) ou `gcp` (o mesmo `ProvedorNuvem` da ADR-121, com a conta de serviço do PROJETO DO NOD).
 */
export const ONDE_O_AGENTE_RODA = ["maquina_da_pessoa", "vm_da_pessoa", "vm_do_nod"] as const;
export type OndeOAgenteRoda = (typeof ONDE_O_AGENTE_RODA)[number];

export type PlanoVmDoNod = {
  id: "essencial" | "pro";
  nome: string;
  vcpu: number;
  memoriaGb: number;
  discoGb: number;
  /** Tipo de máquina no provedor (ex.: e2-standard-2). */
  tipo: string;
  /** Preço que a pessoa paga, em centavos de real por mês. */
  precoMensalCentavos: number;
  /** Horas acordada incluídas por mês (a VM dorme ociosa, como na ADR-121). */
  horasIncluidas: number;
};

/** Uma opção da seção "Onde o agente roda" na tela de máquinas. */
export type OpcaoOndeRoda = {
  id: OndeOAgenteRoda;
  titulo: string;
  descricao: string;
  /** A pessoa já usa esta opção (tem máquina pareada desse tipo). */
  emUso: boolean;
  disponivel: boolean;
  /** Por que não está disponível (texto curto para a tela). */
  motivo: string | null;
  /** Só na `vm_do_nod`: os planos e o preço. */
  planos?: PlanoVmDoNod[];
  padrao: boolean;
};

export type EstadoVmDoNod = "nao_contratada" | "provisionando" | "acordada" | "dormindo" | "encerrada";

/** O pedido de VM do nod já resolvido: onde ela mora e com que tamanho. `requestId` é estável por pessoa e plano. */
export type PedidoVmDoNod = { pessoaId: string; tenantId: string; plano: PlanoVmDoNod; ref: RefInstancia; subrede: string; requestId: string; rotulos: Record<string, string> };

/** O que o driver `seco` devolve: o pedido que IRIA para a nuvem, sem chamar ninguém. */
export type PrevisaoVmDoNod = { pedido: PedidoVmDoNod; chamadas: string[]; custoMensalCentavos: number };

export interface ProvisionadorVmDoNod {
  readonly driver: "seco" | "gcp";
  /** Cria (idempotente pelo requestId). No `seco`, só registra a previsão. */
  provisionar(pedido: PedidoVmDoNod): Promise<PrevisaoVmDoNod>;
  estado(ref: RefInstancia): Promise<EstadoInstancia>;
  ligar(ref: RefInstancia): Promise<void>;
  desligar(ref: RefInstancia): Promise<void>;
  /** Encerrar a assinatura apaga a VM (o disco antes vira snapshot de retenção — fora deste recorte). */
  encerrar(ref: RefInstancia): Promise<void>;
}

export type OpcoesOndeRodaDto = { opcoes: OpcaoOndeRoda[]; vmDoNod: { ligada: boolean; driver: "seco" | "gcp" | null } };

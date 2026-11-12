import type { MaquinaDto } from "../contracts/maquina.ts";
import type { OpcaoOndeRoda, PedidoVmDoNod, PlanoVmDoNod } from "../contracts/vm-do-nod.ts";
import { ErroDeDominio } from "./erro.ts";

/**
 * ADR-167 (definido em 2026-11-12): as três opções de onde o agente roda e o pedido da VM do nod. Puro.
 *
 * Preços e tipos são PROVISÓRIOS (definido em 2026-11-12, sem medição de custo: os mesmos e2-standard-4/8 da ADR-121 (TIPO_POR_TAMANHO do gcp.ts) com a VM
 * dormindo ociosa, ADR-121): o servidor os troca por `NOD_VM_DO_NOD_PLANOS` (JSON) sem publicar versão.
 */
export const PLANOS_VM_DO_NOD_PADRAO: readonly PlanoVmDoNod[] = [
  { id: "essencial", nome: "Essencial", vcpu: 4, memoriaGb: 16, discoGb: 50, tipo: "e2-standard-4", precoMensalCentavos: 19_900, horasIncluidas: 200 },
  { id: "pro", nome: "Pro", vcpu: 8, memoriaGb: 32, discoGb: 50, tipo: "e2-standard-8", precoMensalCentavos: 39_900, horasIncluidas: 400 },
];

export function planosDoEnv(bruto: string | undefined): PlanoVmDoNod[] {
  if (!bruto?.trim()) return [...PLANOS_VM_DO_NOD_PADRAO];
  try {
    const lido = JSON.parse(bruto) as unknown;
    if (!Array.isArray(lido)) return [...PLANOS_VM_DO_NOD_PADRAO];
    const validos = lido.filter((p): p is PlanoVmDoNod => !!p && typeof p === "object"
      && (p.id === "essencial" || p.id === "pro") && typeof p.nome === "string" && typeof p.tipo === "string" && /^[a-z0-9-]{3,40}$/.test(p.tipo)
      && [p.vcpu, p.memoriaGb, p.discoGb, p.precoMensalCentavos, p.horasIncluidas].every((n) => Number.isInteger(n) && n > 0));
    return validos.length ? validos : [...PLANOS_VM_DO_NOD_PADRAO];
  } catch {
    return [...PLANOS_VM_DO_NOD_PADRAO];
  }
}

/** A VM da pessoa: uma VM Linux pareada que não é o Mac nem o Windows dela, ou uma `nuvem` da ADR-121. */
const ehVmDaPessoa = (m: Pick<MaquinaDto, "plataforma" | "nuvem">) => !!m.nuvem || m.plataforma === "linux";
/** A VM do nod: a instância leva o prefixo `nod-box-` (nomeDaVmDoNod). */
const ehVmDoNod = (m: Pick<MaquinaDto, "nome">) => m.nome.startsWith(PREFIXO_VM_DO_NOD);

export const PREFIXO_VM_DO_NOD = "nod-box-";

export function opcoesOndeRoda(maquinas: readonly Pick<MaquinaDto, "plataforma" | "nuvem" | "nome">[], o: { vmDoNodLigada: boolean; planos: readonly PlanoVmDoNod[] }): OpcaoOndeRoda[] {
  const daPessoa = maquinas.filter((m) => !ehVmDoNod(m));
  return [
    {
      id: "maquina_da_pessoa",
      titulo: "Este computador",
      descricao: "O agente roda no seu Mac, Linux ou Windows, com as suas contas de IA. Para quando o computador dorme.",
      emUso: daPessoa.some((m) => !ehVmDaPessoa(m)),
      disponivel: true,
      motivo: null,
      padrao: true,
    },
    {
      id: "vm_da_pessoa",
      titulo: "Minha VM",
      descricao: "Uma VM sua, na sua conta de nuvem. Roda com o laptop fechado; o custo é seu.",
      emUso: daPessoa.some(ehVmDaPessoa),
      disponivel: true,
      motivo: null,
      padrao: false,
    },
    {
      id: "vm_do_nod",
      titulo: "VM do Nod",
      descricao: "O nod cuida de uma VM só sua: motor, computador e rotinas sempre de pé, sem configurar nada.",
      emUso: maquinas.some(ehVmDoNod),
      disponivel: o.vmDoNodLigada,
      motivo: o.vmDoNodLigada ? null : "Em teste fechado.",
      planos: [...o.planos],
      padrao: false,
    },
  ];
}

/** Nome estável da VM da pessoa no projeto do nod: um por pessoa (o Grok Bot também tem uma box por usuário). */
export function nomeDaVmDoNod(pessoaId: string): string {
  const limpo = pessoaId.toLowerCase().replace(/[^a-f0-9]/g, "");
  if (limpo.length < 12) throw new ErroDeDominio("entrada_invalida");
  return `${PREFIXO_VM_DO_NOD}${limpo.slice(0, 20)}`;
}

export type ConfigVmDoNod = { projeto: string; zona: string; rede: string };

/**
 * O pedido que vai para o provisionador. `requestId` é estável por pessoa e plano: a segunda tentativa do mesmo pedido
 * não cria outra VM (o Google responde 409, ADR-121). Os rótulos dizem de quem é a VM sem o e-mail da pessoa.
 */
export function pedidoVmDoNod(p: { tenantId: string; pessoaId: string; planoId: string; planos: readonly PlanoVmDoNod[]; config: ConfigVmDoNod; aceitouCobranca: boolean }): PedidoVmDoNod {
  if (!p.aceitouCobranca) throw new ErroDeDominio("nao_permitido");
  const plano = p.planos.find((x) => x.id === p.planoId);
  if (!plano) throw new ErroDeDominio("entrada_invalida");
  if (!/^[a-z][-a-z0-9]{4,28}[a-z0-9]$/.test(p.config.projeto) || !/^[a-z]+-[a-z]+[0-9]+-[a-z]$/.test(p.config.zona)) throw new ErroDeDominio("integracao_nao_configurada");
  const nome = nomeDaVmDoNod(p.pessoaId);
  const regiao = p.config.zona.replace(/-[a-z]$/, "");
  return {
    tenantId: p.tenantId,
    pessoaId: p.pessoaId,
    plano,
    ref: { projeto: p.config.projeto, zona: p.config.zona, nome },
    subrede: `projects/${p.config.projeto}/regions/${regiao}/subnetworks/${p.config.rede}`,
    requestId: `${nome}-${plano.id}`,
    rotulos: { "nod-box": "1", "nod-plano": plano.id },
  };
}

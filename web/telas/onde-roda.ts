import type { OpcaoOndeRoda, OpcoesOndeRodaDto, PlanoVmDoNod } from "../../src/contracts/vm-do-nod.ts";
import { esc } from "../lib/escape.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";

/**
 * ADR-167 (definido em 2026-11-12): a seção "Onde o agente roda" no topo de Máquinas, com as três opções da decisão 1 do
 * Marlon: este computador (padrão), minha VM e a VM do Nod (paga). Só leitura neste recorte: a 1ª e a 2ª já se usam pelas
 * linhas de máquina logo abaixo (parear, conectar a VM, dormir e acordar pelo Google); a 3ª mostra os planos e, desligada,
 * "Em teste fechado". Contratar (cobrança) é o próximo recorte e ganha ação no registro e caminho no chat junto.
 */

const reais = (centavos: number) => `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export function linhaDoPlano(p: PlanoVmDoNod): string {
  return `${p.nome}: ${p.vcpu} vCPU, ${p.memoriaGb} GB, ${p.horasIncluidas} h/mês acordada · ${reais(p.precoMensalCentavos)}/mês`;
}

function statusDa(o: OpcaoOndeRoda): { texto: string; tom: "ok" | "neutro" | "atencao" } | undefined {
  if (o.emUso) return { texto: "Em uso", tom: "ok" };
  if (!o.disponivel) return { texto: o.motivo ?? "Indisponível", tom: "neutro" };
  if (o.padrao) return { texto: "Padrão", tom: "neutro" };
  return undefined;
}

export function secaoOndeRoda(dto: OpcoesOndeRodaDto | null): string {
  if (!dto) return "";
  const linhas = dto.opcoes.map((o) => {
    const planos = o.planos?.length ? `<br>${o.planos.map((p) => esc(linhaDoPlano(p))).join("<br>")}` : "";
    const status = statusDa(o);
    return linhaConfig({
      titulo: o.titulo,
      detalheHtml: `${esc(o.descricao)}${planos}`,
      ...(status ? { status } : {}),
      classe: `onde-roda onde-roda-${o.id}`,
      attrs: `data-onde-roda="${esc(o.id)}"`,
    });
  });
  return grupoConfig("Onde o agente roda", linhas, {
    classe: "cfg-onde-roda",
    nota: dto.vmDoNod.ligada && dto.vmDoNod.driver === "seco"
      ? "A VM do Nod está em teste: o pedido é só calculado, nada é criado nem cobrado ainda."
      : "Você pode misturar: cada bot roda na máquina escolhida na ficha dele.",
  });
}

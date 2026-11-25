import type { IncidenteDto } from "../contracts/incidente.ts";
import type { Incidente } from "../contracts/incidente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { INCIDENTE_VISIVEL_MS, incidenteVisivel } from "../domain/incidente.ts";
import type { Repos } from "../repositories/tipos.ts";
import type { Deps } from "./tipos.ts";

/**
 * "Entendi" no aviso de queda (ADR-045): some da tela. Fechado e dispensado, não recebe queda nova — a
 * próxima abre aviso próprio (destinoDaQueda). Em curso e dispensado, as quedas da MESMA ausência ainda
 * somam nele, sem voltar à tela: a pessoa já sabe que o Mac está fora.
 */
export async function dispensarIncidente(deps: Pick<Deps, "repos" | "agora">, input: { incidenteId: string }): Promise<{ data: { incidente: Incidente } }> {
  const incidente = await deps.repos.incidentes.dispensar(input.incidenteId, deps.agora());
  if (!incidente) throw new ErroDeDominio("nao_encontrado", { cause: "incidente" });
  return { data: { incidente } };
}

/**
 * Os avisos que "Sua vez" mostra agora: não dispensados, até 12 h depois de a máquina voltar. Os
 * nomes dos agentes saem resolvidos (incluindo excluídos: o aviso fala do que aconteceu).
 */
export async function incidentesVisiveis(repos: Repos, agora: number): Promise<IncidenteDto[]> {
  const visiveis = (await repos.incidentes.visiveis(agora - INCIDENTE_VISIVEL_MS)).filter((i) => incidenteVisivel(i, agora));
  const nomes = new Map<string, string>();
  for (const id of new Set(visiveis.flatMap((i) => i.agentes))) nomes.set(id, (await repos.agentes.buscar(id, true))?.nome ?? "agente");
  // definido em 2026-10-09: a VM que caiu é nomeada. Revisto em 2026-11-22 (lote B, desvio 12): toda máquina com nome
  // vai pelo nome (ADR-187: nunca "seu Mac" para o que não é); sem a máquina (chave antiga), o aviso diz "Seu Mac".
  const linux = new Map<string, string>();
  for (const id of new Set(visiveis.flatMap((i) => (i.machineId ? [i.machineId] : [])))) {
    const m = await repos.maquinaTokens.identificar(id);
    if (m?.nome.trim()) linux.set(id, m.nome.trim());
  }
  return visiveis.map((i) => ({
    id: i.id,
    tipo: i.tipo,
    comecouEm: i.comecouEm,
    voltouEm: i.voltouEm,
    rotinas: i.rotinas,
    conversas: i.conversas,
    agentes: [...new Set(i.agentes.map((a) => nomes.get(a) ?? "agente"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    ...(i.machineId && linux.has(i.machineId) ? { maquina: linux.get(i.machineId) } : {}),
  }));
}

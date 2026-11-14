import type { SementeEstadoVivo } from "../domain/estado-vivo.ts";
import type { Deps } from "./tipos.ts";

/**
 * Item 5 (definido em 2026-11-12): o que o banco sabe do estado vivo da pessoa — os turnos `despachando` dela e as decisões
 * abertas (pendente ou reaberta) em que ela decide. Só lê; a projeção semeia sem pisar no que já viu.
 */
export async function sementeDoEstadoVivo(deps: Pick<Deps, "repos" | "agora">): Promise<SementeEstadoVivo> {
  const [turnos, decisoes] = await Promise.all([deps.repos.turnos.despachandoDaPessoa(), deps.repos.decisoes.listarSuaVez(deps.agora())]);
  return {
    vivos: turnos.map((t) => ({ agenteId: t.agenteId, turnoId: t.id, conversaId: t.conversaId })),
    decisoes: decisoes
      .filter((d) => d.estado === "pendente" || d.estado === "reaberta")
      .map((d) => ({ decisaoId: d.id, agenteId: d.agenteId, tipo: d.tipo, desde: Date.parse(d.criadoEm), venceEm: Number.isFinite(Date.parse(d.prazoDecisaoEm)) ? Date.parse(d.prazoDecisaoEm) : null })),
  };
}

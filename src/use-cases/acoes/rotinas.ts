import type { Rotina } from "../../contracts/rotina.ts";
import { pausarRotina } from "../pausar-rotina.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores únicos de pausar e ativar uma rotina (definido em 2026-11-11, NOD-412, ADR-135). A rota (POST
 * rotinas/:id/pausar e /ativar) e as ferramentas pausar_rotina/reativar_rotina (src/use-cases/rotinas-do-agente.ts)
 * passam por `pausarRotina`; o agendador também, na retomada marcada. `ate` = hora local no fuso da rotina.
 */
export const EXECUTORES_ROTINAS = {
  "rotinas.pausar": ((deps, input) => pausarRotina(deps, { rotinaId: input.rotinaId, estado: "pausada", retomarEm: input.retomarEm ?? null, ...(input.ate !== undefined ? { ate: input.ate } : {}) })) as CasoDeUso<{ rotinaId: string; ate?: string; retomarEm?: number | null }, { rotina: Rotina }>,
  "rotinas.ativar": ((deps, input) => pausarRotina(deps, { rotinaId: input.rotinaId, estado: "ativa" })) as CasoDeUso<{ rotinaId: string }, { rotina: Rotina }>,
} as const;

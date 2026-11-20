import type { MudancaLugarNavegador } from "../../contracts/navegador-do-bot.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import type { PreferenciasNavegador } from "../../repositories/navegador.repo.ts";
import { mudarLugarDoNavegador } from "../navegador-lugar.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * ADR-190 (N; ADR-135): o executor único de `navegador.lugar` — a tela (POST /agentes/:id/navegador/lugar, o Desfazer da
 * linha da conversa) e a `ajustar_navegador` do bot passam por ele.
 */
export const lugarDoNavegador: CasoDeUso<{ agenteId: string; mudanca: MudancaLugarNavegador }, PreferenciasNavegador> = async (deps, input) => ({
  data: await mudarLugarDoNavegador(deps, input.agenteId, input.mudanca),
});

export const EXECUTORES_NAVEGADOR = {
  "navegador.lugar": lugarDoNavegador,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;

import type { IdAcao } from "../../domain/acoes/index.ts";
import { exportarDecisoesCsv } from "../decisoes-do-bot.ts";
import type { CasoDeUso } from "../tipos.ts";

export const EXECUTORES_DECISOES = {
  "decisoes.exportar": exportarDecisoesCsv,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;

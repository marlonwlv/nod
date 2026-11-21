import type { MudancaLugarNavegador, RespostaMacDesligado } from "../../contracts/navegador-do-bot.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import type { PreferenciasNavegador } from "../../repositories/navegador.repo.ts";
import { mudarLugarDoNavegador } from "../navegador-lugar.ts";
import { responderMacDesligado } from "../navegador-mac-desligado.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * ADR-190 (N; ADR-135): o executor único de `navegador.lugar` — a tela (POST /agentes/:id/navegador/lugar, o Desfazer da
 * linha da conversa) e a `ajustar_navegador` do bot passam por ele.
 */
export const lugarDoNavegador: CasoDeUso<{ agenteId: string; mudanca: MudancaLugarNavegador }, PreferenciasNavegador> = async (deps, input) => ({
  data: await mudarLugarDoNavegador(deps, input.agenteId, input.mudanca),
});

/**
 * ADR-190 (K1; ADR-135): o que a rota de `navegador.mac_desligado` executa — "Fazer agora" (continua sem o Mac e o pedido
 * segue já) ou "Quando o Mac ligar" (o pedido segue quando o app do Mac voltar). Fora de EXECUTORES_NAVEGADOR: o caminho no
 * chat é parcial (a ajustar_navegador liga o continuar), e o mapa só leva ids com o caminho vivo.
 */
export const macDesligadoDoNavegador: CasoDeUso<{ agenteId: string; turnoId: string; resposta: RespostaMacDesligado }, { turnoId: string | null }> = async (deps, input) => {
  const r = await responderMacDesligado(deps, input.agenteId, input.turnoId, input.resposta);
  return { data: { turnoId: r.turnoId }, events: r.events };
};

export const EXECUTORES_NAVEGADOR = {
  "navegador.lugar": lugarDoNavegador,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;

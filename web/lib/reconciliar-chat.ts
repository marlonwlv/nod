import { conversaIdNaTela, type Estado, type Invalidacao } from "../estado/reducer.ts";

/** Definido em 2026-11-18: só a conversa visível com turno sem progresso, no máximo uma leitura a cada 15 s. */
export const INTERVALO_RECONCILIACAO_MS = 15_000;
export function invalidacoesDoChatSemProgresso(estado: Estado, agora: number, visivel: boolean): Invalidacao[] {
  if (!visivel || !estado.sessao) return [];
  const id = conversaIdNaTela(estado);
  if (!id) return [];
  const lidaEm = estado.conversas[id]?.carregadaEm ?? 0;
  const parado = Object.values(estado.turnosVivos).some((t) => t.conversaId === id && !t.trabalhoId && !t.bastidores
    && agora - Math.max(t.vistoEm ?? t.desde, lidaEm, estado.atividades[id]?.[t.turnoId]?.recebidoEm ?? 0) >= INTERVALO_RECONCILIACAO_MS);
  return parado ? [`conversa:${id}`] : [];
}

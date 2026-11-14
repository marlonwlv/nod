import { LIMITE_MENSAGENS_DESDE, type RespostaMensagensDesde } from "../contracts/estado-vivo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * `GET /conversas/:id/mensagens?depois_de=<updated_seq>&geracao=<g>` (definido em 2026-11-12, 0175): só o que mudou na
 * conversa depois do cursor do cliente, em ordem de mudança. `cursor_velho` quando a geração mudou (mensagens apagadas),
 * quando o cursor é do futuro (outro banco, restauração) ou quando passou de LIMITE_MENSAGENS_DESDE: o cliente relê a
 * página mais nova pelo GET de sempre.
 */
export const lerMensagensDesde: CasoDeUso<{ conversaId: string; depoisDe: number; geracao: number }, RespostaMensagensDesde> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  const cursor = conversa ? await deps.repos.mensagens.cursorDaConversa(conversa.id) : null;
  if (!conversa || !cursor) throw new ErroDeDominio("nao_encontrado");
  if (cursor.geracao !== input.geracao || input.depoisDe > cursor.updated_seq) return { data: { cursor_velho: true, cursor } };
  const mudadas = await deps.repos.mensagens.mudadasDesde(conversa.id, input.depoisDe, LIMITE_MENSAGENS_DESDE, { comDestino: conversa.tipo === "propria" });
  if (mudadas.length > LIMITE_MENSAGENS_DESDE) return { data: { cursor_velho: true, cursor } };
  const ultimo = mudadas.at(-1)?.updated_seq ?? input.depoisDe;
  // O cursor devolvido é o da última linha lida (nunca à frente dela): o que mudou depois do SELECT sai na próxima.
  return { data: { cursor_velho: false, cursor: { geracao: cursor.geracao, updated_seq: Math.max(ultimo, input.depoisDe) }, mensagens: mudadas } };
};

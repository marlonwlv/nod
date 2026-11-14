import type { StatusDoEnvio } from "../contracts/estado-vivo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * `GET /conversas/:id/envios/:idEnvio` (definido em 2026-11-12): o que aconteceu com a fala que o cliente mandou com este
 * `idEnvio`. `nao_encontrado`: o servidor não tem a fala (o POST não chegou; o cliente pode reenviar com o mesmo id, que é
 * idempotente). `pendente`: gravada, o turno dela ainda espera. `rejeitado`: o turno foi cancelado antes de rodar.
 * `aceito`: o bot leu (o turno rodou, ou a fala entrou num turno que já rodava ou num seguinte).
 */
export const statusDoEnvio: CasoDeUso<{ conversaId: string; idEnvio: string }, { estado: StatusDoEnvio; mensagemId: string | null }> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const m = await deps.repos.mensagens.buscarPorIdEnvio(conversa.id, input.idEnvio);
  if (!m) return { data: { estado: "nao_encontrado", mensagemId: null } };
  const t = await deps.repos.turnos.buscarPorMensagemOrigem(m.id);
  if (t?.estado === "pendente") return { data: { estado: "pendente", mensagemId: m.id } };
  if (t?.estado === "interrompido" && t.motivoInterrupcao === "parado_pela_pessoa" && !t.sinais.attempted) return { data: { estado: "rejeitado", mensagemId: m.id } };
  return { data: { estado: "aceito", mensagemId: m.id } };
};

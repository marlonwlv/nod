/**
 * ADR-172 (definido em 2026-11-12): TURNO POR MEMBRO na sala (pedir a vez de um
 * membro e entregar o resultado dela). A sala da ADR-027 já tem rodadas, políticas de quem responde, teto de handoffs e
 * orçamento; o que entra é a VEZ: quem fala agora, numa sala com vários bots E várias pessoas.
 *
 * Regras:
 *   - uma vez de cada vez: a vez é de um membro (bot ou pessoa) até ele entregar, passar ou o prazo vencer;
 *   - quem pede a vez entra na fila uma vez só; pessoa pedindo passa na frente dos bots (a pessoa nunca espera bot);
 *   - bot sem entregar no prazo perde a vez (`vencida`), e o próximo da fila fala — a sala não trava num bot mudo;
 *   - pessoa na vez não tem prazo: se ela sai, a vez passa sozinha a quem pediu.
 * Puro: o relógio e os ids vêm de fora.
 */
export type TipoMembro = "bot" | "pessoa";
export type MembroDaVez = { id: string; tipo: TipoMembro };
export type Vez = { membro: MembroDaVez; desde: number; pedidoId: string };
export type EstadoDaVez = { atual: Vez | null; fila: { membro: MembroDaVez; pedidoId: string; em: number }[] };
export type DesfechoDaVez = "entregou" | "passou" | "vencida" | "saiu";

/** definido em 2026-11-12: o bot tem 10 min para entregar a vez (um turno longo cabe; um bot mudo não segura a sala). */
export const PRAZO_VEZ_DO_BOT_MS = 10 * 60_000;
export const TETO_FILA_DA_VEZ = 20;

export const salaVazia = (): EstadoDaVez => ({ atual: null, fila: [] });

/** Pede a vez. Devolve o estado novo e se a vez já começou (a sala estava livre). */
export function pedirVez(e: EstadoDaVez, membro: MembroDaVez, pedidoId: string, agora: number): { estado: EstadoDaVez; comecou: boolean } {
  if (e.atual?.membro.id === membro.id || e.fila.some((f) => f.membro.id === membro.id)) return { estado: e, comecou: false };
  if (!e.atual) return { estado: { atual: { membro, desde: agora, pedidoId }, fila: e.fila }, comecou: true };
  if (e.fila.length >= TETO_FILA_DA_VEZ) return { estado: e, comecou: false };
  const item = { membro, pedidoId, em: agora };
  // Pessoa na frente dos bots, mantida a ordem entre pessoas.
  const fila = membro.tipo === "pessoa"
    ? [...e.fila.filter((f) => f.membro.tipo === "pessoa"), item, ...e.fila.filter((f) => f.membro.tipo === "bot")]
    : [...e.fila, item];
  return { estado: { atual: e.atual, fila }, comecou: false };
}

/** Fecha a vez de quem fala (só o próprio, pelo pedido dele) e passa ao próximo. */
export function fecharVez(e: EstadoDaVez, pedidoId: string, agora: number): { estado: EstadoDaVez; proxima: Vez | null } {
  if (!e.atual || e.atual.pedidoId !== pedidoId) return { estado: e, proxima: null };
  const [prox, ...resto] = e.fila;
  const proxima = prox ? { membro: prox.membro, desde: agora, pedidoId: prox.pedidoId } : null;
  return { estado: { atual: proxima, fila: resto }, proxima };
}

/** A vez do bot que passou do prazo vence; a da pessoa nunca. Devolve o pedido vencido para assentar como `vencida`. */
export function vencerVez(e: EstadoDaVez, agora: number, prazoBotMs = PRAZO_VEZ_DO_BOT_MS): { estado: EstadoDaVez; vencido: string | null; proxima: Vez | null } {
  if (!e.atual || e.atual.membro.tipo !== "bot" || agora - e.atual.desde <= prazoBotMs) return { estado: e, vencido: null, proxima: null };
  const vencido = e.atual.pedidoId;
  const r = fecharVez(e, vencido, agora);
  return { estado: r.estado, vencido, proxima: r.proxima };
}

/** O membro saiu da sala: some da fila e, se era a vez dele, ela passa. */
export function sairDaSala(e: EstadoDaVez, membroId: string, agora: number): { estado: EstadoDaVez; proxima: Vez | null } {
  const semEle = { atual: e.atual, fila: e.fila.filter((f) => f.membro.id !== membroId) };
  if (semEle.atual?.membro.id !== membroId) return { estado: semEle, proxima: null };
  return fecharVez(semEle, semEle.atual.pedidoId, agora);
}

import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-11-25 (pedido do Marlon): o computador do bot fica desligado no Mac e no Windows até a reestruturação
 * do computador, e o bot usa só o navegador (ADR-190). No modo motor (`soNoLinux`), a pessoa sem máquina Linux viva fica
 * sem computador: o plano sai sem `computador_*` e sem o "seu computador está fora do ar" no prompt (que fazia o bot
 * recusar o navegador também), a frota não acende o fora do ar e GET /computador responde 404. Com máquina Linux, nada
 * muda. Sem o serviço de computadores, false.
 */
export async function computadorTemLugar(deps: Pick<Deps, "services" | "repos">): Promise<boolean> {
  const c = deps.services.computadores;
  if (!c) return false;
  return c.soNoLinux === true ? deps.repos.maquinaTokens.temLinuxViva() : true;
}

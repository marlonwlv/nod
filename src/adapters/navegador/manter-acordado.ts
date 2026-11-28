import type { MotorNavegador } from "./motor-agent-browser.ts";

/**
 * 2026-11-28: enquanto alguém assiste, o daemon do agent-browser não pode morrer de ócio (ele conta só os comandos; a
 * entrada pelo CDP e o olhar da pessoa não contam). Um comando barato a cada minuto (`stream status`, ~20 ms) o mantém.
 */
export const ACORDADO_A_CADA_MS = 60_000;
export function manterAcordado(motor: Pick<MotorNavegador, "portaDoStream">, agenteId: string, aberto: () => boolean, aCada = ACORDADO_A_CADA_MS): void {
  const t = setInterval(() => {
    if (!aberto()) { clearInterval(t); return; }
    void motor.portaDoStream({ agenteId }).catch(() => undefined);
  }, aCada);
  t.unref?.();
}

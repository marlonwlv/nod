import { log } from "../../obs/log.ts";
import type { Navegadores } from "./navegadores.ts";

/**
 * definido em 2026-11-20 (ADR-190, decisão 8; D0): uma volta por minuto fecha os Chromes parados há 10 min
 * (`deveriaPausar`), guardando as abas para o `retomar`. O estado dos navegadores é deste processo (sem banco); o laço
 * segue a regra do deploy azul/verde mesmo assim: liga com a cor ativa e para na drenagem (AGENTS.md).
 */
export const INTERVALO_VARREDOR_NAVEGADORES_MS = 60_000;

export function iniciarVarredorNavegadores(p: { navegadores: Pick<Navegadores, "pausarOciosos">; intervaloMs?: number }): { parar(): Promise<void> } {
  let emVoo: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (emVoo) return;
    emVoo = p.navegadores.pausarOciosos()
      .then((n) => { if (n > 0) log("info", "navegadores_pausados", { quantos: n }); })
      .catch((e: unknown) => log("erro", "varredor_navegadores_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => { emVoo = null; });
  }, p.intervaloMs ?? INTERVALO_VARREDOR_NAVEGADORES_MS);
  timer.unref?.();
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}

import type { VistaNavegador } from "../../contracts/navegador-do-bot.ts";
import { camposQueMudaram } from "../../domain/navegador-vista.ts";
import type { Escopo } from "../../shared/types.ts";

/**
 * O frame SSE `navegador.mudou` (ADR-190): {agenteId, mudou} — o bot e os campos da vista que mudaram, nunca a vista. A
 * web relê por REST (AGENTS.md). definido em 2026-11-20: no máximo um a cada 250 ms por bot (~4/s); o que mudou no
 * meio sai junto no próximo, comparado com a última vista publicada.
 */
export const INTERVALO_AVISO_MS = 250;

export type DadosNavegadorMudou = { agenteId: string; mudou: (keyof VistaNavegador)[] };

type PorBot = { pessoaId: string; anterior: VistaNavegador | null; pendente: VistaNavegador | null; ultimoEm: number; timer: ReturnType<typeof setTimeout> | null };

export function criarAvisoNavegadorMudou(o: { publicar(pessoaId: string, dados: DadosNavegadorMudou): void; intervaloMs?: number; agora?: () => number }) {
  const intervalo = o.intervaloMs ?? INTERVALO_AVISO_MS;
  const agora = o.agora ?? (() => Date.now());
  const bots = new Map<string, PorBot>();

  function soltar(b: PorBot): void {
    b.timer = null;
    const vista = b.pendente;
    if (!vista) return;
    b.pendente = null;
    b.ultimoEm = agora();
    const mudou = camposQueMudaram(b.anterior, vista);
    b.anterior = vista;
    if (mudou.length) o.publicar(b.pessoaId, { agenteId: vista.agenteId, mudou });
  }

  return {
    mudou(escopo: Escopo, vista: VistaNavegador): void {
      const k = `${escopo.tenantId}:${escopo.pessoaId}:${vista.agenteId}`;
      const b = bots.get(k) ?? { pessoaId: escopo.pessoaId, anterior: null, pendente: null, ultimoEm: -Infinity, timer: null };
      bots.set(k, b);
      b.pendente = vista;
      if (b.timer) return;
      const falta = intervalo - (agora() - b.ultimoEm);
      if (falta <= 0) { soltar(b); return; }
      b.timer = setTimeout(() => soltar(b), falta);
      b.timer.unref?.();
    },
    parar(): void {
      for (const b of bots.values()) if (b.timer) { clearTimeout(b.timer); b.timer = null; }
    },
  };
}

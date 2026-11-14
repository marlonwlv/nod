/**
 * C3 (definido em 2026-11-12, fase 0 da migração do front): o motor do mascote sobrevive ao elemento recriado. A barra
 * lateral (e qualquer região regravada por innerHTML) tira o `<nod-mascote>` e põe outro igual no mesmo instante; o motor
 * novo nascia em repouso e fundia de novo para o estado — o mascote "voltava ao repouso" a cada regravação. Quem sai guarda
 * o motor pela chave (`data-motor`: o bot e o tamanho); quem entra com a mesma chave, logo depois, o retoma.
 */
export const MOTOR_GUARDADO_MS = 1000;

export type MotorGuardado<M> = { motor: M; tempo: number; aplicado: string; mudou: number };

export function criarGuardaDeMotores<M>(agora: () => number) {
  const guardados = new Map<string, MotorGuardado<M> & { em: number }>();
  const podar = (t: number): void => { for (const [k, g] of guardados) if (t - g.em >= MOTOR_GUARDADO_MS) guardados.delete(k); };
  return {
    guardar(chave: string | null, g: MotorGuardado<M>): void {
      if (!chave) return;
      const t = agora();
      podar(t);
      guardados.set(chave, { ...g, em: t });
    },
    /** O motor guardado para a chave há menos de MOTOR_GUARDADO_MS; sai da guarda (um elemento só o retoma). */
    retomar(chave: string | null): MotorGuardado<M> | null {
      if (!chave) return null;
      const g = guardados.get(chave);
      guardados.delete(chave);
      if (!g || agora() - g.em >= MOTOR_GUARDADO_MS) return null;
      const { em: _em, ...resto } = g;
      return resto;
    },
    tamanho: (): number => guardados.size,
  };
}

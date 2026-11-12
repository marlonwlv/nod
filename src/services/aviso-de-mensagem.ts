import type { TipoFrame } from "../contracts/frame.ts";
import type { Barramento } from "./barramento.ts";

/**
 * C1 (definido em 2026-11-12): a fala da pessoa vai ao executor por evento, não pela checagem de 3 s. O laço fica num
 * long-poll (`aguardar`) e o servidor o acorda quando publica, para a pessoa, um frame que pode trazer algo para a sessão
 * viva: a fala nova (`mensagem.nova`/`turno.iniciado` do turno pendente), o recado do quadro e o trabalho que mudou.
 *
 * Por pessoa, sem banco: um acordar a mais só custa uma renovação (que já se junta à que estiver no ar). Um aviso perdido
 * (reinício) não perde a fala: a batida do lease (30 s) renova e a pede do mesmo jeito.
 */
export interface AvisoDeMensagem {
  avisar(pessoaId: string): void;
  /** Volta `true` no próximo aviso desta pessoa, ou `false` quando `ms` vence. */
  aguardar(pessoaId: string, ms: number): Promise<boolean>;
  /** Quantos estão esperando (teste e métrica). */
  esperando(pessoaId: string): number;
}

/** Os frames que acordam o laço (os outros não trazem nada que a renovação entregue à sessão). */
export const FRAMES_QUE_ACORDAM: ReadonlySet<TipoFrame> = new Set<TipoFrame>(["mensagem.nova", "turno.iniciado", "trabalho.mudou", "quadro.mudou"]);

export function criarAvisoDeMensagem(): AvisoDeMensagem {
  const porPessoa = new Map<string, Set<(v: boolean) => void>>();
  return {
    avisar(pessoaId) {
      const fila = porPessoa.get(pessoaId);
      if (!fila) return;
      porPessoa.delete(pessoaId);
      for (const acordar of fila) acordar(true);
    },
    aguardar(pessoaId, ms) {
      return new Promise<boolean>((ok) => {
        let fila = porPessoa.get(pessoaId);
        if (!fila) {
          fila = new Set();
          porPessoa.set(pessoaId, fila);
        }
        const acordar = (v: boolean) => {
          clearTimeout(prazo);
          ok(v);
        };
        const prazo = setTimeout(() => {
          const atual = porPessoa.get(pessoaId);
          atual?.delete(acordar);
          if (atual?.size === 0) porPessoa.delete(pessoaId);
          ok(false);
        }, Math.max(0, ms));
        prazo.unref?.();
        fila.add(acordar);
      });
    },
    esperando: (pessoaId) => porPessoa.get(pessoaId)?.size ?? 0,
  };
}

/** Decora o barramento: o frame publicado que acorda vai também ao aviso. */
export function comAvisoDeMensagem(interno: Barramento, aviso: AvisoDeMensagem): Barramento {
  return {
    ...interno,
    publicar(pessoaId, tipo, dados) {
      const f = interno.publicar(pessoaId, tipo, dados);
      if (FRAMES_QUE_ACORDAM.has(tipo)) aviso.avisar(pessoaId);
      return f;
    },
  };
}

import { createHash } from "node:crypto";
import { aadDaChaveDoTenant, FalhaDoCofre, gerarChave, TAMANHO_CHAVE, zerar } from "../../db/cifra-envelope.ts";
import type { ChaveMestra } from "./chave-mestra.ts";

/**
 * As chaves de tenant abertas em memória (definido em 2026-11-24, ADR-195 §2, "KMS fora do ar"): a chave decifrada fica
 * no processo por até 10 minutos, por tenant e versão. Dentro do prazo o cofre funciona com o KMS fora; depois, a abertura
 * volta ao KMS e, se ele não responder, falha fechado (`FalhaDoCofre`), nunca com uma chave vencida.
 *
 * A entrada do cache também leva o hash da chave embrulhada: uma linha recriada (a transação que criou a versão 1 voltou
 * atrás e outra criou de novo, com outra chave) ou reembrulhada nunca casa com a chave aberta de antes.
 * Quem recebe a chave recebe uma CÓPIA e a zera quando termina; a do cache é zerada quando vence.
 */
export const TTL_CHAVE_DO_TENANT_MS = 10 * 60_000;

export type LinhaDaChaveDoTenant = { tenantId: string; versao: number; chaveEmbrulhada: string };

export interface ChavesDoTenant {
  readonly mestra: ChaveMestra;
  /** A chave do tenant aberta (cópia do chamador): do cache dentro do TTL, senão pela mestra. */
  abrir(linha: LinhaDaChaveDoTenant): Promise<Buffer>;
  /** Uma chave nova embrulhada pela mestra. Só entra no cache por `lembrar`, depois que a linha foi gravada. */
  criar(tenantId: string, versao: number): Promise<{ chave: Buffer; chaveEmbrulhada: string; mestraRef: string }>;
  /** Põe no cache a chave de uma linha que acabou de ser gravada (guarda uma cópia). */
  lembrar(linha: LinhaDaChaveDoTenant, chave: Buffer): void;
  /** Tira do cache (zera) as chaves do tenant. */
  esquecer(tenantId: string): void;
}

export function criarChavesDoTenant(o: { mestra: ChaveMestra; agora?: () => number; ttlMs?: number }): ChavesDoTenant {
  const agora = o.agora ?? Date.now;
  const ttlMs = o.ttlMs ?? TTL_CHAVE_DO_TENANT_MS;
  const cache = new Map<string, { tenantId: string; chave: Buffer; expiraEm: number }>();
  const emVoo = new Map<string, Promise<Buffer>>();

  const chaveDoCache = (l: LinhaDaChaveDoTenant): string =>
    `${l.tenantId}|${l.versao}|${createHash("sha256").update(l.chaveEmbrulhada).digest("base64")}`;

  function varrer(t: number): void {
    for (const [k, e] of cache) {
      if (t >= e.expiraEm) {
        zerar(e.chave);
        cache.delete(k);
      }
    }
  }

  function guardar(k: string, tenantId: string, chave: Buffer): void {
    cache.set(k, { tenantId, chave: Buffer.from(chave), expiraEm: agora() + ttlMs });
  }

  return {
    mestra: o.mestra,
    async abrir(linha) {
      const t = agora();
      varrer(t);
      const k = chaveDoCache(linha);
      const viva = cache.get(k);
      if (viva) return Buffer.from(viva.chave);
      // Duas aberturas ao mesmo tempo fazem um pedido só à mestra; cada uma sai com a própria cópia.
      let pedido = emVoo.get(k);
      if (!pedido) {
        pedido = (async () => {
          const chave = await o.mestra.desembrulhar(linha.chaveEmbrulhada, aadDaChaveDoTenant(linha.tenantId, linha.versao));
          if (chave.length !== TAMANHO_CHAVE) {
            zerar(chave);
            throw new FalhaDoCofre("cifra_invalida");
          }
          // O cache fica com este Buffer (zerado quando vence); ninguém de fora recebe ele, só cópias.
          cache.set(k, { tenantId: linha.tenantId, chave, expiraEm: agora() + ttlMs });
          return chave;
        })().finally(() => emVoo.delete(k));
        emVoo.set(k, pedido);
      }
      return Buffer.from(await pedido);
    },
    async criar(tenantId, versao) {
      const chave = gerarChave();
      try {
        const { embrulhada, mestraRef } = await o.mestra.embrulhar(chave, aadDaChaveDoTenant(tenantId, versao));
        return { chave, chaveEmbrulhada: embrulhada, mestraRef };
      } catch (e) {
        zerar(chave);
        throw e;
      }
    },
    lembrar(linha, chave) {
      guardar(chaveDoCache(linha), linha.tenantId, chave);
    },
    esquecer(tenantId) {
      for (const [k, e] of cache) {
        if (e.tenantId === tenantId) {
          zerar(e.chave);
          cache.delete(k);
        }
      }
    },
  };
}

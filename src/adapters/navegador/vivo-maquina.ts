import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RespostaRelayNavegador } from "../../contracts/navegador-maquina.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { CanalNavegador } from "./canal-maquina.ts";
import { lerJson } from "./stream-local.ts";
import type { CanalVivoNavegador, FonteDoVivo } from "./vivo.ts";

/**
 * A vista ao vivo vinda da máquina da pessoa (ADR-190, decisão 5): o servidor nunca disca (ADR-021). Quando alguém abre a
 * vista de um bot que roda no Mac ou numa máquina sempre ligada, o servidor põe `assistir` na fila daquela máquina, com um
 * token de uso único; a máquina liga o stream local do Chrome do bot e abre o WebSocket de saída
 * `/api/maquina/navegador/vivo/:agenteId?t=<token>` (o WebSocket global não leva header; o token só saiu pela puxada
 * escopada da chave daquela máquina, como o da tela do computador, `src/adapters/computador/vivo.ts`). Pareado, o
 * WebSocket vira a `FonteDoVivo` do canal da web: as mensagens do stream sobem como vieram, a entrada desce como
 * `{t:"entrada"}` e o texto/atalho como `{t:"relay"}`, com a resposta da máquina.
 *
 * Parar de assistir é fechar o WebSocket (qualquer lado): a máquina fecha o stream local junto.
 */

/** definido em 2026-11-20: da fila até o WebSocket da máquina chegar (a puxada leva até 20 s para acordar, mais a rede). */
export const PRAZO_PAR_MS = 30_000;
/** definido em 2026-11-20: o relay da máquina tem o mesmo prazo do relay local (30 s). */
const PRAZO_RELAY_MS = 30_000;

type Esperando = { escopo: Escopo; token: string; promessa: Promise<FonteDoVivo | null>; resolver: (f: FonteDoVivo | null) => void; relogio: ReturnType<typeof setTimeout> };

export type VivoDaMaquina = ReturnType<typeof criarVivoDaMaquina>;

export function criarVivoDaMaquina(o: { canal: CanalNavegador; maquinaDoBot(escopo: Escopo, agenteId: string): string | null; prazoParMs?: number }) {
  const esperando = new Map<string, Esperando>();
  const chave = (escopo: Escopo, agenteId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${agenteId}`;

  function fonteDoSocket(agenteId: string, canal: CanalVivoNavegador): FonteDoVivo {
    let proximo = 1;
    const relays = new Map<number, (ok: boolean) => void>();
    const leitores: ((texto: string) => void)[] = [];
    const fechados: (() => void)[] = [];
    canal.aoMensagem((m) => {
      if (!("texto" in m)) return;
      // A resposta do relay é a única mensagem da máquina que não é do stream (o stream sempre começa com `type`).
      if (m.texto.startsWith('{"t":"relay"')) {
        const r = lerJson(m.texto) as Partial<RespostaRelayNavegador> | null;
        const fim = typeof r?.id === "number" ? relays.get(r.id) : undefined;
        if (fim) { relays.delete(r!.id!); fim(r!.ok === true); }
        return;
      }
      for (const f of leitores) f(m.texto);
    });
    canal.aoFechar(() => {
      for (const fim of relays.values()) fim(false);
      relays.clear();
      for (const f of fechados) f();
    });
    return {
      stream: {
        enviar: (mensagem) => canal.enviarJson({ t: "entrada", mensagem }),
        fechar: () => canal.fechar(1000),
        aoMensagem: (fn) => { leitores.push(fn); },
        aoFechar: (fn) => { fechados.push(fn); },
      },
      relay: (comando) => new Promise<boolean>((resolver) => {
        const id = proximo++;
        const relogio = setTimeout(() => { relays.delete(id); log("aviso", "navegador_relay_sem_resposta", { agente_id: agenteId }); resolver(false); }, PRAZO_RELAY_MS);
        relogio.unref?.();
        relays.set(id, (ok) => { clearTimeout(relogio); resolver(ok); });
        canal.enviarJson({ t: "relay", id, comando });
      }),
    };
  }

  return {
    /** O canal ao vivo da web pediu a fonte de um bot remoto: pede à máquina e espera o WebSocket dela (ou null). */
    abrir(escopo: Escopo, agenteId: string): Promise<FonteDoVivo | null> {
      const k = chave(escopo, agenteId);
      const ja = esperando.get(k);
      if (ja) return ja.promessa;
      const maquinaId = o.maquinaDoBot(escopo, agenteId);
      if (!maquinaId) return Promise.resolve(null);
      const token = randomBytes(32).toString("base64url");
      let resolver!: (f: FonteDoVivo | null) => void;
      const promessa = new Promise<FonteDoVivo | null>((r) => { resolver = r; });
      const fim = (f: FonteDoVivo | null) => {
        const e = esperando.get(k);
        if (e?.token !== token) return;
        esperando.delete(k);
        clearTimeout(e.relogio);
        resolver(f);
      };
      const relogio = setTimeout(() => fim(null), o.prazoParMs ?? PRAZO_PAR_MS);
      relogio.unref?.();
      esperando.set(k, { escopo, token, promessa, resolver: fim, relogio });
      // A máquina responde depois de discar; uma recusa dela (sem Chrome vivo, sem stream) solta a espera na hora.
      void o.canal.enviar(escopo, maquinaId, { tipo: "assistir", agenteId, token }, o.prazoParMs ?? PRAZO_PAR_MS).then((r) => {
        if (!r.ok) { log("aviso", "navegador_vivo_maquina_recusou", { agente_id: agenteId, motivo: r.motivo }); fim(null); }
      });
      return promessa;
    },
    /**
     * A máquina chegou com o token. Confere em tempo constante e só para a espera daquele bot; uso único. false = recusado
     * (o upgrade fecha com 4403).
     */
    anexar(agenteId: string, token: string, canal: CanalVivoNavegador): boolean {
      for (const [k, e] of esperando) {
        if (!k.endsWith(`:${agenteId}`)) continue;
        const a = Buffer.from(token);
        const b = Buffer.from(e.token);
        if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
        e.resolver(fonteDoSocket(agenteId, canal));
        return true;
      }
      log("aviso", "navegador_vivo_token_errado", { agente_id: agenteId });
      return false;
    },
    /** Só testes. */
    esperando: () => esperando.size,
  };
}

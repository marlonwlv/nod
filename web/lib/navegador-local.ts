import type { EntradaNavegador, EstadoNavegador } from "../../src/contracts/navegador-do-bot.ts";
import type { PonteNavegadorLocal } from "../../src/contracts/navegador-local.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a vista local do navegador do bot pela ponte do app
 * (`window.nodDesktop.navegadorLocal`). Um ouvinte só para a ponte inteira (a ponte guarda um), repartido por vista; as
 * mensagens que chegam antes de a vista saber o próprio id (o IPC da resposta e o dos quadros correm separados) esperam
 * um pouco aqui.
 */

export type VistaLocalAberta = {
  enviar(e: EntradaNavegador): Promise<boolean>;
  fechar(): void;
};

const ouvintes = new Map<string, (texto: string) => void>();
const antesDoId = new Map<string, string[]>();
const ANTES_MAX = 32;
let ligada: PonteNavegadorLocal | null = null;

/** O Chrome do bot está de pé (a mesma regra do servidor, `temChromeVivo`): só então a vista local tem o que mostrar. */
export function chromeVivo(estado: EstadoNavegador): boolean {
  return estado === "ao_vivo" || estado === "rede_fraca" || estado === "terminou";
}

/** A ponte do app, se esta janela é do app do nod (no navegador comum, null). */
export function ponteDoApp(): PonteNavegadorLocal | null {
  const p = (globalThis as { nodDesktop?: { navegadorLocal?: PonteNavegadorLocal } }).nodDesktop?.navegadorLocal;
  return p && typeof p.abrir === "function" ? p : null;
}

function ligar(ponte: PonteNavegadorLocal): void {
  if (ligada === ponte) return;
  ligada = ponte;
  ponte.aoMensagem((id, texto) => {
    const fn = ouvintes.get(id);
    if (fn) { fn(texto); return; }
    const fila = antesDoId.get(id) ?? [];
    if (fila.length < ANTES_MAX) fila.push(texto);
    antesDoId.set(id, fila);
    if (antesDoId.size > 16) antesDoId.delete(antesDoId.keys().next().value!);
  });
}

/** Abre a vista local de um bot; null = não há o Chrome dele neste computador (a vista segue pelo servidor). */
export async function abrirVistaLocal(ponte: PonteNavegadorLocal, agenteId: string, aoMensagem: (texto: string) => void): Promise<VistaLocalAberta | null> {
  ligar(ponte);
  const id = await ponte.abrir(agenteId).catch(() => null);
  if (!id) return null;
  ouvintes.set(id, aoMensagem);
  for (const t of antesDoId.get(id) ?? []) aoMensagem(t);
  antesDoId.delete(id);
  let aberta = true;
  return {
    enviar: (e) => (aberta ? ponte.enviar(id, e).catch(() => false) : Promise.resolve(false)),
    fechar: () => {
      if (!aberta) return;
      aberta = false;
      ouvintes.delete(id);
      void ponte.fechar(id).catch(() => undefined);
    },
  };
}

/** O quadro da vista local (o `frame` do stream do agent-browser), conferido como no servidor. */
export function quadroDoStream(m: Record<string, unknown>): { jpeg: string; w: number; h: number } | null {
  const meta = m.metadata as { deviceWidth?: unknown; deviceHeight?: unknown } | undefined;
  if (typeof m.data !== "string" || !m.data.startsWith("/9j/") || !meta) return null;
  const w = meta.deviceWidth;
  const h = meta.deviceHeight;
  if (typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 8192 || h > 8192) return null;
  return { jpeg: m.data, w, h };
}

/**
 * A fila da entrada local: uma por vez, cada uma esperando a confirmação do Chrome. O mouse andando dá lugar ao seguinte.
 * Não confirmada, a entrada tenta de novo (até `tentativas`); se ainda assim não vai, `aoFalhar` recebe ela e o que
 * estava atrás (para ir pelo servidor, sem perder o que foi digitado).
 */
export function criarFilaLocal(o: {
  enviar: (e: EntradaNavegador) => Promise<boolean>;
  aoFalhar: (pendentes: EntradaNavegador[]) => void;
  aoConfirmar?: (e: EntradaNavegador) => void;
  tentativas?: number;
  esperarMs?: number;
}): { colocar(e: EntradaNavegador): void; tamanho(): number } {
  const fila: EntradaNavegador[] = [];
  let andando = false;
  let falhou = false;
  const tentativas = o.tentativas ?? 3;
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const andaSozinho = (e: EntradaNavegador) => e.t === "mouse" && e.evento === "mouseMoved";

  async function andar(): Promise<void> {
    if (andando) return;
    andando = true;
    try {
      while (fila.length && !falhou) {
        const e = fila[0]!;
        let ok = false;
        for (let i = 0; i < tentativas && !ok; i++) {
          if (i) await esperar((o.esperarMs ?? 150) * i);
          ok = await o.enviar(e);
          // O mouse andando não insiste: o próximo movimento leva a posição nova.
          if (!ok && andaSozinho(e)) break;
        }
        if (!ok && !andaSozinho(e)) {
          falhou = true;
          o.aoFalhar(fila.splice(0).filter((x) => !andaSozinho(x)));
          return;
        }
        fila.shift();
        if (ok) o.aoConfirmar?.(e);
      }
    } finally {
      andando = false;
    }
  }

  return {
    colocar(e) {
      if (falhou) { o.aoFalhar([e]); return; }
      const ultimo = fila.at(-1);
      if (andaSozinho(e) && ultimo && andaSozinho(ultimo) && fila.length > 1) fila[fila.length - 1] = e;
      else fila.push(e);
      void andar();
    },
    tamanho: () => fila.length,
  };
}

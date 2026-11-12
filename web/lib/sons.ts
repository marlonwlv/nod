/**
 * ADR-167 (sons de aviso): dois sons curtos e opcionais — um "blip" quando chega mensagem nova de um bot e um "chime"
 * de duas notas quando um bot pede aprovação ou resposta. Desligados por padrão; a escolha é deste computador (como o
 * tema), em Configurações › Geral › Sons. Sintetizados com Web Audio: nenhum arquivo de áudio, nada de rede.
 *
 * Puro onde dá: as notas, a escolha guardada e a regra de quando tocar são funções; o `AudioContext` entra por parâmetro.
 * Não depende de framework: quem chama é o laço de leitura da web (web/main.ts).
 */
import { novasAbertas, novasMensagens } from "./avisos.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";

export type TipoSom = "mensagem" | "aprovacao";
export type EscolhaSons = Record<TipoSom, boolean>;

export const CHAVE_SONS = "nod.sons";
export const SONS_PADRAO: EscolhaSons = { mensagem: false, aprovacao: false };

/** Uma nota: frequência (Hz), quando começa e quanto dura (s), e o volume de pico (0–1). */
export type Nota = { freq: number; inicio: number; dur: number; ganho: number };

/**
 * definido em 2026-11-12 (sons curtos, macios, sem susto): blip de 90 ms subindo uma quinta; chime de
 * duas notas (mi e si) com cauda de 220 ms. Volume baixo: são avisos, não alarme.
 */
export function notasDoSom(tipo: TipoSom): Nota[] {
  if (tipo === "mensagem") return [{ freq: 880, inicio: 0, dur: 0.09, ganho: 0.08 }, { freq: 1320, inicio: 0.05, dur: 0.09, ganho: 0.06 }];
  return [{ freq: 659.25, inicio: 0, dur: 0.22, ganho: 0.1 }, { freq: 987.77, inicio: 0.12, dur: 0.26, ganho: 0.09 }];
}

/** definido em 2026-11-12: dois avisos do mesmo tipo em menos de 1,5 s viram um som só (leituras em rajada). */
export const INTERVALO_MIN_MS = 1500;

export function podeTocar(ultimo: number, agora: number): boolean {
  return agora - ultimo >= INTERVALO_MIN_MS;
}

type Armazem = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function lerSons(armazem: Pick<Armazem, "getItem"> | null = guardado()): EscolhaSons {
  try {
    const v: unknown = JSON.parse(armazem?.getItem(CHAVE_SONS) ?? "null");
    if (!v || typeof v !== "object") return { ...SONS_PADRAO };
    const o = v as Partial<Record<TipoSom, unknown>>;
    return { mensagem: o.mensagem === true, aprovacao: o.aprovacao === true };
  } catch {
    return { ...SONS_PADRAO };
  }
}

export function gravarSons(e: EscolhaSons, armazem: Pick<Armazem, "setItem"> | null = guardado()): EscolhaSons {
  try { armazem?.setItem(CHAVE_SONS, JSON.stringify(e)); } catch { /* sem storage: vale até fechar */ }
  return e;
}

/** O pedaço do Web Audio que o som usa (os testes passam um falso). */
export type ContextoDeAudio = {
  currentTime: number;
  destination: unknown;
  createOscillator(): { type: string; frequency: { value: number }; connect(d: unknown): unknown; start(t: number): void; stop(t: number): void };
  createGain(): { gain: { setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(d: unknown): unknown };
};

/** Toca as notas: seno com ataque de 8 ms e queda exponencial. */
export function tocarNotas(ctx: ContextoDeAudio, notas: readonly Nota[]): void {
  const t0 = ctx.currentTime;
  for (const n of notas) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    const ini = t0 + n.inicio;
    g.gain.setValueAtTime(0.0001, ini);
    g.gain.linearRampToValueAtTime(n.ganho, ini + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ini + n.dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ini);
    osc.stop(ini + n.dur + 0.02);
  }
}

/**
 * O vigia dos sons: depois de cada leitura de "Sua vez" e de "Não lidos" ele vê o que é NOVO (as mesmas regras do aviso no
 * Mac, web/lib/avisos.ts) e toca, se a pessoa ligou aquele som. A primeira leitura só fixa a base: o que já esperava ao
 * abrir o nod não toca.
 */
export function criarVigiaDeSons(deps: { escolha: () => EscolhaSons; tocar: (tipo: TipoSom) => void; agora: () => number }): { suaVez(s: SuaVezDto): void; naoLidos(n: NaoLidosDto): void; reiniciar(): void } {
  let pedidos: Set<string> | null = null;
  let msgs: Set<string> | null = null;
  const ultimo: Record<TipoSom, number> = { mensagem: Number.NEGATIVE_INFINITY, aprovacao: Number.NEGATIVE_INFINITY };
  const talvez = (tipo: TipoSom, novas: number): void => {
    if (novas === 0 || !deps.escolha()[tipo]) return;
    const agora = deps.agora();
    if (!podeTocar(ultimo[tipo], agora)) return;
    ultimo[tipo] = agora;
    deps.tocar(tipo);
  };
  return {
    suaVez(s) {
      const r = novasAbertas(pedidos, s);
      pedidos = r.conhecidas;
      talvez("aprovacao", r.novas.length);
    },
    naoLidos(n) {
      const r = novasMensagens(msgs, n);
      msgs = r.conhecidas;
      talvez("mensagem", r.novas.length);
    },
    reiniciar() {
      pedidos = null;
      msgs = null;
    },
  };
}

function guardado(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

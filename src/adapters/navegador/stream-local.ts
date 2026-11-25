import type { AbaMotor } from "./motor-agent-browser.ts";

/**
 * O stream local do agent-browser (ADR-190, decisão 4), do jeito que o servidor (lugar "nod") e a máquina da pessoa (Mac
 * pelo app, Linux pelo motor) o usam: o WebSocket de quadros em `ws://127.0.0.1:<porta>` e o relay `POST /api/command` do
 * daemon. Sem `ws` nem nada do servidor: a máquina usa o `WebSocket` global do Node e do Electron.
 *
 * medido em 2026-11-20 (agent-browser 0.43.0): o stream manda `frame` ({data: JPEG base64, metadata.{deviceWidth,
 * deviceHeight}}), `tabs`, `status` (viewport), `url`, e também `command`, `result` e `console` — esses três levam o JS e o
 * resultado dos comandos do bot e nunca saem daqui. Recebe `input_mouse` e `input_keyboard`. O relay só aceita `Origin`
 * da mesma porta e responde `{success}`.
 */

/** O stream local, como o canal o usa (o teste troca por um servidor falso). */
export type StreamDoNavegador = {
  enviar(msg: Readonly<Record<string, unknown>>): void;
  fechar(): void;
  aoMensagem(fn: (texto: string) => void): void;
  aoFechar(fn: () => void): void;
};

/** O maior quadro aceito do stream (um JPEG de 8192×8192 é bem menor que isto em base64). */
export const QUADRO_MAX = 8 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const TAB_ID = /^t[1-9]\d{0,8}$/;
/** O que o stream manda e pode sair da máquina (o resto leva o JS e os resultados do bot). */
export const TIPOS_DO_STREAM_QUE_SAEM: ReadonlySet<string> = new Set(["frame", "tabs", "status"]);
/** O que a entrada da pessoa pode mandar ao stream (a web nunca escolhe outro tipo). */
export const TIPOS_DE_ENTRADA_DO_STREAM: ReadonlySet<string> = new Set(["input_mouse", "input_keyboard"]);

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const inteiro = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function lerJson(texto: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(texto);
    return ehObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** A URL que a vista mostra: só http(s) e about:, sem usuário e senha na URL. */
export function urlDeVista(v: unknown): string {
  if (typeof v !== "string" || v.length > 8192) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "about:") return "";
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return "";
  }
}

/** O quadro do stream, conferido: JPEG em base64 e um tamanho de tela plausível. */
export function lerQuadroDoStream(m: Record<string, unknown>): { jpeg: string; w: number; h: number } | null {
  const data = m.data;
  const meta = m.metadata;
  if (typeof data !== "string" || data.length > QUADRO_MAX || !data.startsWith("/9j/") || !BASE64.test(data) || !ehObj(meta)) return null;
  if (!inteiro(meta.deviceWidth, 1, 8192) || !inteiro(meta.deviceHeight, 1, 8192)) return null;
  return { jpeg: data, w: meta.deviceWidth, h: meta.deviceHeight };
}

/** As abas do stream (`tabs`), como o motor as dá. */
export function lerAbasDoStream(m: Record<string, unknown>): AbaMotor[] | null {
  if (!Array.isArray(m.tabs) || m.tabs.length > 100) return null;
  return m.tabs.flatMap((t) => (ehObj(t) && typeof t.tabId === "string" && TAB_ID.test(t.tabId)
    ? [{ id: t.tabId, titulo: typeof t.title === "string" ? t.title.slice(0, 512) : "", url: urlDeVista(t.url), ativa: t.active === true }]
    : []));
}

/** O tipo de uma mensagem do stream sem decodificar o quadro inteiro (o `type` vem primeiro no JSON do agent-browser). */
export function tipoDaMensagem(texto: string): string | null {
  const m = /^\{\s*"type"\s*:\s*"([a-z_]{1,32})"/.exec(texto.slice(0, 64));
  if (m) return m[1]!;
  const t = lerJson(texto)?.type;
  return typeof t === "string" ? t : null;
}

/** O relay só leva estes comandos (o que `comandosDaEntrada` produz): uma tecla ou texto, nunca outro comando do daemon. */
export function relayPermitido(c: unknown): c is Readonly<Record<string, unknown>> {
  if (!ehObj(c)) return false;
  if (c.action === "press") return typeof c.key === "string" && c.key.length >= 1 && c.key.length <= 64 && Object.keys(c).length === 2;
  if (c.action === "keyboard") return c.subaction === "insertText" && typeof c.text === "string" && c.text.length <= 4096 && Object.keys(c).length === 3;
  return false;
}

/** medido em 2026-11-20 (agent-browser 0.43.0): o relay só aceita `Origin` da mesma porta e responde `{success}`. */
export const relayPadrao = async (porta: number, comando: Readonly<Record<string, unknown>>): Promise<boolean> => {
  const origem = `http://127.0.0.1:${porta}`;
  const r = await fetch(`${origem}/api/command`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json", Origin: origem }, body: JSON.stringify(comando) });
  const corpo = lerJson(await r.text());
  return r.ok && corpo?.success === true;
};

/** O construtor de WebSocket que a máquina usa (o global do Node 22+ e do Electron; o teste injeta o do `ws`). */
export type ConstrutorWebSocket = new (url: string) => WebSocket;

/**
 * O stream local pelo `WebSocket` global (a máquina da pessoa; o servidor usa o `ws`, em vivo.ts). Teto de 10 quadros por
 * segundo pedido ao próprio agent-browser (`maxFps`).
 */
export function conectarStreamGlobal(porta: number, WS: ConstrutorWebSocket | undefined = (globalThis as { WebSocket?: ConstrutorWebSocket }).WebSocket): Promise<StreamDoNavegador> {
  return new Promise((resolve, reject) => {
    if (!WS) { reject(new Error("sem_websocket")); return; }
    const ws = new WS(`ws://127.0.0.1:${porta}/?maxFps=10`);
    const prazo = setTimeout(() => { ws.close(); reject(new Error("stream_sem_resposta")); }, 10_000);
    const aoMensagem: ((t: string) => void)[] = [];
    const aoFechar: (() => void)[] = [];
    let aberto = false;
    ws.onerror = () => { if (!aberto) { clearTimeout(prazo); reject(new Error("stream_falhou")); } };
    ws.onclose = () => { clearTimeout(prazo); if (!aberto) { reject(new Error("stream_fechou")); return; } for (const f of aoFechar) f(); };
    ws.onmessage = (e: MessageEvent) => { if (typeof e.data === "string" && e.data.length <= QUADRO_MAX * 2) for (const f of aoMensagem) f(e.data); };
    ws.onopen = () => {
      aberto = true;
      clearTimeout(prazo);
      resolve({
        enviar: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
        fechar: () => { if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(1000); },
        aoMensagem: (fn) => { aoMensagem.push(fn); },
        aoFechar: (fn) => { aoFechar.push(fn); },
      });
    };
  });
}

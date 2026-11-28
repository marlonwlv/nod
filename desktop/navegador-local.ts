import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { CANAIS_NAVEGADOR_LOCAL, FECHAMENTOS_VISTA_LOCAL, type EnderecoVistaLocal } from "../src/contracts/navegador-local.ts";
import type { EntradaNavegador } from "../src/contracts/navegador-do-bot.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a ponte do app entre a janela web e a vista local da máquina
 * (`src/adapters/navegador/vista-local.ts`). O WebSocket fica AQUI, no processo principal: a página do servidor não fala
 * com 127.0.0.1 (as travas de rede local do Chromium) nem vê o token. O Mac e o PC usam o mesmo código; muda só de onde
 * vem o endereço (no Mac, o próprio processo; no PC, o arquivo que o motor publica).
 *
 * Os quadros descem como vieram (`webContents.send`); cada entrada sobe com um número e o `enviar` resolve quando a
 * máquina diz que o Chrome confirmou.
 */

/** definido em 2026-11-28: a vista local responde em ~150 ms no Mac (o stream e o CDP); 3 s é a máquina parada. */
const PRAZO_ABRIR_MS = 3_000;
/** definido em 2026-11-28: uma entrada sem confirmação em 4 s conta como não confirmada (o CDP desiste em 2 s). */
const PRAZO_ENTRADA_MS = 4_000;
const AGENTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ConstrutorWs = new (url: string) => WebSocket;
type Sessao = { ws: WebSocket; dono: WebContents; proximo: number; pendentes: Map<number, { resolver: (ok: boolean) => void; relogio: ReturnType<typeof setTimeout> }> };

export type OpcoesNavegadorLocal = {
  ipcMain: Pick<IpcMain, "handle">;
  /** Onde a vista local desta máquina ouve agora (null = não há: o motor não subiu, ou não tem o navegador). */
  endereco: () => Promise<EnderecoVistaLocal | null>;
  /** Lança se o pedido não veio da janela web do servidor conectado (cada app tem a sua regra). */
  validar: (e: IpcMainInvokeEvent) => void;
  WS?: ConstrutorWs;
};

export function ligarNavegadorLocal(o: OpcoesNavegadorLocal): { sessoes(): number } {
  const WS = o.WS ?? (globalThis as { WebSocket?: ConstrutorWs }).WebSocket;
  const sessoes = new Map<string, Sessao>();

  function fechar(id: string): void {
    const s = sessoes.get(id);
    if (!s) return;
    sessoes.delete(id);
    for (const p of s.pendentes.values()) { clearTimeout(p.relogio); p.resolver(false); }
    s.pendentes.clear();
    try { s.ws.close(1000); } catch { /* já fechado */ }
  }

  o.ipcMain.handle(CANAIS_NAVEGADOR_LOCAL.abrir, async (e, agenteId: unknown): Promise<string | null> => {
    o.validar(e);
    if (typeof agenteId !== "string" || !AGENTE.test(agenteId) || !WS) return null;
    const end = await o.endereco().catch(() => null);
    if (!end) return null;
    const ws = new WS(`ws://127.0.0.1:${end.porta}/navegador/${agenteId.toLowerCase()}?t=${encodeURIComponent(end.token)}`);
    const id = randomUUID();
    const dono = e.sender;
    const aberto = await new Promise<boolean>((resolver) => {
      const prazo = setTimeout(() => { try { ws.close(); } catch { /* nada */ } resolver(false); }, PRAZO_ABRIR_MS);
      ws.onopen = () => { clearTimeout(prazo); resolver(true); };
      ws.onerror = () => { clearTimeout(prazo); resolver(false); };
      ws.onclose = () => { clearTimeout(prazo); resolver(false); };
    });
    if (!aberto) return null;
    const s: Sessao = { ws, dono, proximo: 1, pendentes: new Map() };
    sessoes.set(id, s);
    ws.onmessage = (m: MessageEvent) => {
      if (typeof m.data !== "string") return;
      if (m.data.startsWith('{"t":"ok"')) {
        try {
          const r = JSON.parse(m.data) as { n?: unknown; ok?: unknown };
          const p = typeof r.n === "number" ? s.pendentes.get(r.n) : undefined;
          if (p) { s.pendentes.delete(r.n as number); clearTimeout(p.relogio); p.resolver(r.ok === true); }
        } catch { /* ignora */ }
        return;
      }
      if (!dono.isDestroyed()) dono.send(CANAIS_NAVEGADOR_LOCAL.mensagem, id, m.data);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (!sessoes.has(id)) return;
      fechar(id);
      // A web sabe que acabou (e volta ao canal do servidor): o fim que a máquina mandou, ou um nosso.
      if (!dono.isDestroyed()) dono.send(CANAIS_NAVEGADOR_LOCAL.mensagem, id, JSON.stringify({ t: "fim", motivo: ev.code === FECHAMENTOS_VISTA_LOCAL.semChrome ? "sem_chrome" : "fechou" }));
    };
    dono.once("destroyed", () => fechar(id));
    return id;
  });

  o.ipcMain.handle(CANAIS_NAVEGADOR_LOCAL.enviar, (e, id: unknown, entrada: unknown): Promise<boolean> => {
    o.validar(e);
    const s = typeof id === "string" ? sessoes.get(id) : undefined;
    if (!s || s.dono !== e.sender || s.ws.readyState !== s.ws.OPEN || typeof entrada !== "object" || entrada === null) return Promise.resolve(false);
    const n = s.proximo++;
    return new Promise<boolean>((resolver) => {
      const relogio = setTimeout(() => { s.pendentes.delete(n); resolver(false); }, PRAZO_ENTRADA_MS);
      s.pendentes.set(n, { resolver, relogio });
      // A máquina confere a entrada de novo (lerEntradaNavegador); aqui só vai como veio.
      try { s.ws.send(JSON.stringify({ t: "entrada", n, e: entrada as EntradaNavegador })); } catch { clearTimeout(relogio); s.pendentes.delete(n); resolver(false); }
    });
  });

  o.ipcMain.handle(CANAIS_NAVEGADOR_LOCAL.fechar, (e, id: unknown) => {
    o.validar(e);
    const s = typeof id === "string" ? sessoes.get(id) : undefined;
    if (s && s.dono === e.sender) fechar(id as string);
  });

  return { sessoes: () => sessoes.size };
}

import WebSocket, { type RawData } from "ws";
import { FECHAMENTOS_NAVEGADOR_VIVO, type EntradaNavegador, type MotivoFimNavegador, type QuadroAoVivoNavegador, type VistaNavegador } from "../../contracts/navegador-do-bot.ts";
import { comandosDaEntrada, lerEntradaNavegador } from "../../domain/navegador-entrada.ts";
import { temChromeVivo } from "../../domain/navegador-vista.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { AbaMotor } from "./motor-agent-browser.ts";

/**
 * O canal ao vivo do navegador do bot (ADR-190, decisão 4): `/api/t/:tenant/agentes/:id/navegador/vivo`, só para a dona.
 *
 * Uma conexão por bot ao stream local do agent-browser (`ws://127.0.0.1:<porta>/?maxFps=10`), compartilhada entre os
 * espectadores dele (até POR_BOT) e fechada quando ninguém assiste. Do stream só passam os quadros (como `quadro`, com
 * teto de taxa por espectador e descarte quando o socket dele está atrasado); abas e tamanho de tela vão ao portão
 * (`doStream`), que muda a vista e a vista vai a todos. `command`, `result` e `console` do stream nunca passam: levam o
 * JS e o resultado dos comandos do bot (medido em 2026-11-20: cada `eval` do bot aparece no stream como `command` com o
 * script e `result` com o valor).
 *
 * A entrada da pessoa (`EntradaNavegador`) só passa conferida (`lerEntradaNavegador`) e com ela no controle; fora disso a
 * resposta é a vista (a web mostra "Assumir para mexer"). Enquanto a página tem um segredo que o nod pôs (L3), nenhum
 * quadro sai.
 */

/** O lado da web: JSON por WebSocket (o `canalDeSocket` da voz serve). */
export type CanalVivoNavegador = {
  enviarJson(msg: object): void;
  fechar(codigo: number, motivo?: string): void;
  aoMensagem(fn: (m: { texto: string } | { binario: Uint8Array }) => void): void;
  aoFechar(fn: (codigo: number) => void): void;
  /** Bytes na fila de saída do socket (o quadro espera quando passa de FILA_MAX_BYTES). */
  pendente(): number;
};

/** O stream local do agent-browser, como o canal o usa (o teste troca por um servidor falso). */
export type StreamDoNavegador = {
  enviar(msg: Readonly<Record<string, unknown>>): void;
  fechar(): void;
  aoMensagem(fn: (texto: string) => void): void;
  aoFechar(fn: () => void): void;
};

/** A parte do portão (`criarNavegadores`) de que o canal precisa. */
export type PortaoDoVivo = {
  conferirDona(escopo: Escopo, agenteId: string): Promise<void>;
  vistaDe(escopo: Escopo, agenteId: string): VistaNavegador;
  portaDoStream(escopo: Escopo, agenteId: string): Promise<number | null>;
  doStream(escopo: Escopo, agenteId: string, m: { abas?: readonly AbaMotor[]; viewport?: { w: number; h: number } }): void;
  antesDaEntrada(escopo: Escopo, agenteId: string, e: EntradaNavegador): Promise<void>;
};

export type OpcoesVivoNavegador = {
  portao: PortaoDoVivo;
  /** Abre o stream local na porta (padrão: `ws` em 127.0.0.1, com teto de 10 quadros por segundo). */
  conectar?: (porta: number) => Promise<StreamDoNavegador>;
  /** O `POST /api/command` do daemon (padrão: fetch em 127.0.0.1 com Origin da mesma porta, que o relay exige). */
  relay?: (porta: number, comando: Readonly<Record<string, unknown>>) => Promise<boolean>;
  agora?: () => number;
  /** Testes: encurtam o intervalo entre quadros e a espera para reabrir o stream. */
  intervaloQuadroMs?: number;
  reabrirMs?: number;
};

/** definido em 2026-11-20 (ADR-190): até 10 quadros por segundo por espectador. */
export const INTERVALO_QUADRO_MS = 100;
/** definido em 2026-11-20: espectadores por bot e pessoa (abas, reconexões); o mais antigo sai, como na tela do computador. */
export const POR_BOT = 2;
/** definido em 2026-11-20: o socket da web com mais que isto na fila não recebe o próximo quadro (pula; vem o mais novo). */
export const FILA_MAX_BYTES = 1024 * 1024;
/** definido em 2026-11-20: a vista de resposta a uma entrada recusada sai no máximo uma vez por segundo por espectador. */
const RECUSA_A_CADA_MS = 1_000;
/** definido em 2026-11-20: entradas na fila de um espectador; passando disto, o movimento do mouse cai. */
const FILA_ENTRADAS_MAX = 64;
/** O maior quadro aceito do stream (um JPEG de 8192×8192 é bem menor que isto em base64). */
const QUADRO_MAX = 8 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const TAB_ID = /^t[1-9]\d{0,8}$/;

type Espectador = { canal: CanalVivoNavegador; ultimoQuadroEm: number; ultimaRecusaEm: number; fila: Promise<void>; naFila: number; aberto: boolean };
type Bot = {
  escopo: Escopo;
  agenteId: string;
  espectadores: Espectador[];
  stream: StreamDoNavegador | null;
  porta: number | null;
  conectando: boolean;
  reabrir: ReturnType<typeof setTimeout> | null;
  seq: number;
};

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const inteiro = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function lerJson(texto: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(texto);
    return ehObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** A URL que a vista mostra: só http(s) e about:, sem usuário e senha na URL. */
function urlDeVista(v: unknown): string {
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

export const conectarPadrao = (porta: number): Promise<StreamDoNavegador> => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/?maxFps=10`, { maxPayload: QUADRO_MAX * 2, perMessageDeflate: false });
  const prazo = setTimeout(() => { ws.terminate(); reject(new Error("stream_sem_resposta")); }, 10_000);
  ws.once("error", (e) => { clearTimeout(prazo); reject(e); });
  ws.once("open", () => {
    clearTimeout(prazo);
    resolve({
      enviar: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
      fechar: () => { if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(1000); },
      aoMensagem: (fn) => ws.on("message", (d: RawData, binario: boolean) => { if (!binario) fn((Array.isArray(d) ? Buffer.concat(d) : Buffer.from(d as ArrayBuffer)).toString("utf8")); }),
      aoFechar: (fn) => ws.on("close", () => fn()),
    });
  });
});

/** medido em 2026-11-20 (agent-browser 0.43.0): o relay só aceita `Origin` da mesma porta e responde `{success}`. */
export const relayPadrao = async (porta: number, comando: Readonly<Record<string, unknown>>): Promise<boolean> => {
  const origem = `http://127.0.0.1:${porta}`;
  const r = await fetch(`${origem}/api/command`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json", Origin: origem }, body: JSON.stringify(comando) });
  const corpo = lerJson(await r.text());
  return r.ok && corpo?.success === true;
};

export function criarVivoNavegador(o: OpcoesVivoNavegador) {
  const agora = o.agora ?? (() => Date.now());
  const conectar = o.conectar ?? conectarPadrao;
  const relay = o.relay ?? relayPadrao;
  const intervalo = o.intervaloQuadroMs ?? INTERVALO_QUADRO_MS;
  const bots = new Map<string, Bot>();
  const chave = (escopo: Escopo, agenteId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${agenteId}`;

  const enviar = (e: Espectador, msg: QuadroAoVivoNavegador) => { if (e.aberto) e.canal.enviarJson(msg); };

  function encerrar(e: Espectador, codigo: number, motivo: MotivoFimNavegador): void {
    if (!e.aberto) return;
    enviar(e, { t: "fim", motivo });
    e.aberto = false;
    e.canal.fechar(codigo, motivo);
  }

  function fecharStream(bot: Bot): void {
    if (bot.reabrir) { clearTimeout(bot.reabrir); bot.reabrir = null; }
    const s = bot.stream;
    bot.stream = null;
    bot.porta = null;
    s?.fechar();
  }

  function sair(bot: Bot, e: Espectador): void {
    e.aberto = false;
    bot.espectadores = bot.espectadores.filter((x) => x !== e);
    if (bot.espectadores.length) return;
    fecharStream(bot);
    bots.delete(chave(bot.escopo, bot.agenteId));
  }

  function agendarReabrir(bot: Bot): void {
    if (bot.reabrir || !bot.espectadores.length) return;
    bot.reabrir = setTimeout(() => { bot.reabrir = null; void garantirStream(bot); }, o.reabrirMs ?? 2_000);
    bot.reabrir.unref?.();
  }

  function quadro(bot: Bot, q: { jpeg: string; w: number; h: number }): void {
    const vista = o.portao.vistaDe(bot.escopo, bot.agenteId);
    if (vista.segredoNaPagina) return;
    bot.seq++;
    const t = agora();
    for (const e of bot.espectadores) {
      if (t - e.ultimoQuadroEm < intervalo || e.canal.pendente() > FILA_MAX_BYTES) continue;
      e.ultimoQuadroEm = t;
      enviar(e, { t: "quadro", seq: bot.seq, jpeg: q.jpeg, w: q.w, h: q.h });
    }
  }

  function doStream(bot: Bot, texto: string): void {
    if (texto.length > QUADRO_MAX * 2) return;
    const m = lerJson(texto);
    if (!m) return;
    if (m.type === "frame") {
      const q = lerQuadroDoStream(m);
      if (q) quadro(bot, q);
    } else if (m.type === "tabs") {
      const abas = lerAbasDoStream(m);
      if (abas) o.portao.doStream(bot.escopo, bot.agenteId, { abas });
    } else if (m.type === "status") {
      if (inteiro(m.viewportWidth, 1, 8192) && inteiro(m.viewportHeight, 1, 8192)) o.portao.doStream(bot.escopo, bot.agenteId, { viewport: { w: m.viewportWidth, h: m.viewportHeight } });
    }
    // command, result, console, url: nunca passam (levam o JS e os resultados do bot).
  }

  /** Abre o stream do bot se alguém assiste e há Chrome vivo; um por vez. */
  async function garantirStream(bot: Bot): Promise<void> {
    if (bot.stream || bot.conectando || !bot.espectadores.length) return;
    if (!temChromeVivo(o.portao.vistaDe(bot.escopo, bot.agenteId).estado)) return;
    bot.conectando = true;
    try {
      const porta = await o.portao.portaDoStream(bot.escopo, bot.agenteId);
      if (porta === null) return;
      const s = await conectar(porta);
      if (!bot.espectadores.length || bots.get(chave(bot.escopo, bot.agenteId)) !== bot) { s.fechar(); return; }
      bot.stream = s;
      bot.porta = porta;
      s.aoMensagem((texto) => doStream(bot, texto));
      s.aoFechar(() => {
        if (bot.stream !== s) return;
        bot.stream = null;
        bot.porta = null;
        if (temChromeVivo(o.portao.vistaDe(bot.escopo, bot.agenteId).estado)) agendarReabrir(bot);
      });
    } catch (e) {
      log("aviso", "navegador_vivo_stream_falhou", { agente_id: bot.agenteId, erro: e instanceof Error ? e.name : "desconhecido" });
      agendarReabrir(bot);
    } finally {
      bot.conectando = false;
    }
  }

  /** Uma entrada da pessoa: conferida, só com ela no controle, na ordem em que chegou. */
  function entrada(bot: Bot, e: Espectador, texto: string): void {
    const vista = o.portao.vistaDe(bot.escopo, bot.agenteId);
    const ent = lerEntradaNavegador(lerJson(texto), vista.viewport);
    if (!ent) return;
    if (vista.controle !== "pessoa") {
      if (agora() - e.ultimaRecusaEm >= RECUSA_A_CADA_MS) { e.ultimaRecusaEm = agora(); enviar(e, { t: "vista", vista }); }
      return;
    }
    if (e.naFila >= FILA_ENTRADAS_MAX && ent.t === "mouse" && ent.evento === "mouseMoved") return;
    e.naFila++;
    e.fila = e.fila.then(async () => {
      try {
        if (o.portao.vistaDe(bot.escopo, bot.agenteId).controle !== "pessoa") return;
        await o.portao.antesDaEntrada(bot.escopo, bot.agenteId, ent).catch((erro: unknown) => log("aviso", "navegador_gravacao_falhou", { agente_id: bot.agenteId, erro: erro instanceof Error ? erro.name : "desconhecido" }));
        for (const c of comandosDaEntrada(ent)) {
          if (c.via === "stream") bot.stream?.enviar(c.mensagem);
          else if (bot.porta !== null) {
            const ok = await relay(bot.porta, c.comando).catch(() => false);
            if (!ok) log("aviso", "navegador_tecla_recusada", { agente_id: bot.agenteId });
          }
        }
      } finally {
        e.naFila--;
      }
    });
  }

  return {
    /** A dona abriu o canal (o upgrade já conferiu cookie, tenant e Origin): confere o bot, manda a vista e liga o stream. */
    web(escopo: Escopo, agenteId: string, canal: CanalVivoNavegador): void {
      const e: Espectador = { canal, ultimoQuadroEm: 0, ultimaRecusaEm: 0, fila: Promise.resolve(), naFila: 0, aberto: true };
      const recebidas: string[] = [];
      let bot: Bot | null = null;
      canal.aoFechar(() => { if (bot) sair(bot, e); else e.aberto = false; });
      canal.aoMensagem((m) => {
        if (!("texto" in m)) return;
        if (bot) entrada(bot, e, m.texto);
        else if (recebidas.length < FILA_ENTRADAS_MAX) recebidas.push(m.texto);
      });
      o.portao.conferirDona(escopo, agenteId).then(() => {
        if (!e.aberto) return;
        const k = chave(escopo, agenteId);
        const b = bots.get(k) ?? { escopo, agenteId, espectadores: [], stream: null, porta: null, conectando: false, reabrir: null, seq: 0 };
        bots.set(k, b);
        bot = b;
        for (const velho of b.espectadores.slice(0, Math.max(0, b.espectadores.length - POR_BOT + 1))) {
          encerrar(velho, FECHAMENTOS_NAVEGADOR_VIVO.trocou, "outra_janela");
          b.espectadores = b.espectadores.filter((x) => x !== velho);
        }
        b.espectadores.push(e);
        enviar(e, { t: "vista", vista: o.portao.vistaDe(escopo, agenteId) });
        for (const t of recebidas.splice(0)) entrada(b, e, t);
        void garantirStream(b);
      }, () => encerrar(e, FECHAMENTOS_NAVEGADOR_VIVO.recusado, "nao_permitido"));
    },
    /** A vista de um bot mudou (o `aoMudar` do portão): vai a quem assiste; o stream abre ou fecha com o Chrome. */
    vistaMudou(escopo: Escopo, vista: VistaNavegador): void {
      const bot = bots.get(chave(escopo, vista.agenteId));
      if (!bot) return;
      for (const e of bot.espectadores) enviar(e, { t: "vista", vista });
      if (temChromeVivo(vista.estado)) void garantirStream(bot);
      else fecharStream(bot);
    },
    /** O servidor vai desligar: cada espectador recebe o `fim` e o stream fecha. */
    fechar(): void {
      for (const bot of [...bots.values()]) {
        fecharStream(bot);
        for (const e of bot.espectadores) encerrar(e, 1001, "servidor_desligando");
        bot.espectadores = [];
      }
      bots.clear();
    },
    /** Só testes. */
    abertos: () => [...bots.values()].map((b) => ({ agenteId: b.agenteId, espectadores: b.espectadores.length, stream: b.stream !== null })),
  };
}
export type VivoNavegador = ReturnType<typeof criarVivoNavegador>;

import WebSocket, { type RawData } from "ws";
import { FECHAMENTOS_NAVEGADOR_VIVO, type EntradaNavegador, type MotivoFimNavegador, type QuadroAoVivoNavegador, type VistaNavegador } from "../../contracts/navegador-do-bot.ts";
import { comandosDaEntrada, lerEntradaNavegador } from "../../domain/navegador-entrada.ts";
import { temChromeVivo } from "../../domain/navegador-vista.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { AbaMotor } from "./motor-agent-browser.ts";
import { lerAbasDoStream, lerJson, lerQuadroDoStream, QUADRO_MAX, relayPadrao, type StreamDoNavegador } from "./stream-local.ts";

export { lerAbasDoStream, lerQuadroDoStream, relayPadrao, type StreamDoNavegador };

/**
 * O canal ao vivo do navegador do bot (ADR-190, decisão 4): `/api/t/:tenant/agentes/:id/navegador/vivo`, só para a dona.
 *
 * Uma fonte de quadros por bot, compartilhada entre os espectadores dele (até POR_BOT) e fechada quando ninguém assiste:
 * no lugar "nod", o stream local do agent-browser (`ws://127.0.0.1:<porta>/?maxFps=10`); no Mac ou numa máquina da pessoa,
 * o WebSocket que a máquina abre para o servidor e que repassa o stream local de lá (`vivo-maquina.ts`). A web não vê a
 * diferença. Do stream só passam os quadros (como `quadro`, com
 * teto de taxa por espectador e descarte quando o socket dele está atrasado); abas e tamanho de tela vão ao portão
 * (`doStream`), que muda a vista e a vista vai a todos. `command`, `result` e `console` do stream nunca passam: levam o
 * JS e o resultado dos comandos do bot (medido em 2026-11-20: cada `eval` do bot aparece no stream como `command` com o
 * script e `result` com o valor).
 *
 * A entrada da pessoa (`EntradaNavegador`) só passa conferida (`lerEntradaNavegador`) e com ela no controle; fora disso a
 * resposta é a vista (a web mostra "Assumir para mexer"). O `tamanho` (a área da vista de quem assiste) vale sempre e vai
 * ao portão, que muda o tamanho do Chrome (emenda de 2026-11-20 da ADR-190, item 4). Enquanto a página tem um segredo que o nod pôs (L3), nenhum
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

/** A parte do portão (`criarNavegadores`) de que o canal precisa. */
export type PortaoDoVivo = {
  conferirDona(escopo: Escopo, agenteId: string): Promise<void>;
  vistaDe(escopo: Escopo, agenteId: string): VistaNavegador;
  portaDoStream(escopo: Escopo, agenteId: string): Promise<number | null>;
  doStream(escopo: Escopo, agenteId: string, m: { abas?: readonly AbaMotor[]; viewport?: { w: number; h: number } }): void;
  antesDaEntrada(escopo: Escopo, agenteId: string, e: EntradaNavegador): Promise<void>;
  /** A área da vista de quem assiste mudou (`{t:"tamanho"}`): o Chrome acompanha (emenda de 2026-11-20 da ADR-190). */
  tamanho?(escopo: Escopo, agenteId: string, area: { w: number; h: number }): void;
};

export type OpcoesVivoNavegador = {
  portao: PortaoDoVivo;
  /** Abre o stream local na porta (padrão: `ws` em 127.0.0.1, com teto de 10 quadros por segundo). */
  conectar?: (porta: number) => Promise<StreamDoNavegador>;
  /** O `POST /api/command` do daemon (padrão: fetch em 127.0.0.1 com Origin da mesma porta, que o relay exige). */
  relay?: (porta: number, comando: Readonly<Record<string, unknown>>) => Promise<boolean>;
  /**
   * A vista vinda da máquina da pessoa (lugar "mac" ou "maquina"): pede à máquina que abra o WebSocket dela e devolve a
   * fonte quando ela chega (`vivo-maquina.ts`). Ausente = só o lugar "nod" tem vista.
   */
  maquina?: { abrir(escopo: Escopo, agenteId: string): Promise<FonteDoVivo | null> };
  agora?: () => number;
  /** Testes: encurtam o intervalo entre quadros e a espera para reabrir o stream. */
  intervaloQuadroMs?: number;
  reabrirMs?: number;
};

/**
 * De onde vêm os quadros de um bot e para onde vai a entrada da pessoa: o stream local do agent-browser (lugar "nod") ou o
 * WebSocket que a máquina da pessoa abriu (lugar "mac" ou "maquina"). Os dois falam a mesma língua: mensagens do stream
 * para cá, `input_*` pelo stream e texto/atalhos pelo relay.
 */
export type FonteDoVivo = { stream: StreamDoNavegador; relay(comando: Readonly<Record<string, unknown>>): Promise<boolean> };

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
type Espectador = { canal: CanalVivoNavegador; ultimoQuadroEm: number; ultimaRecusaEm: number; fila: Promise<void>; naFila: number; aberto: boolean };
type Bot = {
  escopo: Escopo;
  agenteId: string;
  espectadores: Espectador[];
  fonte: FonteDoVivo | null;
  /** O lugar da fonte aberta (o lugar mudou: a fonte velha fecha e a nova abre). */
  lugarDaFonte: string;
  conectando: boolean;
  reabrir: ReturnType<typeof setTimeout> | null;
  seq: number;
  /** A última vista tinha segredo na página (os quadros de então foram descartados). */
  segredo: boolean;
};

const inteiro = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

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
    const f = bot.fonte;
    bot.fonte = null;
    f?.stream.fechar();
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

  /** A fonte do lugar do bot: o stream local (nod) ou a máquina da pessoa. null = não abriu agora. */
  async function abrirFonte(bot: Bot): Promise<FonteDoVivo | null> {
    if (o.portao.vistaDe(bot.escopo, bot.agenteId).lugar.tipo !== "nod") return (await o.maquina?.abrir(bot.escopo, bot.agenteId)) ?? null;
    const porta = await o.portao.portaDoStream(bot.escopo, bot.agenteId);
    if (porta === null) return null;
    return { stream: await conectar(porta), relay: (c) => relay(porta, c) };
  }

  /** Abre o stream do bot se alguém assiste e há Chrome vivo; um por vez. */
  async function garantirStream(bot: Bot): Promise<void> {
    if (bot.fonte || bot.conectando || !bot.espectadores.length) return;
    if (!temChromeVivo(o.portao.vistaDe(bot.escopo, bot.agenteId).estado)) return;
    bot.conectando = true;
    try {
      const f = await abrirFonte(bot);
      if (!f) { if (o.portao.vistaDe(bot.escopo, bot.agenteId).lugar.tipo !== "nod") agendarReabrir(bot); return; }
      if (!bot.espectadores.length || bots.get(chave(bot.escopo, bot.agenteId)) !== bot) { f.stream.fechar(); return; }
      bot.fonte = f;
      bot.lugarDaFonte = JSON.stringify(o.portao.vistaDe(bot.escopo, bot.agenteId).lugar);
      f.stream.aoMensagem((texto) => doStream(bot, texto));
      f.stream.aoFechar(() => {
        if (bot.fonte !== f) return;
        bot.fonte = null;
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
    // O tamanho vale assistindo ou no controle: não mexe na página, só no tamanho do Chrome.
    if (ent.t === "tamanho") { o.portao.tamanho?.(bot.escopo, bot.agenteId, { w: ent.w, h: ent.h }); return; }
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
          const f = bot.fonte;
          if (!f) break;
          if (c.via === "stream") f.stream.enviar(c.mensagem);
          else {
            const ok = await f.relay(c.comando).catch(() => false);
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
        const b = bots.get(k) ?? { escopo, agenteId, espectadores: [], fonte: null, lugarDaFonte: "", conectando: false, reabrir: null, seq: 0, segredo: o.portao.vistaDe(escopo, agenteId).segredoNaPagina };
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
      // Prova real (2026-11-20): os quadros da página nova chegam antes de o portão saber que a URL mudou e caem com o
      // segredo; numa página parada (a área logada) não vem outro, e a vista ficava no quadro em branco da navegação.
      // Saindo do segredo, o stream abre de novo: o agent-browser manda o quadro da página atual ao conectar.
      const saiuDoSegredo = bot.segredo && !vista.segredoNaPagina;
      bot.segredo = vista.segredoNaPagina;
      if (bot.fonte && (saiuDoSegredo || bot.lugarDaFonte !== JSON.stringify(vista.lugar))) fecharStream(bot);
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
    abertos: () => [...bots.values()].map((b) => ({ agenteId: b.agenteId, espectadores: b.espectadores.length, stream: b.fonte !== null })),
  };
}
export type VivoNavegador = ReturnType<typeof criarVivoNavegador>;

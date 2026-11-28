import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { EnderecoVistaLocal, MotivoFimLocal } from "../../contracts/navegador-local.ts";
import type { EntradaNavegador } from "../../contracts/navegador-do-bot.ts";
import { chamadasCdpDaEntrada, entradaDescartavel } from "../../domain/navegador-entrada-cdp.ts";
import { comandosDaEntrada, lerEntradaNavegador } from "../../domain/navegador-entrada.ts";
import { log } from "../../obs/log.ts";
import { criarEntradaCdp, type ConexaoCdp, type EntradaCdp } from "./entrada-cdp.ts";
import type { MotorNavegador } from "./motor-agent-browser.ts";
import { manterAcordado } from "./manter-acordado.ts";
import { lerJson, relayPermitido, tipoDaMensagem, TIPOS_DO_STREAM_QUE_SAEM, type StreamDoNavegador } from "./stream-local.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a vista local do navegador do bot, do lado da máquina (o app do Mac e o
 * motor do PC). Um servidor HTTP só em 127.0.0.1, porta escolhida pelo sistema, com um token de 32 bytes que nasce aqui e
 * só vai ao app desta pessoa (no Mac, o mesmo processo; no PC, um arquivo na pasta do executor). Por conexão
 * (`/navegador/<agenteId>?t=<token>`):
 *
 * - os quadros, as abas e o tamanho vêm do stream do agent-browser desta máquina, filtrados como na vista pelo servidor
 *   (`command`, `result` e `console` nunca saem do stream);
 * - a entrada vai CONFIRMADA pelo CDP do Chrome do bot (`entrada-cdp.ts`), na ordem em que chegou; cada uma volta com
 *   `{t:"ok", n, ok}`. Sem o CDP (o motor não dá o endereço), o caminho antigo: o `input_*` pelo stream e o texto pelo
 *   relay.
 *
 * Nada aqui passa pela nuvem: é o que tira a volta de cada tecla e de cada quadro (medido em 2026-11-28 no Mac: da tecla ao
 * quadro, 20 ms na mediana; pela nuvem, a ida e a volta do servidor a cada uma).
 */

/** definido em 2026-11-28: com mais que isto na fila do socket, o quadro novo espera (vem o mais novo depois). */
const ATRASO_MAX = 1024 * 1024;
/** definido em 2026-11-28: entradas na fila de uma vista; passando disto, o mouse andando cai. */
const FILA_MAX = 256;
const AGENTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_ID = /^[0-9A-F]{8,64}$/i;

export type OpcoesVistaLocal = {
  motor: () => Promise<MotorNavegador>;
  conectarStream: (porta: number) => Promise<StreamDoNavegador>;
  relay: (porta: number, comando: Readonly<Record<string, unknown>>) => Promise<boolean>;
  /** A conexão com o CDP (padrão: nenhuma, e a entrada vai pelo caminho antigo). */
  conectarCdp?: (url: string) => Promise<ConexaoCdp>;
  /** Testes: o token fixo. */
  token?: string;
};

export type VistaLocal = {
  iniciar(): Promise<EnderecoVistaLocal>;
  parar(): Promise<void>;
  /** Só testes: vistas abertas agora. */
  abertas(): number;
};

const ehLoopback = (req: IncomingMessage) => {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
};

/** A aba ativa das abas do stream (o `targetId` do Chrome, para a entrada CDP). */
export function alvoAtivoDasAbas(m: Record<string, unknown>): string | null {
  if (!Array.isArray(m.tabs)) return null;
  for (const t of m.tabs as unknown[]) {
    const a = t as { active?: unknown; targetId?: unknown };
    if (a && a.active === true && typeof a.targetId === "string" && TARGET_ID.test(a.targetId)) return a.targetId;
  }
  return null;
}

export function criarVistaLocal(o: OpcoesVistaLocal): VistaLocal {
  const token = o.token ?? randomBytes(32).toString("base64url");
  let http: Server | null = null;
  let wss: WebSocketServer | null = null;
  let endereco: EnderecoVistaLocal | null = null;
  const abertas = new Set<WebSocket>();

  function tokenConfere(t: string): boolean {
    const a = Buffer.from(t);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function atender(ws: WebSocket, agenteId: string, motor: MotorNavegador, portaDoBot: number): void {
    abertas.add(ws);
    let aberto = true;
    let stream: StreamDoNavegador | null = null;
    let cdp: EntradaCdp | null = null;
    const porta = portaDoBot;
    let viewport = { w: 8192, h: 8192 };
    const fila: { n: number; e: EntradaNavegador }[] = [];
    let andando = false;
    let pronto = false;
    const s = { agenteId };

    const mandar = (msg: object | string) => { if (aberto && ws.readyState === ws.OPEN) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)); };
    const encerrar = (motivo: MotivoFimLocal, codigo = 1000) => {
      if (!aberto) return;
      mandar({ t: "fim", motivo });
      aberto = false;
      abertas.delete(ws);
      stream?.fechar();
      cdp?.fechar();
      try { ws.close(codigo, motivo); } catch { /* já fechado */ }
    };

    async function executar(e: EntradaNavegador): Promise<boolean> {
      if (cdp) return cdp.executar(chamadasCdpDaEntrada(e));
      // Sem o CDP: o caminho antigo. O relay confirma; o stream não (conta como entregue).
      for (const c of comandosDaEntrada(e)) {
        if (c.via === "stream") stream?.enviar(c.mensagem);
        else if (!relayPermitido(c.comando) || !(await o.relay(porta, c.comando).catch(() => false))) return false;
      }
      return true;
    }

    async function andar(): Promise<void> {
      if (andando || !pronto) return;
      andando = true;
      try {
        while (aberto && fila.length) {
          const { n, e } = fila.shift()!;
          const ok = await executar(e).catch(() => false);
          mandar({ t: "ok", n, ok });
          if (!ok) log("aviso", "navegador_local_entrada_nao_confirmada", { agente_id: agenteId, tipo: e.t });
        }
      } finally {
        andando = false;
      }
    }

    ws.on("message", (d: RawData, binario: boolean) => {
      if (binario || !aberto) return;
      const m = lerJson((Array.isArray(d) ? Buffer.concat(d) : Buffer.from(d as ArrayBuffer)).toString("utf8"));
      if (!m || m.t !== "entrada" || typeof m.n !== "number" || !Number.isSafeInteger(m.n)) return;
      const n = m.n;
      const e = lerEntradaNavegador(m.e, viewport);
      if (!e || e.t === "tamanho") { mandar({ t: "ok", n, ok: false }); return; }
      // O mouse andando não espera: se o anterior ainda está na fila, o novo toma o lugar dele.
      const ultimo = fila.at(-1);
      if (entradaDescartavel(e) && ultimo && entradaDescartavel(ultimo.e)) { mandar({ t: "ok", n: ultimo.n, ok: true }); fila[fila.length - 1] = { n, e }; }
      else if (fila.length >= FILA_MAX && entradaDescartavel(e)) { mandar({ t: "ok", n, ok: true }); return; }
      else fila.push({ n, e });
      void andar();
    });
    ws.on("close", () => { if (aberto) { aberto = false; abertas.delete(ws); stream?.fechar(); cdp?.fechar(); } });
    ws.on("error", () => undefined);

    void (async () => {
      try {
        const url = o.conectarCdp && motor.enderecoCdp ? await motor.enderecoCdp(s).catch(() => null) : null;
        if (url && o.conectarCdp) { const conectar = o.conectarCdp; cdp = criarEntradaCdp({ conectar: () => conectar(url) }); }
        const st = await o.conectarStream(porta);
        if (!aberto) { st.fechar(); return; }
        stream = st;
        st.aoMensagem((texto) => {
          const tipo = tipoDaMensagem(texto);
          if (!tipo || !TIPOS_DO_STREAM_QUE_SAEM.has(tipo)) return;
          if (tipo === "frame") { if (ws.bufferedAmount <= ATRASO_MAX) mandar(texto); return; }
          const msg = lerJson(texto);
          if (msg && tipo === "tabs") { const alvo = alvoAtivoDasAbas(msg); if (alvo) cdp?.alvo(alvo); }
          if (msg && tipo === "status" && Number.isInteger(msg.viewportWidth) && Number.isInteger(msg.viewportHeight)) viewport = { w: Number(msg.viewportWidth), h: Number(msg.viewportHeight) };
          mandar(texto);
        });
        st.aoFechar(() => encerrar("fechou"));
        manterAcordado(motor, agenteId, () => aberto);
        pronto = true;
        void andar();
      } catch (e) {
        log("aviso", "navegador_local_falhou", { agente_id: agenteId, erro: e instanceof Error ? e.message.slice(0, 80) : "desconhecido" });
        encerrar("falhou");
      }
    })();
  }

  return {
    async iniciar() {
      if (endereco) return endereco;
      const servidor = createServer((_req, res) => { res.writeHead(404).end(); });
      const w = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
      servidor.on("upgrade", (req, socket, head) => {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        const m = /^\/navegador\/([0-9a-f-]{36})$/i.exec(u.pathname);
        if (!ehLoopback(req) || !m || !AGENTE.test(m[1]!) || !tokenConfere(u.searchParams.get("t") ?? "")) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        const agenteId = m[1]!.toLowerCase();
        // Sem o Chrome do bot aqui, nem abre (o app devolve null e a vista segue pelo servidor).
        void (async () => {
          const motor = await o.motor().catch(() => null);
          const porta = motor ? await motor.portaDoStream({ agenteId }).catch(() => null) : null;
          if (!motor || porta === null) {
            socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
          }
          w.handleUpgrade(req, socket, head, (ws) => atender(ws, agenteId, motor, porta));
        })();
      });
      await new Promise<void>((resolve, reject) => { servidor.once("error", reject); servidor.listen(0, "127.0.0.1", () => resolve()); });
      const addr = servidor.address();
      if (!addr || typeof addr === "string") throw new Error("vista_local_sem_porta");
      http = servidor;
      wss = w;
      endereco = { porta: addr.port, token };
      return endereco;
    },
    async parar() {
      for (const ws of [...abertas]) { try { ws.close(1001); } catch { /* já fechado */ } }
      abertas.clear();
      wss?.close();
      await new Promise<void>((r) => { if (!http) { r(); return; } http.close(() => r()); });
      http = null;
      wss = null;
      endereco = null;
    },
    abertas: () => abertas.size,
  };
}

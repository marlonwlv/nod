import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { abrirOrigemRfb, respostaVnc, validarUrlVncExterna, VNC_FILA_MAX_BYTES } from "../../../src/adapters/computador/relay-vnc.ts";

const SENHA = "senha-vnc";
const DESAFIO = Buffer.from([...Array(16).keys()]);
const esperar = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

class VncFalso extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  etapa = 0;
  autenticou = false;
  recebeu: Buffer[] = [];
  terminou = false;
  constructor() {
    super();
    queueMicrotask(() => { this.emit("open"); this.emit("message", Buffer.from("RFB 003.008\n")); });
  }
  send(dados: Uint8Array): void {
    const b = Buffer.from(dados);
    if (this.etapa === 0) { expect(b.toString()).toBe("RFB 003.008\n"); this.etapa++; return void this.emit("message", Buffer.from([2, 1, 2])); }
    if (this.etapa === 1) { expect([...b]).toEqual([2]); this.etapa++; return void this.emit("message", DESAFIO); }
    if (this.etapa === 2) { this.autenticou = b.equals(respostaVnc(SENHA, DESAFIO)); this.etapa++; return void this.emit("message", Buffer.alloc(4)); }
    if (this.etapa === 3) {
      expect([...b]).toEqual([1]); this.etapa++;
      const inicio = Buffer.alloc(24); inicio.writeUInt16BE(1280, 0); inicio.writeUInt16BE(800, 2); inicio.writeUInt32BE(4, 20);
      return void this.emit("message", Buffer.concat([inicio, Buffer.from("Orgo"), Buffer.from([0, 0, 0, 1])]));
    }
    this.recebeu.push(b);
  }
  close(): void { this.emit("close"); }
  terminate(): void { this.terminou = true; this.emit("close"); }
}

describe("relay RFB autenticado de provedor externo", () => {
  it("termina VNC Auth no servidor, oferece None ao navegador e continua levando quadros e pedidos", async () => {
    const socket = new VncFalso();
    let urlAberta = "";
    const origem = await abrirOrigemRfb({ tipo: "vnc_websocket", url: "wss://www.orgo.ai/desktops/pc-1/ws/websockify", token: SENHA, validoAte: null }, {
      criarSocket: (url) => { urlAberta = url; return socket as never; },
    });
    const saida: Buffer[] = [];
    origem.aoDados((b) => saida.push(Buffer.from(b)));
    await esperar();
    expect(saida.shift()?.toString()).toBe("RFB 003.008\n");
    origem.enviar(Buffer.from("RFB 003.008\n"));
    await esperar();
    expect([...saida.shift()!]).toEqual([1, 1]);
    origem.enviar(Buffer.from([1]));
    await esperar();
    expect([...saida.shift()!]).toEqual([0, 0, 0, 0]);
    origem.enviar(Buffer.from([1]));
    await esperar();
    const inicio = saida.shift()!;
    expect(inicio.readUInt16BE(0)).toBe(1280);
    expect(inicio.readUInt16BE(2)).toBe(800);
    expect(saida.shift()).toEqual(Buffer.from([0, 0, 0, 1]));
    expect(socket.autenticou).toBe(true);
    socket.emit("message", Buffer.from([0, 0, 0, 2]));
    socket.emit("message", Buffer.from([0, 0, 0, 3]));
    await esperar();
    expect(saida.splice(0)).toEqual([Buffer.from([0, 0, 0, 2]), Buffer.from([0, 0, 0, 3])]);
    origem.enviar(Buffer.from([3, 0, 0, 0, 0, 0, 5, 0, 5, 0]));
    expect(socket.recebeu.at(-1)).toEqual(Buffer.from([3, 0, 0, 0, 0, 0, 5, 0, 5, 0]));
    expect(new URL(urlAberta).searchParams.get("token")).toBe(SENHA);
    expect(Buffer.concat(saida).includes(SENHA)).toBe(false);
    expect(() => origem.fechar(1000)).not.toThrow();
  });

  it("recusa SSRF, downgrade, porta, credencial e query antes de abrir socket", async () => {
    const criarSocket = vi.fn();
    for (const url of [
      "ws://www.orgo.ai/desktops/a/ws/websockify",
      "wss://127.0.0.1/desktops/a/ws/websockify",
      "wss://www.orgo.ai:8443/desktops/a/ws/websockify",
      "wss://senha@www.orgo.ai/desktops/a/ws/websockify",
      "wss://www.orgo.ai/desktops/a/ws/websockify?token=vazou",
      "wss://www.orgo.ai/desktops/a/ws/websockify#token=vazou",
      "wss://www.orgo.ai/outro",
    ]) await expect(abrirOrigemRfb({ tipo: "vnc_websocket", url, token: SENHA, validoAte: null }, { criarSocket })).rejects.toThrow("origem_vnc_recusada");
    expect(criarSocket).not.toHaveBeenCalled();
  });

  it("recusa a credencial expirada antes de abrir socket", async () => {
    const criarSocket = vi.fn();
    await expect(abrirOrigemRfb(
      { tipo: "vnc_websocket", url: "wss://www.orgo.ai/desktops/a/ws/websockify", token: SENHA, validoAte: 999 },
      { criarSocket, agora: () => 1_000 },
    )).rejects.toThrow("origem_vnc_expirada");
    expect(criarSocket).not.toHaveBeenCalled();
  });

  it("derruba o upstream que manda um quadro acima do limite", async () => {
    const socket = new VncFalso();
    const origem = await abrirOrigemRfb(
      { tipo: "vnc_websocket", url: "wss://www.orgo.ai/desktops/a/ws/websockify", token: SENHA, validoAte: null },
      { criarSocket: () => socket as never },
    );
    const saida: Buffer[] = [];
    origem.aoDados((b) => saida.push(Buffer.from(b)));
    await esperar();
    saida.length = 0;
    socket.emit("message", Buffer.alloc(VNC_FILA_MAX_BYTES + 1));
    expect(socket.terminou).toBe(true);
    expect(saida).toEqual([]);
  });

  it("avisa a sessão quando o upstream cai antes do pareamento", async () => {
    const socket = new VncFalso();
    const origem = await abrirOrigemRfb(
      { tipo: "vnc_websocket", url: "wss://www.orgo.ai/desktops/a/ws/websockify", token: SENHA, validoAte: null },
      { criarSocket: () => socket as never },
    );
    socket.close();
    const fechou = vi.fn();
    origem.aoFechar(fechou);
    await esperar();
    expect(fechou).toHaveBeenCalledOnce();
  });

  it("mantém o vetor VNC Auth estável e valida só o endpoint público do Orgo", () => {
    expect(respostaVnc(SENHA, DESAFIO).toString("hex")).toBe("1631958ce99168dba3ffbb13a0a74ad2");
    expect(validarUrlVncExterna("wss://www.orgo.ai/desktops/a_B-2/ws/websockify").hostname).toBe("www.orgo.ai");
  });

  it("recusa downgrade para None e versões cujo handshake tem outro formato", async () => {
    class UpstreamInseguro extends EventEmitter {
      bufferedAmount = 0;
      private readonly versao: string;
      constructor(versao: string) { super(); this.versao = versao; queueMicrotask(() => { this.emit("open"); this.emit("message", Buffer.from(this.versao)); }); }
      send(): void { this.emit("message", Buffer.from([1, 1])); }
      close(): void { this.emit("close"); }
      terminate(): void { this.emit("close"); }
    }
    for (const versao of ["RFB 003.003\n", "RFB 003.008\n"]) {
      await expect(abrirOrigemRfb(
        { tipo: "vnc_websocket", url: "wss://www.orgo.ai/desktops/pc-1/ws/websockify", token: SENHA, validoAte: null },
        { criarSocket: () => new UpstreamInseguro(versao) as never },
      )).rejects.toThrow(versao.includes("003.003") ? "rfb_versao_invalida" : "rfb_seguranca_invalida");
    }
  });
});

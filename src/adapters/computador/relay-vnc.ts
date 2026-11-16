import { createCipheriv } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type { AcessoTelaAoVivo } from "../../contracts/provedor-computador.ts";
import type { LadoVivo } from "./vivo.ts";

/** Relay RFB de provedor externo. O servidor autentica no VNC e nunca entrega URL ou senha ao navegador. */
export const VNC_FILA_MAX_BYTES = 8 * 1024 * 1024;
export const VNC_HANDSHAKE_MS = 15_000;
const ORGO_HOST = "www.orgo.ai";
const CAMINHO_ORGO = /^\/desktops\/[A-Za-z0-9_-]+\/ws\/websockify$/;

type SocketVnc = Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "close" | "terminate" | "on" | "once">;
type CriarSocket = (url: string, protocolos: string[]) => SocketVnc;

export function validarUrlVncExterna(valor: string): URL {
  let url: URL;
  try { url = new URL(valor); } catch { throw new Error("origem_vnc_recusada"); }
  if (url.protocol !== "wss:" || url.hostname !== ORGO_HOST || url.port || url.username || url.password || url.hash || !CAMINHO_ORGO.test(url.pathname) || [...url.searchParams.keys()].length) throw new Error("origem_vnc_recusada");
  return url;
}

class FilaBytes {
  private dados = Buffer.alloc(0);
  private esperas: Array<{ n: number; ok: (b: Buffer) => void; erro: (e: Error) => void }> = [];
  private falha: Error | null = null;
  entrar(bytes: Buffer): void { if (this.falha) return; if (this.dados.length + bytes.length > VNC_FILA_MAX_BYTES) return this.fechar(new Error("fila_vnc_cheia")); this.dados = Buffer.concat([this.dados, bytes]); this.drenar(); }
  ler(n: number): Promise<Buffer> { if (this.falha) return Promise.reject(this.falha); return new Promise((ok, erro) => { this.esperas.push({ n, ok, erro }); this.drenar(); }); }
  retirar(): Buffer { const r = this.dados; this.dados = Buffer.alloc(0); return r; }
  fechar(e: Error): void { if (this.falha) return; this.falha = e; for (const p of this.esperas.splice(0)) p.erro(e); }
  private drenar(): void { while (this.esperas[0] && this.dados.length >= this.esperas[0].n) { const p = this.esperas.shift()!; const r = this.dados.subarray(0, p.n); this.dados = this.dados.subarray(p.n); p.ok(Buffer.from(r)); } }
}

const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const reverterBits = (n: number): number => { let r = 0; for (let i = 0; i < 8; i++) if (n & (1 << i)) r |= 1 << (7 - i); return r; };

/** VNC Auth usa DES; 3DES EDE com as três chaves iguais equivale a DES e segue disponível no OpenSSL 3. */
export function respostaVnc(senha: string, desafio: Uint8Array): Buffer {
  if (desafio.byteLength !== 16) throw new Error("desafio_vnc_invalido");
  const curta = Buffer.alloc(8);
  const texto = Buffer.from(senha, "latin1");
  for (let i = 0; i < 8; i++) curta[i] = reverterBits(texto[i] ?? 0);
  const cifra = createCipheriv("des-ede3", Buffer.concat([curta, curta, curta]), null);
  cifra.setAutoPadding(false);
  return Buffer.concat([cifra.update(desafio), cifra.final()]);
}

async function autenticarUpstream(fila: FilaBytes, enviar: (b: Buffer) => void, senha: string): Promise<Buffer> {
  const versao = await fila.ler(12);
  // O handshake 3.3 usa um security-type de quatro bytes, diferente da lista do 3.7/3.8. Falhar fechado evita interpretar
  // bytes sob outro protocolo; o endpoint documentado do Orgo fala 3.8.
  if (!/^RFB 003\.00[78]\n$/.test(versao.toString("ascii"))) throw new Error("rfb_versao_invalida");
  enviar(Buffer.from("RFB 003.008\n"));
  const n = (await fila.ler(1))[0]!;
  if (n === 0) { const tam = (await fila.ler(4)).readUInt32BE(); await fila.ler(Math.min(tam, 4_096)); throw new Error("rfb_recusado"); }
  const tipos = await fila.ler(n);
  // O acesso traz uma senha VNC. Aceitar None quando o upstream omite VNC Auth seria downgrade silencioso.
  const tipo = tipos.includes(2) ? 2 : 0;
  if (!tipo) throw new Error("rfb_seguranca_invalida");
  enviar(Buffer.from([tipo]));
  if (tipo === 2) enviar(respostaVnc(senha, await fila.ler(16)));
  if ((await fila.ler(4)).readUInt32BE() !== 0) throw new Error("rfb_autenticacao_falhou");
  enviar(Buffer.from([1]));
  const cabecalho = await fila.ler(24);
  const tamanhoNome = cabecalho.readUInt32BE(20);
  if (tamanhoNome > 4_096) throw new Error("rfb_nome_invalido");
  const nome = await fila.ler(tamanhoNome);
  return Buffer.concat([cabecalho, nome]);
}

const comoBuffer = (dados: RawData): Buffer => Array.isArray(dados) ? Buffer.concat(dados) : Buffer.from(dados as ArrayBuffer);

export async function abrirOrigemRfb(acesso: AcessoTelaAoVivo, o: { criarSocket?: CriarSocket; prazoMs?: number; agora?: () => number } = {}): Promise<LadoVivo> {
  if (acesso.validoAte !== null && acesso.validoAte <= (o.agora ?? Date.now)()) throw new Error("origem_vnc_expirada");
  const url = validarUrlVncExterna(acesso.url);
  url.searchParams.set("token", acesso.token);
  const ws = (o.criarSocket ?? ((u, protocolos) => new WebSocket(u, protocolos, { perMessageDeflate: false, followRedirects: false, maxPayload: VNC_FILA_MAX_BYTES })))(url.toString(), ["binary"]);
  const fila = new FilaBytes();
  let pronto = false;
  let fechou = false;
  let navegador = Buffer.alloc(0);
  let etapa: "versao" | "seguranca" | "inicio" | "vivo" = "versao";
  let emitir: ((bytes: Uint8Array) => void) | null = null;
  let avisarFechamento: (() => void) | null = null;
  let serverInit: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let sobraUpstream: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const encerrar = (): void => { if (fechou) return; fechou = true; fila.fechar(new Error("origem_vnc_fechada")); avisarFechamento?.(); };
  ws.on("message", (dados: RawData) => {
    const b = comoBuffer(dados);
    if (b.length > VNC_FILA_MAX_BYTES) { ws.terminate(); encerrar(); return; }
    if (pronto) emitir?.(b); else fila.entrar(b);
  });
  ws.on("close", encerrar);
  ws.on("error", encerrar);

  const abriu = new Promise<void>((ok, erro) => { ws.once("open", ok); ws.once("error", () => erro(new Error("origem_vnc_indisponivel"))); });
  const prazo = new Promise<never>((_ok, erro) => { const t = setTimeout(() => erro(new Error("origem_vnc_prazo")), o.prazoMs ?? VNC_HANDSHAKE_MS); t.unref?.(); });
  try {
    await Promise.race([abriu, prazo]);
    serverInit = await Promise.race([autenticarUpstream(fila, (b) => ws.send(b, { binary: true }), acesso.token), prazo]);
    sobraUpstream = fila.retirar();
    pronto = true;
  } catch (e) {
    try { ws.terminate(); } catch { /* já fechou */ }
    throw e instanceof Error && e.message.startsWith("rfb_") ? e : new Error("origem_vnc_indisponivel");
  }

  const mandar = (b: Buffer): void => { queueMicrotask(() => { if (!fechou) emitir?.(b); }); };
  function processarNavegador(): void {
    while (!fechou) {
      if (etapa === "versao") {
        if (navegador.length < 12) return;
        const v = navegador.subarray(0, 12); navegador = navegador.subarray(12);
        if (!/^RFB 003\.00[78]\n$/.test(v.toString("ascii"))) { ws.terminate(); return encerrar(); }
        etapa = "seguranca"; mandar(Buffer.from([1, 1]));
      } else if (etapa === "seguranca") {
        if (navegador.length < 1) return;
        const tipo = navegador[0]; navegador = navegador.subarray(1);
        if (tipo !== 1) { ws.terminate(); return encerrar(); }
        etapa = "inicio"; mandar(u32(0));
      } else if (etapa === "inicio") {
        if (navegador.length < 1) return;
        navegador = navegador.subarray(1); etapa = "vivo"; mandar(serverInit);
        if (sobraUpstream.length) { mandar(sobraUpstream); sobraUpstream = Buffer.alloc(0); }
      } else {
        if (!navegador.length) return;
        if (ws.bufferedAmount + navegador.length > VNC_FILA_MAX_BYTES) { ws.terminate(); return encerrar(); }
        ws.send(navegador, { binary: true }); navegador = Buffer.alloc(0);
      }
    }
  }

  return {
    enviar(bytes) { navegador = Buffer.concat([navegador, bytes]); if (navegador.length > VNC_FILA_MAX_BYTES) { ws.terminate(); encerrar(); return; } processarNavegador(); },
    aoDados(fn) { emitir = fn; mandar(Buffer.from("RFB 003.008\n")); },
    aoFechar(fn) { if (fechou) queueMicrotask(fn); else avisarFechamento = fn; },
    fechar() { try { ws.close(); } catch { /* já fechou */ } encerrar(); },
  };
}

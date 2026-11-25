import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { win32 } from "node:path";
import type { CookieNavegador } from "../../contracts/navegador-maquina.ts";
import { FalhaNavegador } from "../navegador/motor-agent-browser.ts";

/**
 * "Trazer do meu Chrome" no PC (2026-11-23, a paridade do navegador no Windows). No Windows o Chrome prende os cookies do
 * perfil do dia a dia a ele mesmo (`v20`, app-bound, Chrome 127+): nenhum programa de fora os lê, e é de propósito (o
 * Google fechou a porta dos ladrões de sessão). O caminho legítimo é o de quem já faz isso, o 1Password: uma extensão no
 * Chrome da pessoa pergunta ao próprio Chrome (`chrome.cookies`) e fala com o programa local pelo native messaging.
 *
 *   extensão do nod no Chrome ──native messaging (stdin/stdout)──▶ host (`nod-motor navegador-host`, que o Chrome inicia)
 *   host ──pipe local do usuário, com a senha do motor──▶ motor (o navegador do bot) ──▶ cookies do site no Chrome do bot
 *
 * Só os cookies de UM site saem, e só quando o motor pede (o cartão "Trazer do meu Chrome" que a pessoa tocou). O pipe é
 * do usuário e a senha mora no APPDATA dele: outro usuário do PC não fala com o motor.
 */

/** O nome do host do native messaging (o mesmo no manifesto e no `chrome.runtime.connectNative`). */
export const NOME_DO_HOST = "app.nod.navegador";

/**
 * A chave pública da extensão (o `key` do manifesto): fixa o id dela, para o host aceitar só esta extensão
 * (`allowed_origins`). Publicada na Chrome Web Store, a loja usa a mesma chave enviada com o pacote.
 */
export const CHAVE_DA_EXTENSAO = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA69HZ1B6ye68wGhKYAhDR1YyTFH/cNqXs2++f1QgTRw9qPnP5+lHSG7CbEB6RNGjS+H17KUmQ+a+rrqQV+dqjMirkLOslifoR98hwx+2Z5nHJdBNKVwECGBPgpjEX7+vDCljioO/rABMnPZ/z7Lf5TaS8AyZuwe5JBxICPdXk7NE2cw8KlUFNtZOUtczCyAdg5hxOif35QUcvVPPLRBFkyMjZ9w7TMNLQIUhohEyeRcSETjtqwk7JAML2wRifcMxDH0GsXS1Uu+2q02+vKJWQQHEvdvBASxBbGCqMBXGKcycL4EKamWn0G3jVPIyqeAyDvRhiLH7n9sJiQ5KHd/oEUQIDAQAB";

/** O id de uma extensão pela chave pública: os 32 primeiros dígitos hex do SHA-256 da chave, com 0–f virando a–p. */
export function idDaExtensao(chavePublicaBase64: string): string {
  const hex = createHash("sha256").update(Buffer.from(chavePublicaBase64, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
}

export const ID_DA_EXTENSAO = idDaExtensao(CHAVE_DA_EXTENSAO);

/** O manifesto do host que o Chrome lê no registro (HKCU\Software\Google\Chrome\NativeMessagingHosts\app.nod.navegador). */
export function manifestoDoHost(caminhoDoComando: string, idDaExtensaoPermitida: string = ID_DA_EXTENSAO): Record<string, unknown> {
  return { name: NOME_DO_HOST, description: "nod: o navegador do bot traz o login de um site do seu Chrome", path: caminhoDoComando, type: "stdio", allowed_origins: [`chrome-extension://${idDaExtensaoPermitida}/`] };
}

/** O pipe do usuário (no Windows, `\\.\pipe\…`): o nome leva um resumo da pasta do motor, que é por usuário. */
export function pipeDoChrome(pastaDoMotor: string): string {
  return `\\\\.\\pipe\\nod-chrome-${createHash("sha256").update(pastaDoMotor.toLowerCase()).digest("hex").slice(0, 16)}`;
}

/** A senha que o host mostra ao motor (32 bytes, criada pelo motor no APPDATA da pessoa). */
export async function senhaDoChrome(pastaDoMotor: string, criar: boolean): Promise<string | null> {
  const arquivo = win32.join(pastaDoMotor, "chrome-senha");
  const lida = await readFile(arquivo, "utf8").catch(() => "");
  if (/^[0-9a-f]{64}$/u.test(lida.trim())) return lida.trim();
  if (!criar) return null;
  await mkdir(pastaDoMotor, { recursive: true });
  const nova = randomBytes(32).toString("hex");
  await writeFile(arquivo, nova, { mode: 0o600 });
  return nova;
}

// ---- o quadro do native messaging: 4 bytes (little-endian) de tamanho e o JSON -----------------------------------------

/** Um quadro do native messaging (o Chrome limita a mensagem do host para a extensão a 1 MB). */
export function quadroNativo(mensagem: unknown): Buffer {
  const corpo = Buffer.from(JSON.stringify(mensagem), "utf8");
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32LE(corpo.length, 0);
  return Buffer.concat([tamanho, corpo]);
}

/** Lê quadros de um fluxo de bytes (o stdin do host, ou o pipe com linhas JSON): devolve os inteiros e o resto. */
export function lerQuadros(acumulado: Buffer): { mensagens: unknown[]; resto: Buffer } {
  const mensagens: unknown[] = [];
  let b = acumulado;
  while (b.length >= 4) {
    const n = b.readUInt32LE(0);
    if (n > 8 * 1024 * 1024) throw new Error("quadro grande demais");
    if (b.length < 4 + n) break;
    mensagens.push(JSON.parse(b.subarray(4, 4 + n).toString("utf8")));
    b = b.subarray(4 + n);
  }
  return { mensagens, resto: b };
}

/** Linhas JSON (o pipe entre o host e o motor). */
function leitorDeLinhas(aoMensagem: (m: Record<string, unknown>) => void): (pedaco: Buffer) => void {
  let resto = "";
  return (pedaco) => {
    resto += pedaco.toString("utf8");
    let i: number;
    while ((i = resto.indexOf("\n")) >= 0) {
      const linha = resto.slice(0, i);
      resto = resto.slice(i + 1);
      try { const m = JSON.parse(linha) as unknown; if (m && typeof m === "object") aoMensagem(m as Record<string, unknown>); } catch { /* linha estranha: ignora */ }
    }
    if (resto.length > 8 * 1024 * 1024) resto = "";
  };
}

// ---- o host: o Chrome o inicia e ele repassa entre a extensão e o motor ----------------------------------------------------

/**
 * O host do native messaging (`nod-motor navegador-host`): liga no pipe do motor com a senha e repassa os quadros da
 * extensão (stdin) para o motor e as linhas do motor para a extensão (stdout). Sai quando a extensão fecha o stdin.
 */
export async function rodarHostDoChrome(o: { pipe: string; senha: string | null; entrada: NodeJS.ReadableStream; saida: NodeJS.WritableStream }): Promise<number> {
  if (!o.senha) { o.saida.write(quadroNativo({ tipo: "erro", motivo: "o motor do nod não está instalado neste PC" })); return 1; }
  const socket: Socket = connect(o.pipe);
  await new Promise<void>((ok, falhou) => { socket.once("connect", ok); socket.once("error", falhou); }).catch(() => {
    o.saida.write(quadroNativo({ tipo: "erro", motivo: "o motor do nod não está rodando" }));
  });
  if (socket.destroyed) return 1;
  socket.write(`${JSON.stringify({ tipo: "ola", senha: o.senha })}\n`);
  socket.on("data", leitorDeLinhas((m) => o.saida.write(quadroNativo(m))));
  let acumulado: Buffer = Buffer.alloc(0);
  o.entrada.on("data", (pedaco: Buffer) => {
    acumulado = Buffer.concat([acumulado, pedaco]);
    const r = lerQuadros(acumulado);
    acumulado = r.resto;
    for (const m of r.mensagens) socket.write(`${JSON.stringify(m)}\n`);
  });
  return new Promise<number>((fim) => {
    o.entrada.on("end", () => { socket.end(); fim(0); });
    socket.on("close", () => fim(0));
  });
}

// ---- o motor: o lado que pede os cookies -------------------------------------------------------------------------------------

export type PonteDoChrome = {
  /** A extensão do nod está ligada agora (o Chrome da pessoa aberto, com a extensão). */
  conectada(): boolean;
  /** Os cookies do site no Chrome da pessoa, pela extensão. Sem ela: `indisponivel` com o que fazer. */
  cookies(host: string): Promise<CookieNavegador[]>;
  fechar(): Promise<void>;
};

export const SEM_EXTENSAO = "instale a extensão do nod no seu Chrome (e deixe o Chrome aberto) para trazer o login dele";
/** definido em 2026-11-23: a extensão responde na hora; 15 s cobre o service worker acordando. */
const PRAZO_COOKIES_MS = 15_000;
const HOST_VALIDO = /^[a-z0-9.-]{1,253}$/u;

/** O cookie da extensão (o `chrome.cookies.Cookie`), conferido, no formato da ponte. */
export function cookieDaExtensao(c: Record<string, unknown>): CookieNavegador | null {
  if (typeof c.name !== "string" || !c.name || typeof c.value !== "string" || typeof c.domain !== "string") return null;
  const sameSite = c.sameSite === "strict" ? "Strict" : c.sameSite === "no_restriction" ? "None" : "Lax";
  const expira = typeof c.expirationDate === "number" && c.expirationDate > 0 ? Math.floor(c.expirationDate) : -1;
  return { name: c.name, value: c.value, domain: c.domain, path: typeof c.path === "string" && c.path ? c.path : "/", expires: expira, secure: c.secure === true, httpOnly: c.httpOnly === true, sameSite };
}

/** O motor abre o pipe e espera a extensão (pelo host) ligar; uma por vez — a mais nova vale. */
export async function criarPonteDoChrome(o: { pipe: string; senha: string }): Promise<PonteDoChrome> {
  let atual: Socket | null = null;
  let proximo = 1;
  const esperando = new Map<number, { ok: (v: unknown[]) => void; falhou: (e: Error) => void; host: string }>();
  const senhaBuf = Buffer.from(o.senha, "utf8");
  const servidor: Server = createServer((socket) => {
    let autenticado = false;
    socket.on("data", leitorDeLinhas((m) => {
      if (!autenticado) {
        const dada = Buffer.from(typeof m.senha === "string" ? m.senha : "", "utf8");
        if (m.tipo !== "ola" || dada.length !== senhaBuf.length || !timingSafeEqual(dada, senhaBuf)) { socket.destroy(); return; }
        autenticado = true;
        if (atual && atual !== socket) atual.destroy();
        atual = socket;
        return;
      }
      if (m.tipo !== "cookies" || typeof m.id !== "number") return;
      const p = esperando.get(m.id);
      if (!p) return;
      esperando.delete(m.id);
      if (typeof m.erro === "string") p.falhou(new FalhaNavegador("acao_falhou", "o Chrome não entregou os cookies"));
      else p.ok(Array.isArray(m.cookies) ? (m.cookies as unknown[]) : []);
    }));
    socket.on("close", () => { if (atual === socket) atual = null; });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((ok, falhou) => { servidor.once("error", falhou); servidor.listen(o.pipe, ok); });
  return {
    conectada: () => atual !== null && !atual.destroyed,
    async cookies(host) {
      if (!HOST_VALIDO.test(host)) throw new FalhaNavegador("alvo_invalido", "site inválido");
      const s = atual;
      if (!s || s.destroyed) throw new FalhaNavegador("indisponivel", SEM_EXTENSAO);
      const id = proximo++;
      const lista = await new Promise<unknown[]>((ok, falhou) => {
        const prazo = setTimeout(() => { esperando.delete(id); falhou(new FalhaNavegador("tempo_esgotado", "o Chrome não respondeu a tempo")); }, PRAZO_COOKIES_MS);
        esperando.set(id, { ok: (v) => { clearTimeout(prazo); ok(v); }, falhou: (e) => { clearTimeout(prazo); falhou(e); }, host });
        s.write(`${JSON.stringify({ tipo: "cookies", id, host })}\n`);
      });
      return lista.flatMap((c) => { const x = c && typeof c === "object" ? cookieDaExtensao(c as Record<string, unknown>) : null; return x ? [x] : []; });
    },
    fechar: () => new Promise<void>((ok) => { atual?.destroy(); servidor.close(() => ok()); }),
  };
}

// ---- o registro do host no Windows (o motor faz ao subir; a atualização automática também o leva) ----------------------

/** O que o registro faz no disco e no registro do Windows (injetável no teste). */
export type DepsRegistro = {
  gravar: (caminho: string, conteudo: string) => Promise<void>;
  executar: (bin: string, args: readonly string[]) => Promise<{ codigo: number | null }>;
};

/**
 * O host do native messaging no PC: o atalho `navegador-host.cmd` (o Chrome inicia um .exe ou um .cmd; o .cmd chama o
 * node do nod com o motor), o manifesto com o id da extensão e a chave em HKCU (só deste usuário, sem admin). Rodar de
 * novo regrava igual. Devolve o caminho do manifesto.
 */
export async function registrarHostNoWindows(o: { pasta: string; nodeExe: string; motorMjs: string; systemRoot: string; deps?: DepsRegistro }): Promise<string> {
  const deps = o.deps ?? {
    gravar: async (c, t) => { await mkdir(win32.dirname(c), { recursive: true }); await writeFile(c, t); },
    executar: async (bin, args) => {
      const { execFile } = await import("node:child_process");
      return new Promise((ok) => { execFile(bin, [...args], { windowsHide: true, timeout: 15_000 }, (e) => ok({ codigo: e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 1) : 0 })); });
    },
  };
  const cmd = win32.join(o.pasta, "navegador-host.cmd");
  const manifesto = win32.join(o.pasta, `${NOME_DO_HOST}.json`);
  await deps.gravar(cmd, `@echo off\r\n"${o.nodeExe}" "${o.motorMjs}" navegador-host %*\r\n`);
  await deps.gravar(manifesto, `${JSON.stringify(manifestoDoHost(cmd), null, 2)}\n`);
  const reg = win32.join(o.systemRoot, "System32", "reg.exe");
  const r = await deps.executar(reg, ["add", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NOME_DO_HOST}`, "/ve", "/t", "REG_SZ", "/d", manifesto, "/f"]);
  if (r.codigo !== 0) throw new Error(`reg add saiu com ${String(r.codigo)}`);
  return manifesto;
}

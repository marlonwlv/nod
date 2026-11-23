import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import type { CookieNavegador } from "../src/contracts/navegador-maquina.ts";
import { cookieServeAoHost } from "../src/domain/navegador-cofre.ts";
import { FalhaNavegador } from "../src/adapters/navegador/motor-agent-browser.ts";
import { COOKIES_MAX } from "../src/adapters/navegador/operacoes-remotas.ts";

/**
 * "Trazer do meu Chrome" no PC (2026-11-22, o navegador no Windows; ADR-190, L1). No Windows o Chrome cifra os cookies
 * com a chave do usuário (DPAPI, `v10`) e, desde o Chrome 127, com a "app-bound encryption" (`v20`): só o próprio Chrome
 * instalado consegue pedir a chave ao serviço de elevação dele. Ler o banco de fora (como no Mac) não funciona mais.
 *
 * Então quem lê é o próprio Chrome da pessoa: o `Local State` (as chaves cifradas) e o banco `Cookies` do perfil Default
 * vão para uma pasta temporária, o `chrome.exe` dela abre essa cópia sem janela e com a porta de depuração (permitida
 * fora da pasta padrão), e o `Storage.getCookies` do CDP devolve os cookies já decifrados. Só os do site pedido (e dos
 * domínios pais dele) saem daqui; o resto nunca deixa a pasta, que some no fim. O perfil real da pessoa não é aberto.
 *
 * Com o Chrome dela aberto, o Windows trava o banco `Cookies` (o Chrome o abre sem compartilhar): a cópia falha e a
 * pessoa ouve para fechar o Chrome e tentar de novo.
 */

/** O Google Chrome instalado (por máquina ou só do usuário). Só o Google Chrome: o Edge tem o próprio perfil e cofre. */
export function googleChromeDoWindows(env: Readonly<Record<string, string | undefined>>, existe: (p: string) => boolean = existsSync): string | null {
  return ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"].flatMap((v) => (env[v] ? [win32.join(env[v]!, "Google", "Chrome", "Application", "chrome.exe")] : [])).find(existe) ?? null;
}

/** O que este arquivo usa para abrir o Chrome e falar CDP com ele (o teste não injeta: roda o Chrome de verdade). */
export type OpcoesCookiesNoWindows = {
  host: string;
  env: Readonly<Record<string, string | undefined>>;
  /** A pasta `User Data` do Chrome da pessoa (padrão: %LOCALAPPDATA%\Google\Chrome\User Data). */
  pastaDoChrome?: string;
  /** O chrome.exe (padrão: o Google Chrome instalado). */
  chrome?: string | null;
  agoraSeg?: () => number;
  /** O prazo para o Chrome abrir e responder (padrão 30 s). */
  prazoMs?: number;
};

const PRAZO_PADRAO_MS = 30_000;

/** O cookie como o `Storage.getCookies` do CDP devolve. */
type CookieCdp = { name?: unknown; value?: unknown; domain?: unknown; path?: unknown; expires?: unknown; httpOnly?: unknown; secure?: unknown; sameSite?: unknown; session?: unknown };

/** Os cookies do CDP que servem ao host, no formato da ponte; vencidos e sem nome ficam de fora. */
export function cookiesDoCdpParaOHost(lista: readonly CookieCdp[], host: string, agoraSeg: number): CookieNavegador[] {
  const saida: CookieNavegador[] = [];
  for (const c of lista) {
    if (typeof c.name !== "string" || !c.name || typeof c.domain !== "string" || typeof c.value !== "string") continue;
    if (!cookieServeAoHost(c.domain, host)) continue;
    const expira = c.session === true || typeof c.expires !== "number" || c.expires <= 0 ? -1 : Math.floor(c.expires);
    if (expira !== -1 && expira <= agoraSeg) continue;
    const sameSite = c.sameSite === "Strict" || c.sameSite === "None" ? c.sameSite : "Lax";
    saida.push({ name: c.name, value: c.value, domain: c.domain, path: typeof c.path === "string" && c.path ? c.path : "/", expires: expira, secure: c.secure === true, httpOnly: c.httpOnly === true, sameSite });
    if (saida.length >= COOKIES_MAX) break;
  }
  return saida;
}

/** A frase quando o Chrome do Windows não deixa os cookies saírem (a criptografia presa a ele, Chrome 127+). */
export const PRESOS_AO_CHROME = "o Chrome do Windows protege os cookies deste site e não deixa outro programa lê-los: entre pelo cofre ou faça o login no navegador do bot";

/** Quantos cookies do site estão cifrados com a criptografia presa ao Chrome (`v20`) no banco copiado. */
async function cookiesPresosAoChrome(banco: string, host: string): Promise<number> {
  try {
    const sqlite = (await import("node:sqlite")) as unknown as { DatabaseSync: new (c: string, o: { readOnly: boolean }) => { prepare(q: string): { all(...p: unknown[]): Record<string, unknown>[] }; close(): void } };
    const db = new sqlite.DatabaseSync(banco, { readOnly: true });
    try {
      return db.prepare("select host_key, substr(encrypted_value, 1, 3) as pre from cookies").all()
        .filter((l) => typeof l.host_key === "string" && cookieServeAoHost(l.host_key, host) && l.pre instanceof Uint8Array && Buffer.from(l.pre).toString("latin1") === "v20").length;
    } finally { db.close(); }
  } catch { return 0; }
}

const espera = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/** Copia um arquivo do perfil; o banco travado pelo Chrome aberto vira a frase para a pessoa. */
async function copiar(de: string, para: string): Promise<void> {
  try {
    await copyFile(de, para);
  } catch (e) {
    const codigo = (e as { code?: string }).code;
    if (codigo === "EBUSY" || codigo === "EPERM" || codigo === "EACCES") throw new FalhaNavegador("indisponivel", "feche o Google Chrome e tente de novo: com ele aberto, o Windows não deixa ler os cookies");
    throw e;
  }
}

/** A porta e o caminho do CDP que o Chrome grava em `DevToolsActivePort` quando sobe com `--remote-debugging-port=0`. */
async function portaDoChrome(pasta: string, filho: ChildProcess, ate: number): Promise<{ porta: number; caminho: string }> {
  const arquivo = join(pasta, "DevToolsActivePort");
  while (Date.now() < ate) {
    if (filho.exitCode !== null) throw new FalhaNavegador("acao_falhou", "o Google Chrome fechou antes de responder");
    const t = await readFile(arquivo, "utf8").catch(() => "");
    const [porta, caminho] = t.split(/\r?\n/u);
    if (porta && /^\d+$/u.test(porta) && caminho?.startsWith("/devtools/browser/")) return { porta: Number(porta), caminho };
    await espera(150);
  }
  throw new FalhaNavegador("tempo_esgotado", "o Google Chrome não respondeu a tempo");
}

/** Um pedido CDP pelo WebSocket global (Node 22+), com prazo. */
async function pedirCdp(url: string, metodo: string, prazoMs: number): Promise<Record<string, unknown>> {
  const WS = (globalThis as { WebSocket?: new (u: string) => WebSocket }).WebSocket;
  if (!WS) throw new FalhaNavegador("indisponivel", "este Node não tem WebSocket");
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    const prazo = setTimeout(() => { ws.close(); reject(new FalhaNavegador("tempo_esgotado", "o Google Chrome não respondeu a tempo")); }, prazoMs);
    ws.onerror = () => { clearTimeout(prazo); reject(new FalhaNavegador("acao_falhou", "não consegui falar com o Google Chrome")); };
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: metodo }));
    ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: unknown };
      if (m.id !== 1) return;
      clearTimeout(prazo);
      ws.close();
      if (m.error || !m.result) reject(new FalhaNavegador("acao_falhou", "o Google Chrome recusou a leitura dos cookies"));
      else resolve(m.result);
    };
  });
}

export async function cookiesDoChromeNoWindows(o: OpcoesCookiesNoWindows): Promise<CookieNavegador[]> {
  const pastaDoChrome = o.pastaDoChrome ?? (o.env.LOCALAPPDATA ? win32.join(o.env.LOCALAPPDATA, "Google", "Chrome", "User Data") : "");
  const localState = join(pastaDoChrome, "Local State");
  if (!pastaDoChrome || !existsSync(localState)) throw new FalhaNavegador("indisponivel", "não achei o Google Chrome neste PC");
  const banco = [join(pastaDoChrome, "Default", "Network", "Cookies"), join(pastaDoChrome, "Default", "Cookies")].find((c) => existsSync(c));
  if (!banco) return [];
  const chrome = o.chrome === undefined ? googleChromeDoWindows(o.env) : o.chrome;
  if (!chrome) throw new FalhaNavegador("indisponivel", "não achei o Google Chrome neste PC");
  const prazoMs = o.prazoMs ?? PRAZO_PADRAO_MS;
  const pasta = await mkdtemp(join(tmpdir(), "nod-chrome-"));
  let filho: ChildProcess | null = null;
  try {
    await copiar(localState, join(pasta, "Local State"));
    await mkdir(join(pasta, "Default", "Network"), { recursive: true });
    await copiar(banco, join(pasta, "Default", "Network", "Cookies"));
    if (existsSync(`${banco}-journal`)) await copiar(`${banco}-journal`, join(pasta, "Default", "Network", "Cookies-journal"));
    // Contados antes de o Chrome abrir a cópia: aberto, ele trava o arquivo e descarta o que não consegue decifrar.
    const presos = await cookiesPresosAoChrome(join(pasta, "Default", "Network", "Cookies"), o.host);
    // Sem janela, sem extensões, sem sincronizar e sem rede além do necessário: só abrir o perfil e ler.
    filho = spawn(chrome, ["--headless=new", `--user-data-dir=${pasta}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update", "about:blank"], { stdio: "ignore", windowsHide: true });
    const { porta, caminho } = await portaDoChrome(pasta, filho, Date.now() + prazoMs);
    const r = await pedirCdp(`ws://127.0.0.1:${porta}${caminho}`, "Storage.getCookies", prazoMs);
    const lista = Array.isArray(r.cookies) ? (r.cookies as CookieCdp[]) : [];
    const cookies = cookiesDoCdpParaOHost(lista, o.host, (o.agoraSeg ?? (() => Math.floor(Date.now() / 1000)))());
    // O perfil do dia a dia cifra com a criptografia presa ao Chrome ("v20"): a cópia não a abre e o Chrome descarta esses
    // cookies em silêncio. Havendo `v20` do site e nada lido, a pessoa ouve o porquê (e não um "sem cookies" calado).
    if (cookies.length === 0 && presos > 0) throw new FalhaNavegador("indisponivel", PRESOS_AO_CHROME);
    return cookies;
  } finally {
    if (filho && filho.exitCode === null) {
      filho.kill();
      await new Promise<void>((r) => { const t = setTimeout(r, 5_000); t.unref?.(); filho!.once("exit", () => { clearTimeout(t); r(); }); });
    }
    // O Chrome solta os arquivos um instante depois de sair.
    for (let i = 0; i < 10; i++) {
      try { await rm(pasta, { recursive: true, force: true }); break; } catch { await espera(300); }
    }
  }
}

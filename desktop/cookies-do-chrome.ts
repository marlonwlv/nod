import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CookieNavegador } from "../src/contracts/navegador-maquina.ts";
import { cookieServeAoHost, dominioRegistravel } from "../src/domain/navegador-cofre.ts";
import { FalhaNavegador } from "../src/adapters/navegador/motor-agent-browser.ts";
import { COOKIES_MAX } from "../src/adapters/navegador/operacoes-remotas.ts";
import type { ExecutarDoCofre } from "./cofres-do-mac.ts";

/**
 * "Trazer do meu Chrome" (ADR-190, L1): os cookies de UM site no Chrome da pessoa no macOS (desde 2026-11-23, o perfil
 * que tem a sessão, no Chrome, no Arc, no Brave ou no Edge), para o
 * navegador do bot entrar já logado. Só o host pedido e os pais dele até o domínio registrável; nunca o resto do Chrome.
 *
 * O formato (definido em 2026-11-20, o que o Chrome do macOS grava): o banco SQLite `Cookies`; o valor cifrado começa com
 * `v10` e é AES-128-CBC com IV de 16 espaços, chave = PBKDF2-SHA1(senha "Chrome Safe Storage" do Keychain, "saltysalt",
 * 1003 iterações, 16 bytes). Com `meta.version >= 24`, o valor decifrado começa com os 32 bytes do SHA-256 do domínio,
 * que saem. Ler a senha do Keychain faz o macOS perguntar à pessoa se o nod pode usá-la: essa é a confirmação.
 *
 * O banco é copiado para uma pasta temporária (0700) antes de abrir: o Chrome aberto o mantém travado. A pasta some no fim.
 */

/** O pedaço do `node:sqlite` que este arquivo usa (o teste abre o mesmo módulo). */
type Linha = Record<string, unknown>;
type Consulta = { all(...p: unknown[]): Linha[]; get(...p: unknown[]): Linha | undefined; setReadBigInts(ligar: boolean): void };
type Banco = { prepare(sql: string): Consulta; close(): void };

export type OpcoesCookiesDoChrome = {
  host: string;
  /** O HOME da pessoa (o perfil fica em ~/Library/Application Support/Google/Chrome/Default). */
  home: string;
  executar: ExecutarDoCofre;
  /** O `security` do macOS (o teste passa um falso). */
  security?: string;
  /** Agora em segundos Unix (cookies vencidos não viajam). */
  agoraSeg?: () => number;
  abrirBanco?: (caminho: string) => Promise<Banco>;
};

/** definido em 2026-11-20: a pergunta do Keychain espera a pessoa (até 60 s). */
const PRAZO_KEYCHAIN_MS = 60_000;
/** Segundos entre 1601-01-01 (o relógio do Chrome) e 1970-01-01. */
const EPOCA_CHROME_S = 11_644_473_600;

async function abrirComSqlite(caminho: string): Promise<Banco> {
  const sqlite = (await import("node:sqlite")) as unknown as { DatabaseSync: new (c: string, o: { readOnly: boolean }) => Banco };
  return new sqlite.DatabaseSync(caminho, { readOnly: true });
}

/** A chave AES do Chrome a partir da senha do Keychain. */
export function chaveDoChrome(senha: string): Buffer {
  return pbkdf2Sync(senha, "saltysalt", 1003, 16, "sha1");
}

/** O valor de um cookie (claro, ou `v10` cifrado). null = não deu para decifrar (o cookie fica de fora). */
export function valorDoCookie(claro: string, cifrado: Uint8Array | null, chave: () => Buffer, versao: number): string | null {
  const c = cifrado ? Buffer.from(cifrado) : Buffer.alloc(0);
  if (c.length === 0) return claro;
  if (c.subarray(0, 3).toString("latin1") !== "v10") return null;
  try {
    const d = createDecipheriv("aes-128-cbc", chave(), Buffer.alloc(16, 0x20));
    const claroBytes = Buffer.concat([d.update(c.subarray(3)), d.final()]);
    return (versao >= 24 ? claroBytes.subarray(32) : claroBytes).toString("utf8");
  } catch {
    return null;
  }
}

const SAME_SITE: Readonly<Record<number, CookieNavegador["sameSite"]>> = { 0: "None", 1: "Lax", 2: "Strict" };

/**
 * Os navegadores Chromium do Mac que o "Trazer do meu Chrome" lê (2026-11-23: o dono usa o Arc, não o Chrome, e o login
 * do LinkedIn estava só nele). Mesmo formato de banco e de cifra; muda a pasta e o item do Keychain.
 */
export const NAVEGADORES_DO_MAC: readonly { nome: string; pasta: readonly string[]; keychain: string }[] = [
  { nome: "Google Chrome", pasta: ["Google", "Chrome"], keychain: "Chrome Safe Storage" },
  { nome: "Arc", pasta: ["Arc", "User Data"], keychain: "Arc Safe Storage" },
  { nome: "Brave", pasta: ["BraveSoftware", "Brave-Browser"], keychain: "Brave Safe Storage" },
  { nome: "Microsoft Edge", pasta: ["Microsoft Edge"], keychain: "Microsoft Edge Safe Storage" },
];

/** Um perfil com banco de cookies: de qual navegador e onde. */
type Candidato = { navegador: (typeof NAVEGADORES_DO_MAC)[number]; perfil: string; banco: string };

/** Os perfis ("Default", "Profile 1"…) de cada navegador instalado que têm o banco `Cookies`. */
async function candidatos(home: string): Promise<Candidato[]> {
  const saida: Candidato[] = [];
  for (const navegador of NAVEGADORES_DO_MAC) {
    const raiz = join(home, "Library", "Application Support", ...navegador.pasta);
    if (!existsSync(raiz)) continue;
    const perfis = (await readdir(raiz).catch(() => [] as string[])).filter((n) => n === "Default" || /^Profile \d+$/u.test(n)).sort((a, b) => (a === "Default" ? -1 : b === "Default" ? 1 : a.localeCompare(b, "en", { numeric: true })));
    for (const perfil of perfis) {
      const banco = join(raiz, perfil, "Cookies");
      if (existsSync(banco)) saida.push({ navegador, perfil, banco });
    }
  }
  return saida;
}

const COLUNAS = "host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite";

/** Segundos Unix da validade do Chrome (microssegundos desde 1601, bigint); -1 = de sessão. */
function expiraEm(l: Linha): number {
  const segundos = typeof l.expires_utc === "bigint" ? Number(l.expires_utc / 1_000_000n) : Math.floor(Number(l.expires_utc ?? 0) / 1_000_000);
  return segundos > 0 ? segundos - EPOCA_CHROME_S : -1;
}

/** Abre a cópia de um banco e devolve a versão e as linhas que servem ao host (ainda cifradas). */
async function lerBanco(o: OpcoesCookiesDoChrome, pasta: string, c: Candidato, i: number): Promise<{ versao: number; linhas: Linha[] }> {
  const copia = join(pasta, `Cookies-${i}`);
  await copyFile(c.banco, copia);
  // O WAL tem as gravações recentes (um login de agora pode estar só nele).
  if (existsSync(`${c.banco}-wal`)) await copyFile(`${c.banco}-wal`, `${copia}-wal`);
  const banco = await (o.abrirBanco ?? abrirComSqlite)(copia);
  try {
    const versao = Number(banco.prepare("select value from meta where key = 'version'").get()?.value ?? 0);
    const consulta = banco.prepare(`select ${COLUNAS} from cookies where host_key like ?`);
    // A validade do Chrome é em microssegundos desde 1601 (~1,3e16): passa do inteiro seguro do JS, então vem como bigint.
    consulta.setReadBigInts(true);
    const linhas = consulta.all(`%${dominioRegistravel(o.host)}`).filter((l) => typeof l.host_key === "string" && cookieServeAoHost(l.host_key, o.host));
    return { versao, linhas };
  } finally {
    banco.close();
  }
}

/**
 * Os cookies do site no perfil que tem a sessão dele: todos os perfis do Chrome, do Arc, do Brave e do Edge são olhados
 * (só os nomes e as validades, sem decifrar) e vence o que tem mais cookies válidos do site (o login de verdade deixa
 * vários; um perfil que só visitou deixa dois ou três). Só o vencedor é decifrado: um pedido do Keychain, o dele.
 */
export async function cookiesDoChrome(o: OpcoesCookiesDoChrome): Promise<CookieNavegador[]> {
  const todos = await candidatos(o.home);
  if (todos.length === 0) throw new FalhaNavegador("indisponivel", "não achei o Google Chrome (nem o Arc, o Brave ou o Edge) neste Mac");
  const agora = (o.agoraSeg ?? (() => Math.floor(Date.now() / 1000)))();
  const pasta = await mkdtemp(join(tmpdir(), "nod-chrome-"));
  try {
    let melhor: { c: Candidato; versao: number; linhas: Linha[] } | null = null;
    for (const [i, c] of todos.entries()) {
      const lido = await lerBanco(o, pasta, c, i).catch(() => null);
      if (!lido) continue;
      const validas = lido.linhas.filter((l) => { const e = expiraEm(l); return e === -1 || e > agora; });
      if (!melhor || validas.length > melhor.linhas.length) melhor = { c, versao: lido.versao, linhas: validas };
    }
    if (!melhor || melhor.linhas.length === 0) return [];
    const { c, versao, linhas } = melhor;
    let chave: Buffer | null = null;
    const pegarChave = (): Buffer => {
      if (!chave) throw new FalhaNavegador("recusado", "o macOS não liberou o Keychain");
      return chave;
    };
    if (linhas.some((l) => l.encrypted_value instanceof Uint8Array && l.encrypted_value.length > 0)) {
      const r = await o.executar(o.security ?? "/usr/bin/security", ["find-generic-password", "-w", "-s", c.navegador.keychain], { prazoMs: PRAZO_KEYCHAIN_MS });
      if (r.codigo !== 0 || !r.saida.trim()) throw new FalhaNavegador("recusado", "o macOS não liberou o Keychain");
      chave = chaveDoChrome(r.saida.replace(/\r?\n$/, ""));
    }
    const cookies: CookieNavegador[] = [];
    for (const l of linhas) {
      const valor = valorDoCookie(typeof l.value === "string" ? l.value : "", l.encrypted_value instanceof Uint8Array ? l.encrypted_value : null, pegarChave, versao);
      if (valor === null || typeof l.name !== "string" || !l.name) continue;
      cookies.push({ name: l.name, value: valor, domain: String(l.host_key), path: typeof l.path === "string" && l.path ? l.path : "/", expires: expiraEm(l), secure: Number(l.is_secure) === 1, httpOnly: Number(l.is_httponly) === 1, sameSite: SAME_SITE[Number(l.samesite)] ?? "Lax" });
      if (cookies.length >= COOKIES_MAX) break;
    }
    return cookies;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CookieNavegador } from "../src/contracts/navegador-maquina.ts";
import { cookieServeAoHost, dominioRegistravel } from "../src/domain/navegador-cofre.ts";
import { FalhaNavegador } from "../src/adapters/navegador/motor-agent-browser.ts";
import { COOKIES_MAX } from "../src/adapters/navegador/operacoes-remotas.ts";
import type { ExecutarDoCofre } from "./cofres-do-mac.ts";

/**
 * "Trazer do meu Chrome" (ADR-190, L1): os cookies de UM site no Chrome da pessoa no macOS (perfil Default), para o
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

export async function cookiesDoChrome(o: OpcoesCookiesDoChrome): Promise<CookieNavegador[]> {
  const origem = join(o.home, "Library", "Application Support", "Google", "Chrome", "Default", "Cookies");
  if (!existsSync(origem)) throw new FalhaNavegador("indisponivel", "não achei o Google Chrome neste Mac");
  const pasta = await mkdtemp(join(tmpdir(), "nod-chrome-"));
  try {
    const copia = join(pasta, "Cookies");
    await copyFile(origem, copia);
    // O WAL tem as gravações recentes (um login de agora pode estar só nele).
    if (existsSync(`${origem}-wal`)) await copyFile(`${origem}-wal`, `${copia}-wal`);
    const banco = await (o.abrirBanco ?? abrirComSqlite)(copia);
    try {
      const versao = Number(banco.prepare("select value from meta where key = 'version'").get()?.value ?? 0);
      const consulta = banco.prepare("select host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite from cookies where host_key like ?");
      // A validade do Chrome é em microssegundos desde 1601 (~1,3e16): passa do inteiro seguro do JS, então vem como bigint.
      consulta.setReadBigInts(true);
      const linhas = consulta.all(`%${dominioRegistravel(o.host)}`);
      const doSite = linhas.filter((l) => typeof l.host_key === "string" && cookieServeAoHost(l.host_key, o.host));
      let chave: Buffer | null = null;
      const pegarChave = (): Buffer => {
        if (!chave) throw new FalhaNavegador("recusado", "o macOS não liberou o Keychain");
        return chave;
      };
      if (doSite.some((l) => l.encrypted_value instanceof Uint8Array && l.encrypted_value.length > 0)) {
        const r = await o.executar(o.security ?? "/usr/bin/security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], { prazoMs: PRAZO_KEYCHAIN_MS });
        if (r.codigo !== 0 || !r.saida.trim()) throw new FalhaNavegador("recusado", "o macOS não liberou o Keychain");
        chave = chaveDoChrome(r.saida.replace(/\r?\n$/, ""));
      }
      const agora = (o.agoraSeg ?? (() => Math.floor(Date.now() / 1000)))();
      const cookies: CookieNavegador[] = [];
      for (const l of doSite) {
        const valor = valorDoCookie(typeof l.value === "string" ? l.value : "", l.encrypted_value instanceof Uint8Array ? l.encrypted_value : null, pegarChave, versao);
        if (valor === null || typeof l.name !== "string" || !l.name) continue;
        const segundos = typeof l.expires_utc === "bigint" ? Number(l.expires_utc / 1_000_000n) : Math.floor(Number(l.expires_utc ?? 0) / 1_000_000);
        const expira = segundos > 0 ? segundos - EPOCA_CHROME_S : -1;
        if (expira !== -1 && expira <= agora) continue;
        cookies.push({ name: l.name, value: valor, domain: String(l.host_key), path: typeof l.path === "string" && l.path ? l.path : "/", expires: expira, secure: Number(l.is_secure) === 1, httpOnly: Number(l.is_httponly) === 1, sameSite: SAME_SITE[Number(l.samesite)] ?? "Lax" });
        if (cookies.length >= COOKIES_MAX) break;
      }
      return cookies;
    } finally {
      banco.close();
    }
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

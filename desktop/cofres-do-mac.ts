import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { OpcaoLogin } from "../src/contracts/navegador-do-bot.ts";
import type { CookieNavegador, FonteDoMac } from "../src/contracts/navegador-maquina.ts";
import type { RecursosDoMac } from "../src/adapters/executor/navegador.ts";
import { FalhaNavegador } from "../src/adapters/navegador/motor-agent-browser.ts";
import { itemCasaComHost, MOTIVO_BITWARDEN_TRAVADO, OPCOES_MAX, rotuloDoItem } from "../src/domain/navegador-cofre.ts";
import { CAMINHOS_OP, opDaAgileBits, referenciaValida } from "./cofre-1password.ts";
import { cookiesDoChrome } from "./cookies-do-chrome.ts";

/**
 * Os cofres da pessoa no Mac para o navegador do bot (ADR-177, ADR-190 decisão 6; quadro L do Paper): o 1Password pelo
 * `op` (conferido como da AgileBits antes de rodar) e o Bitwarden pelo `bw` (com a sessão destravada que a pessoa deu ao
 * app). Tudo por `execFile`, sem shell; a senha nunca vai no argv: ao gravar, vai pelo stdin (`op item create -`, o
 * `bw encode | bw create item`); ao ler, volta pelo stdout de `op read`/`bw get password` e segue direto para quem
 * preenche. Nada aqui loga valor.
 *
 * A lista do cartão (L1) espera pouco: o `op` travado pede o Touch ID antes de listar; se não respondeu a tempo, a opção
 * vem genérica ("Usar o 1Password", ref vazia) e, escolhida, o app lista e lê de uma vez (um Touch ID só).
 */

/** Um processo sem shell, com prazo e stdin opcional (injetável: o teste roda `op`/`bw` falsos). */
export type ExecutarDoCofre = (bin: string, args: readonly string[], o?: { prazoMs?: number; entrada?: string; env?: Readonly<Record<string, string>> }) => Promise<{ codigo: number; saida: string; erro: string; estourou: boolean }>;

/** definido em 2026-11-20: prazos dos cofres — listar 4 s (o cartão espera), ler 90 s (o Touch ID espera a pessoa). */
const PRAZO_LISTAR_MS = 4_000;
const PRAZO_LER_MS = 90_000;
const PRAZO_CURTO_MS = 15_000;
const SAIDA_MAX = 8 * 1024 * 1024;

export const executarDoCofre: ExecutarDoCofre = (bin, args, o) => new Promise((resolve) => {
  const filho = execFile(bin, [...args], { timeout: o?.prazoMs ?? PRAZO_CURTO_MS, maxBuffer: SAIDA_MAX, env: o?.env ? { ...o.env } : envMinimo(), killSignal: "SIGKILL" }, (erro, stdout, stderr) => {
    const e = erro as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
    resolve({ codigo: e ? (typeof e.code === "number" ? e.code : -1) : 0, saida: String(stdout), erro: String(stderr).slice(0, 4000), estourou: e?.killed === true });
  });
  if (o?.entrada !== undefined) filho.stdin?.end(o.entrada);
  else filho.stdin?.end();
});

/** O env que o `op` e o `bw` precisam: o HOME (o socket do app do 1Password, os dados do bw) e o PATH; nada do app. */
function envMinimo(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const e = process.env;
  return { PATH: e.PATH ?? "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin", HOME: e.HOME ?? "", ...(e.USER ? { USER: e.USER } : {}), ...(e.TMPDIR ? { TMPDIR: e.TMPDIR } : {}), LANG: "en_US.UTF-8", ...extra };
}

export const CAMINHOS_BW = ["/opt/homebrew/bin/bw", "/usr/local/bin/bw"] as const;

export type OpcoesCofresDoMac = {
  executar?: ExecutarDoCofre;
  home: string;
  /** O `op` da AgileBits (conferido pela assinatura) ou null. Injetável no teste. */
  acharOp?: () => Promise<string | null>;
  /** O `bw` ou null. */
  acharBw?: () => Promise<string | null>;
  /** A sessão destravada do Bitwarden (BW_SESSION) que a pessoa deu ao app; null = travado. */
  sessaoBitwarden?: () => string | null;
  /** O Touch ID do Mac (o app passa o do Electron); true = confirmou. */
  touchId: (motivo: string) => Promise<boolean>;
  /** O `security` (Keychain) para os cookies do Chrome; o teste passa um falso. */
  security?: string;
  /**
   * 2026-11-22 (o navegador no PC): o que muda no Windows (desktop/cofres-do-windows.ts). Ausente = o Mac: o env mínimo do
   * macOS, a pasta do Bitwarden em ~/Library, os cookies pelo Keychain e "neste Mac" nas frases.
   */
  plataforma?: {
    ambiente: (extra?: Readonly<Record<string, string>>) => Record<string, string>;
    pastaDoBitwarden: string;
    cookies: (host: string) => Promise<CookieNavegador[]>;
    onde: string;
    bitwardenTravado: string;
  };
};

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const json = (t: string): unknown => { try { return JSON.parse(t); } catch { return null; } };
/** O id de item do 1Password e do Bitwarden (sem barra, aspas ou controle: vai no argv e numa referência op://). */
const ID_ITEM = /^[A-Za-z0-9-]{1,64}$/;

/** A referência do usuário a partir da da senha (`op://cofre/item/password` → `…/username`). */
export function refDoUsuario(refSenha: string): string {
  return refSenha.replace(/\/[^/]+$/, "/username");
}

export function criarCofresDoMac(o: OpcoesCofresDoMac): RecursosDoMac {
  const executar = o.executar ?? executarDoCofre;
  const acharOp = o.acharOp ?? (async () => {
    for (const c of CAMINHOS_OP) if (existsSync(c) && await opDaAgileBits(c, async (cmd, args) => { const r = await executar(cmd, args); return { codigo: r.codigo, saida: `${r.saida}${r.erro}` }; })) return c;
    return null;
  });
  const acharBw = o.acharBw ?? (async () => CAMINHOS_BW.find((c) => existsSync(c)) ?? null);
  const sessao = o.sessaoBitwarden ?? (() => process.env.BW_SESSION ?? null);
  const env = o.plataforma?.ambiente ?? envMinimo;
  const onde = o.plataforma?.onde ?? "neste Mac";
  const envBw = (s: string) => env({ BW_SESSION: s, BITWARDENCLI_APPDATA_DIR: o.plataforma?.pastaDoBitwarden ?? `${o.home}/Library/Application Support/Bitwarden CLI` });

  /** Os logins do 1Password do site: `op item list --categories Login`, filtrado pela URL do item. */
  async function itens1Password(op: string, host: string, prazoMs = PRAZO_LISTAR_MS): Promise<{ ref: string; titulo: string; usuario: string }[] | "travado"> {
    const r = await executar(op, ["item", "list", "--categories", "Login", "--format", "json"], { prazoMs, env: env() });
    if (r.estourou) return "travado";
    if (r.codigo !== 0) return [];
    return lista(json(r.saida)).flatMap((i) => {
      const id = str(i.id);
      const cofre = str(obj(i.vault).id);
      const urls = lista(i.urls).map((u) => str(u.href));
      if (!ID_ITEM.test(id) || !ID_ITEM.test(cofre) || !urls.some((u) => itemCasaComHost(u, host))) return [];
      return [{ ref: `op://${cofre}/${id}/password`, titulo: str(i.title) || host, usuario: str(i.additional_information) }];
    });
  }

  /** Os logins do Bitwarden do site: `bw list items --search <host>`, filtrado pela URI (a senha da listagem é descartada). */
  async function itensBitwarden(bw: string, s: string, host: string): Promise<{ ref: string; titulo: string; usuario: string }[] | "travado"> {
    const r = await executar(bw, ["list", "items", "--search", host], { prazoMs: PRAZO_LISTAR_MS, env: envBw(s) });
    if (r.estourou || /locked|unlock/i.test(r.erro)) return "travado";
    if (r.codigo !== 0) return [];
    return lista(json(r.saida)).flatMap((i) => {
      const login = obj(i.login);
      const id = str(i.id);
      if (!ID_ITEM.test(id) || !lista(login.uris).some((u) => itemCasaComHost(str(u.uri), host))) return [];
      return [{ ref: id, titulo: str(i.name) || host, usuario: str(login.username) }];
    });
  }

  async function ler1Password(ref: string, host: string): Promise<{ usuario: string; senha: string }> {
    const op = await acharOp();
    if (!op) throw new FalhaNavegador("indisponivel", "o 1Password (op) não está instalado " + onde);
    let alvo = ref;
    if (!alvo) {
      // A opção genérica (a lista não veio a tempo no cartão): agora a lista espera o Touch ID com o prazo de ler.
      const itens = await itens1Password(op, host, PRAZO_LER_MS);
      alvo = itens === "travado" ? "" : itens[0]?.ref ?? "";
      if (!alvo) throw new FalhaNavegador("alvo_invalido", "o 1Password não tem um login deste site");
    }
    if (!referenciaValida(alvo)) throw new FalhaNavegador("alvo_invalido", "referência do 1Password inválida");
    const senha = await executar(op, ["read", "--no-newline", alvo], { prazoMs: PRAZO_LER_MS, env: env() });
    if (senha.codigo !== 0 || !senha.saida) throw new FalhaNavegador(/dismiss|cancel|denied|authoriz/i.test(senha.erro) ? "recusado" : "acao_falhou", "o 1Password não liberou o login");
    const usuario = await executar(op, ["read", "--no-newline", refDoUsuario(alvo)], { prazoMs: PRAZO_LER_MS, env: env() });
    return { usuario: usuario.codigo === 0 ? usuario.saida : "", senha: senha.saida };
  }

  async function lerBitwarden(ref: string, host: string): Promise<{ usuario: string; senha: string }> {
    const bw = await acharBw();
    const s = sessao();
    if (!bw) throw new FalhaNavegador("indisponivel", "o Bitwarden (bw) não está instalado " + onde);
    if (!s) throw new FalhaNavegador("recusado", "o Bitwarden está travado " + onde);
    let id = ref;
    if (!id) {
      const itens = await itensBitwarden(bw, s, host);
      if (itens === "travado") throw new FalhaNavegador("recusado", "o Bitwarden está travado " + onde);
      id = itens[0]?.ref ?? "";
    }
    if (!ID_ITEM.test(id)) throw new FalhaNavegador("alvo_invalido", "o Bitwarden não tem um login deste site");
    const senha = await executar(bw, ["get", "password", id], { prazoMs: PRAZO_CURTO_MS, env: envBw(s) });
    if (senha.codigo !== 0 || !senha.saida) throw new FalhaNavegador(/locked/i.test(senha.erro) ? "recusado" : "acao_falhou", "o Bitwarden não liberou o login");
    const usuario = await executar(bw, ["get", "username", id], { prazoMs: PRAZO_CURTO_MS, env: envBw(s) });
    return { usuario: usuario.codigo === 0 ? usuario.saida.replace(/\r?\n$/, "") : "", senha: senha.saida.replace(/\r?\n$/, "") };
  }

  return {
    async listar(host) {
      const [op, bw] = await Promise.all([acharOp(), acharBw()]);
      const s = sessao();
      const [doOp, doBw] = await Promise.all([op ? itens1Password(op, host) : Promise.resolve(null), bw && s ? itensBitwarden(bw, s, host) : Promise.resolve(null)]);
      const opcoes: OpcaoLogin[] = [];
      if (doOp === "travado") opcoes.push({ fonte: "1password", ref: "", rotulo: "Usar o 1Password", disponivel: true });
      else for (const i of doOp ?? []) opcoes.push({ fonte: "1password", ref: i.ref, rotulo: rotuloDoItem(i.titulo, i.usuario), disponivel: true });
      if (bw && (!s || doBw === "travado")) opcoes.push({ fonte: "bitwarden", ref: "", rotulo: "Bitwarden", disponivel: false, motivoIndisponivel: o.plataforma?.bitwardenTravado ?? MOTIVO_BITWARDEN_TRAVADO });
      else for (const i of doBw === "travado" ? [] : doBw ?? []) opcoes.push({ fonte: "bitwarden", ref: i.ref, rotulo: rotuloDoItem(i.titulo, i.usuario), disponivel: true });
      return opcoes.slice(0, OPCOES_MAX);
    },
    ler: (fonte: FonteDoMac, ref: string, host: string) => (fonte === "1password" ? ler1Password(ref, host) : lerBitwarden(ref, host)),
    async guardar(fonte, site, usuario, senha) {
      if (fonte === "1password") {
        const op = await acharOp();
        if (!op) throw new FalhaNavegador("indisponivel", "o 1Password (op) não está instalado " + onde);
        // O modelo do item vai pelo stdin (`-`): a senha nunca entra no argv. TODO(2026-11-20): medir com o op 2.x real.
        const modelo = JSON.stringify({ title: site, category: "LOGIN", urls: [{ href: `https://${site}`, primary: true }], fields: [{ id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: usuario }, { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: senha }] });
        const r = await executar(op, ["item", "create", "--format", "json", "-"], { prazoMs: PRAZO_LER_MS, entrada: modelo, env: env() });
        if (r.codigo !== 0) throw new FalhaNavegador(/dismiss|cancel|denied|authoriz/i.test(r.erro) ? "recusado" : "acao_falhou", "o 1Password não guardou o login");
        return;
      }
      const bw = await acharBw();
      const s = sessao();
      if (!bw) throw new FalhaNavegador("indisponivel", "o Bitwarden (bw) não está instalado " + onde);
      if (!s) throw new FalhaNavegador("recusado", "o Bitwarden está travado " + onde);
      // `bw create item` lê o item codificado do stdin (o que `bw encode` faria: base64 do JSON); nada no argv.
      const item = { type: 1, name: site, login: { username: usuario, password: senha, uris: [{ uri: `https://${site}`, match: null }] } };
      const r = await executar(bw, ["create", "item"], { prazoMs: PRAZO_CURTO_MS, entrada: Buffer.from(JSON.stringify(item), "utf8").toString("base64"), env: envBw(s) });
      if (r.codigo !== 0) throw new FalhaNavegador(/locked/i.test(r.erro) ? "recusado" : "acao_falhou", "o Bitwarden não guardou o login");
    },
    cookiesDoChrome: (host: string): Promise<CookieNavegador[]> => (o.plataforma ? o.plataforma.cookies(host) : cookiesDoChrome({ host, home: o.home, executar, ...(o.security ? { security: o.security } : {}) })),
    touchId: (motivo: string) => o.touchId(motivo),
  };
}

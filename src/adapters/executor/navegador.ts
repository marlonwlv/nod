import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, win32 } from "node:path";
import { FONTES_DO_MAC, MOTIVOS_FALHA_NAVEGADOR, type ComandoNavegadorMaquina, type CookieNavegador, type FonteDoMac, type PedidoCofreDoMac, type ResultadoComandoNavegador } from "../../contracts/navegador-maquina.ts";
import type { OpcaoLogin } from "../../contracts/navegador-do-bot.ts";
import { preencherLogin } from "../navegador/preencher-login.ts";
import { log } from "../../obs/log.ts";
import { ambienteDoSistema, criarMotorAgentBrowser, ehFalhaNavegador, executorPadrao, FalhaNavegador, type ExecutorProcesso, type MotorNavegador } from "../navegador/motor-agent-browser.ts";
import { ehOperacao, executarOperacao } from "../navegador/operacoes-remotas.ts";
import { conectarStreamGlobal, lerJson, relayPadrao, relayPermitido, tipoDaMensagem, TIPOS_DE_ENTRADA_DO_STREAM, TIPOS_DO_STREAM_QUE_SAEM, type StreamDoNavegador } from "../navegador/stream-local.ts";

/**
 * O navegador do bot na máquina da pessoa (ADR-190, decisão 5; ADR-021, a máquina puxa). O app do Mac e o motor do Linux
 * PUXAM os comandos pelo long-poll `navegador/puxar`, rodam cada um no MESMO motor do servidor (`criarMotorAgentBrowser`,
 * o agent-browser 0.43.0 com um perfil cifrado por bot) e postam a resposta em `navegador/resultado`. Nada abre antes do
 * primeiro comando: o Chrome do bot só liga quando o bot usa o navegador, e o daemon do agent-browser morre sozinho com
 * 10 min sem comando (a pausa da ADR-190, decisão 8; o servidor guarda as abas).
 *
 * A vista ao vivo: no comando `assistir`, a máquina liga o stream local do Chrome do bot e abre o WebSocket de saída para
 * o servidor (`vivo`), repassando só `frame`, `tabs` e `status`; o que desce é a entrada da pessoa (`input_*`, ao stream)
 * e o texto/atalho (o relay `POST /api/command`, com `Origin` da mesma porta), conferidos aqui de novo.
 *
 * Servidor sem o navegador (404 na puxada): espera 10 min e tenta de novo, como o computador.
 */

/** O WebSocket de saída da vista, do lado da máquina (a ponte HTTP o abre com o WebSocket global). */
export type SocketDoVivoMaquina = {
  enviar(texto: string): void;
  aoMensagem(fn: (texto: string) => void): void;
  aoFechar(fn: () => void): void;
  fechar(): void;
  /** Bytes na fila de saída (o quadro novo espera quando passa de ATRASO_MAX). */
  atraso(): number;
};

/** O que o laço usa da ponte HTTP (`criarPonteHttp(...).navegador`). */
export type CanalNavegadorDaMaquina = {
  puxar(): Promise<unknown[] | null | "sem_rota">;
  resultado(r: ResultadoComandoNavegador): Promise<boolean>;
  vivo(agenteId: string, token: string): Promise<SocketDoVivoMaquina | null>;
};

/**
 * O que só o app do Mac tem (ADR-177, ADR-190 decisão 6): o 1Password e o Bitwarden da pessoa, os cookies do Chrome dela
 * e o Touch ID. O motor do Linux não passa isto, e os comandos `cofre`, `chrome` e `touch_id` respondem `indisponivel`.
 * Nenhum destes devolve segredo a não ser `ler` (que vai ao servidor pela ponte) e `cookiesDoChrome` (só do site).
 */
export type RecursosDoMac = {
  /** Os itens de login que casam com o host (sem segredo); o que não respondeu a tempo vem como opção genérica. */
  listar(host: string): Promise<OpcaoLogin[]>;
  /** O usuário e a senha do item (`ref` vazio = o primeiro item que casa com `host`). O 1Password pede o Touch ID sozinho. */
  ler(fonte: FonteDoMac, ref: string, host: string): Promise<{ usuario: string; senha: string }>;
  guardar(fonte: FonteDoMac, site: string, usuario: string, senha: string): Promise<void>;
  cookiesDoChrome(host: string): Promise<CookieNavegador[]>;
  /** true = a pessoa confirmou no Touch ID; false = cancelou (ou o Mac não tem Touch ID e ela recusou a senha). */
  touchId(motivo: string): Promise<boolean>;
};

export type OpcoesNavegadorDaMaquina = {
  canal: CanalNavegadorDaMaquina;
  /** Só o app do Mac (desktop/cofres-do-mac.ts). */
  mac?: RecursosDoMac;
  /** O motor desta máquina, criado no primeiro comando (pode falhar com `indisponivel`: Chrome ainda sendo preparado). */
  motor: () => Promise<MotorNavegador>;
  conectarStream?: (porta: number) => Promise<StreamDoNavegador>;
  relay?: (porta: number, comando: Readonly<Record<string, unknown>>) => Promise<boolean>;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
};

const ESPERA_SEM_ROTA_MS = 10 * 60_000;
const ESPERA_SEM_RESPOSTA_MS = 5_000;
/** Respostas guardadas à espera do servidor; além disso, as mais antigas saem (quem esperava já recebeu o prazo). */
const RESPOSTAS_GUARDADAS = 64;
/** Ids já vistos (a mesma puxada repetida não roda duas vezes). */
const VISTOS_MAX = 512;
/** definido em 2026-11-20: o WebSocket com mais que isto na fila não leva o quadro seguinte (pula; vem o mais novo). */
const ATRASO_MAX = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** O comando que veio do servidor, conferido; null = forma estranha (ignorado, sem resposta). */
export function lerComandoNavegador(v: unknown): ComandoNavegadorMaquina | null {
  const c = obj(v);
  if (typeof c.id !== "string" || !UUID.test(c.id) || typeof c.agenteId !== "string" || !UUID.test(c.agenteId) || typeof c.prazoEm !== "number") return null;
  const base = { id: c.id, agenteId: c.agenteId, prazoEm: c.prazoEm };
  if (c.tipo === "motor" && ehOperacao(c.operacao) && Array.isArray(c.args) && c.args.length <= 8) return { ...base, tipo: "motor", operacao: c.operacao, args: c.args };
  if (c.tipo === "assistir" && typeof c.token === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(c.token)) return { ...base, tipo: "assistir", token: c.token };
  if (c.tipo === "cofre") { const pedido = lerPedidoCofre(c.pedido); return pedido ? { ...base, tipo: "cofre", pedido } : null; }
  if (c.tipo === "chrome" && typeof c.host === "string" && HOST.test(c.host)) return { ...base, tipo: "chrome", host: c.host, aplicar: c.aplicar === true };
  if (c.tipo === "touch_id" && typeof c.motivo === "string" && c.motivo.length >= 1 && c.motivo.length <= 200) return { ...base, tipo: "touch_id", motivo: c.motivo };
  return null;
}

const HOST = /^[a-z0-9.-]{1,253}$/;
const ehFonte = (v: unknown): v is FonteDoMac => typeof v === "string" && (FONTES_DO_MAC as readonly string[]).includes(v);
const ehTexto = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
/** O pedido ao cofre do Mac, conferido (a referência vai ao `op`/`bw` só como argumento de `execFile`, sem shell). */
function lerPedidoCofre(v: unknown): PedidoCofreDoMac | null {
  const p = obj(v);
  if (p.operacao === "listar") return typeof p.host === "string" && HOST.test(p.host) ? { operacao: "listar", host: p.host } : null;
  if ((p.operacao === "preencher" || p.operacao === "ler") && ehFonte(p.fonte) && ehTexto(p.ref, 300) && typeof p.host === "string" && HOST.test(p.host)) return { operacao: p.operacao, fonte: p.fonte, ref: p.ref, host: p.host };
  if (p.operacao === "guardar" && ehFonte(p.fonte) && typeof p.site === "string" && HOST.test(p.site) && ehTexto(p.usuario, 320) && ehTexto(p.senha, 4096) && p.senha !== "") return { operacao: "guardar", fonte: p.fonte, site: p.site, usuario: p.usuario, senha: p.senha };
  return null;
}

function falha(id: string, e: unknown): ResultadoComandoNavegador {
  if (ehFalhaNavegador(e)) return { id, ok: false, motivo: e.motivo, detalhe: e.detalhe };
  return { id, ok: false, motivo: "acao_falhou", detalhe: "falhou nesta máquina" };
}

export type NavegadorDaMaquina = { parar(): void; /** Só testes: vistas abertas agora. */ vivos(): number };

export function iniciarNavegadorDaMaquina(o: OpcoesNavegadorDaMaquina): NavegadorDaMaquina {
  const agora = o.agora ?? (() => Date.now());
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  const conectarStream = o.conectarStream ?? ((porta: number) => conectarStreamGlobal(porta));
  const relay = o.relay ?? relayPadrao;
  let parado = false;
  const guardadas: ResultadoComandoNavegador[] = [];
  const vistos = new Set<string>();
  /** Os comandos de um bot em ordem (o agent-browser serializa a sessão; bots diferentes andam juntos). */
  const filas = new Map<string, Promise<void>>();
  const vivos = new Map<string, { fechar(): void }>();

  async function responder(r: ResultadoComandoNavegador): Promise<void> {
    if (await o.canal.resultado(r).catch(() => false)) return;
    guardadas.push(r);
    while (guardadas.length > RESPOSTAS_GUARDADAS) guardadas.shift();
  }
  async function reenviar(): Promise<void> {
    for (const r of guardadas.splice(0)) await responder(r);
  }

  async function abrirVivo(c: Extract<ComandoNavegadorMaquina, { tipo: "assistir" }>): Promise<ResultadoComandoNavegador> {
    const motor = await o.motor();
    const porta = await motor.portaDoStream({ agenteId: c.agenteId });
    if (porta === null) throw new FalhaNavegador("indisponivel", "o navegador do bot não está aberto nesta máquina");
    const local = await conectarStream(porta);
    const ws = await o.canal.vivo(c.agenteId, c.token).catch(() => null);
    if (!ws) { local.fechar(); throw new FalhaNavegador("indisponivel", "não consegui abrir a vista com o servidor"); }
    vivos.get(c.agenteId)?.fechar();
    let aberto = true;
    const fechar = () => {
      if (!aberto) return;
      aberto = false;
      if (vivos.get(c.agenteId)?.fechar === fechar) vivos.delete(c.agenteId);
      local.fechar();
      ws.fechar();
    };
    vivos.set(c.agenteId, { fechar });
    local.aoMensagem((texto) => {
      const tipo = tipoDaMensagem(texto);
      if (!aberto || !tipo || !TIPOS_DO_STREAM_QUE_SAEM.has(tipo)) return;
      if (tipo === "frame" && ws.atraso() > ATRASO_MAX) return;
      ws.enviar(texto);
    });
    ws.aoMensagem((texto) => {
      const m = lerJson(texto);
      if (!aberto || !m) return;
      if (m.t === "entrada") {
        const e = obj(m.mensagem);
        if (typeof e.type === "string" && TIPOS_DE_ENTRADA_DO_STREAM.has(e.type)) local.enviar(e);
        return;
      }
      if (m.t === "relay" && typeof m.id === "number" && Number.isSafeInteger(m.id)) {
        const id = m.id;
        const ok = relayPermitido(m.comando) ? relay(porta, m.comando).catch(() => false) : Promise.resolve(false);
        void ok.then((v) => { if (aberto) ws.enviar(JSON.stringify({ t: "relay", id, ok: v })); });
      }
    });
    local.aoFechar(fechar);
    ws.aoFechar(fechar);
    return { id: c.id, ok: true };
  }

  function exigirMac(): RecursosDoMac {
    if (!o.mac) throw new FalhaNavegador("indisponivel", "esta máquina não tem os cofres nem o Chrome da pessoa");
    return o.mac;
  }

  /**
   * Os comandos que só o Mac atende (L1, L2, L5, A1). O segredo que `preencher` lê vai direto para o navegador do bot
   * desta máquina e some; só `ler` o devolve, e só pela resposta à ponte.
   */
  async function doMac(c: Exclude<ComandoNavegadorMaquina, { tipo: "motor" | "assistir" }>): Promise<unknown> {
    const mac = exigirMac();
    const s = { agenteId: c.agenteId };
    if (c.tipo === "touch_id") {
      if (!(await mac.touchId(c.motivo))) throw new FalhaNavegador("recusado", "a pessoa não confirmou no Touch ID");
      return { confirmado: true };
    }
    if (c.tipo === "chrome") {
      const cookies = await mac.cookiesDoChrome(c.host);
      if (!c.aplicar) return { cookies };
      const motor = await o.motor();
      await motor.definirCookies(s, cookies);
      if (cookies.length) await motor.historico(s, "recarregar");
      return { quantos: cookies.length };
    }
    const p = c.pedido;
    if (p.operacao === "listar") return { opcoes: await mac.listar(p.host) };
    if (p.operacao === "guardar") { await mac.guardar(p.fonte, p.site, p.usuario, p.senha); return { guardado: true }; }
    const cred = await mac.ler(p.fonte, p.ref, p.host);
    if (p.operacao === "ler") return cred;
    return await preencherLogin(await o.motor(), s, cred);
  }

  async function rodar(c: ComandoNavegadorMaquina): Promise<void> {
    if (c.prazoEm <= agora()) return;
    let r: ResultadoComandoNavegador;
    try {
      if (c.tipo === "assistir") r = await abrirVivo(c);
      else if (c.tipo !== "motor") {
        const valor = await doMac(c);
        r = { id: c.id, ok: true, ...(valor === undefined ? {} : { valor }) };
      } else {
        const valor = await executarOperacao(await o.motor(), { agenteId: c.agenteId }, c.operacao, c.args);
        r = { id: c.id, ok: true, ...(valor === undefined ? {} : { valor }) };
      }
    } catch (e) {
      r = falha(c.id, e);
      if (!ehFalhaNavegador(e)) log("aviso", "navegador_maquina_erro", { tipo: c.tipo, erro: e instanceof Error ? e.name : "desconhecido" });
    }
    if (!r.ok && !(MOTIVOS_FALHA_NAVEGADOR as readonly string[]).includes(r.motivo)) r = { id: c.id, ok: false, motivo: "acao_falhou", detalhe: r.detalhe };
    await responder(r);
  }

  function enfileirar(c: ComandoNavegadorMaquina): void {
    if (vistos.has(c.id)) return;
    vistos.add(c.id);
    if (vistos.size > VISTOS_MAX) vistos.delete(vistos.values().next().value!);
    // A vista não segura os comandos do bot (ela fica aberta enquanto a pessoa assiste), nem o que só espera a pessoa no
    // Mac (o Touch ID, a lista do cofre): só o que mexe no navegador do bot entra na fila dele.
    const mexeNoNavegador = c.tipo === "motor" || (c.tipo === "chrome" && c.aplicar) || (c.tipo === "cofre" && c.pedido.operacao === "preencher");
    if (!mexeNoNavegador) { void rodar(c); return; }
    const antes = filas.get(c.agenteId) ?? Promise.resolve();
    const agoraVai = antes.then(() => rodar(c));
    filas.set(c.agenteId, agoraVai);
    void agoraVai.finally(() => { if (filas.get(c.agenteId) === agoraVai) filas.delete(c.agenteId); });
  }

  void (async () => {
    while (!parado) {
      const r = await o.canal.puxar().catch(() => null);
      if (parado) break;
      if (r === "sem_rota") { await dormir(ESPERA_SEM_ROTA_MS); continue; }
      if (r === null) { await dormir(ESPERA_SEM_RESPOSTA_MS); continue; }
      await reenviar();
      for (const cru of r) {
        const c = lerComandoNavegador(cru);
        if (c) enfileirar(c);
        else log("aviso", "navegador_comando_invalido", {});
      }
    }
  })();

  return {
    parar() {
      parado = true;
      for (const v of [...vivos.values()]) v.fechar();
      vivos.clear();
    },
    vivos: () => vivos.size,
  };
}

/** A chave desta máquina para cifrar o estado dos perfis (32 bytes, criada uma vez, 0600). Nunca vai ao servidor. */
export async function segredoDaMaquina(pasta: string): Promise<Buffer> {
  const arquivo = join(pasta, "segredo");
  const lida = await readFile(arquivo).catch(() => null);
  if (lida && lida.length === 32) return lida;
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const nova = randomBytes(32);
  await writeFile(arquivo, nova, { mode: 0o600, flag: lida ? "w" : "wx" }).catch(async (e: unknown) => {
    // Outro processo criou ao mesmo tempo: vale o dele.
    if ((e as { code?: string }).code !== "EEXIST") throw e;
  });
  await chmod(arquivo, 0o600).catch(() => undefined);
  const final = await readFile(arquivo);
  if (final.length !== 32) throw new FalhaNavegador("indisponivel", "a chave do navegador nesta máquina está corrompida");
  return final;
}

/**
 * definido em 2026-11-20 (ADR-190): o Chrome do bot no Mac é o Google Chrome do sistema quando existe (assinado e
 * atualizado pelo Google, nada a baixar), sempre com o perfil próprio de cada bot na pasta do app — nunca o perfil da
 * pessoa. Sem ele, o Chrome for Testing que o `agent-browser install` baixa na primeira vez para a pasta do agent-browser
 * no HOME (null aqui = o agent-browser acha o que ele instalou).
 */
export function chromeDoMac(home: string, existe: (p: string) => boolean = existsSync): string | null {
  const nome = "Google Chrome.app/Contents/MacOS/Google Chrome";
  return [join("/Applications", nome), join(home, "Applications", nome)].find(existe) ?? null;
}

/**
 * definido em 2026-11-20: no Linux (motor), `NOD_NAVEGADOR_CHROME`; senão o Chromium do Playwright que a instalação do
 * computador já pôs em /opt/nod-motor/chromium (com as bibliotecas do sistema); senão um Chrome/Chromium do PATH; senão
 * null (o `agent-browser install`, sem as bibliotecas do sistema: a instalação do motor cuida delas).
 */
export function chromeDoLinux(env: Readonly<Record<string, string | undefined>>, existe: (p: string) => boolean = existsSync, listar: (p: string) => string[] = (p) => { try { return readdirSync(p); } catch { return []; } }): string | null {
  if (env.NOD_NAVEGADOR_CHROME && existe(env.NOD_NAVEGADOR_CHROME)) return env.NOD_NAVEGADOR_CHROME;
  const base = "/opt/nod-motor/chromium";
  for (const d of listar(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    for (const sub of ["chrome-linux64", "chrome-linux"]) {
      const c = join(base, d, sub, "chrome");
      if (existe(c)) return c;
    }
  }
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const nome of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      const c = join(dir, nome);
      if (existe(c)) return c;
    }
  }
  return null;
}

/**
 * O binário do agent-browser no motor do Linux: `NOD_AGENT_BROWSER`, senão o que a instalação do motor pôs em
 * /opt/nod-motor/navegador (npm, `agent-browser@0.43.0`), senão um `agent-browser` do PATH.
 */
export function agentBrowserDoLinux(env: Readonly<Record<string, string | undefined>>, arch: string, existe: (p: string) => boolean = existsSync): string | null {
  if (env.NOD_AGENT_BROWSER && existe(env.NOD_AGENT_BROWSER)) return env.NOD_AGENT_BROWSER;
  const pacote = arch === "arm64" ? "cli-linux-arm64-gnu" : "cli-linux-x64-gnu";
  const instalado = join("/opt/nod-motor/navegador/node_modules/@agent-browser", pacote, "bin", "agent-browser");
  if (existe(instalado)) return instalado;
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const c = join(dir, "agent-browser");
    if (existe(c)) return c;
  }
  return null;
}

/**
 * 2026-11-22 (o navegador no PC): o Chrome do bot no Windows é o Google Chrome do sistema (por máquina ou só do usuário);
 * sem ele, o Microsoft Edge, que todo Windows 10/11 tem e é Chromium (o agent-browser o dirige igual); sem os dois, null
 * (o `agent-browser install` baixa o Chrome for Testing). Sempre com o perfil próprio de cada bot, nunca o da pessoa.
 */
export function chromeDoWindows(env: Readonly<Record<string, string | undefined>>, existe: (p: string) => boolean = existsSync): string | null {
  const w = win32.join;
  const chrome = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"].flatMap((v) => (env[v] ? [w(env[v]!, "Google", "Chrome", "Application", "chrome.exe")] : []));
  const edge = ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"].flatMap((v) => (env[v] ? [w(env[v]!, "Microsoft", "Edge", "Application", "msedge.exe")] : []));
  return [...chrome, ...edge].find(existe) ?? null;
}

/**
 * O agent-browser do motor no Windows: `NOD_AGENT_BROWSER`, senão o que a instalação pôs em `<pasta do nod>\navegador`
 * (`irm …/windows | iex`, InstalarNavegador; a pasta vem de NOD_INSTALADO_EM ou, sem ela, das duas acima do motor), senão
 * um `agent-browser.exe` do PATH.
 */
export function agentBrowserDoWindows(env: Readonly<Record<string, string | undefined>>, pastaDoMotor: string | null, existe: (p: string) => boolean = existsSync): string | null {
  const w = win32.join;
  if (env.NOD_AGENT_BROWSER && existe(env.NOD_AGENT_BROWSER)) return env.NOD_AGENT_BROWSER;
  const raizes = [env.NOD_INSTALADO_EM, env.NOD_PASTA, pastaDoMotor ? w(pastaDoMotor, "..", "..") : null, env.LOCALAPPDATA ? w(env.LOCALAPPDATA, "nod") : null].filter((r): r is string => !!r);
  for (const r of raizes) {
    const c = w(r, "navegador", "node_modules", "@agent-browser", "cli-win32-x64-msvc", "bin", "agent-browser.exe");
    if (existe(c)) return c;
  }
  for (const dir of (env.PATH ?? env.Path ?? "").split(";").filter(Boolean)) {
    const c = w(dir, "agent-browser.exe");
    if (existe(c)) return c;
  }
  return null;
}

/** A versão fixa do agent-browser (a mesma de AGENT_BROWSER_DO_MOTOR em motor-instalacao.ts; um teste confere). */
export const AGENT_BROWSER_DA_MAQUINA = "0.43.0";
/** definido em 2026-11-22: o npm baixa o agent-browser (~10 MB) em até 5 min numa rede lenta. */
const PRAZO_NPM_MS = 5 * 60_000;

/**
 * 2026-11-22 (o navegador no PC): o PC que já tinha o motor recebe o motor novo pela atualização automática, mas não roda
 * o instalador de novo — o agent-browser não estaria lá. O motor o instala sozinho na primeira vez que o bot usa o
 * navegador, com o npm do Node portátil do nod (o node.exe que roda o motor), na mesma pasta do instalador
 * (`<pasta do nod>\navegador`), sem os scripts do npm. Uma tentativa por processo; falhou, o bot ouve "indisponível".
 */
export function agentBrowserNoWindows(o: { env: Readonly<Record<string, string | undefined>>; pastaDoMotor: string; nodeExe?: string; executor?: ExecutorProcesso; existe?: (p: string) => boolean }): () => Promise<string | null> {
  let tentativa: Promise<string | null> | null = null;
  const existe = o.existe ?? existsSync;
  return () => {
    const achado = agentBrowserDoWindows(o.env, o.pastaDoMotor, existe);
    if (achado) return Promise.resolve(achado);
    tentativa ??= (async () => {
      const node = o.nodeExe ?? process.execPath;
      const npm = win32.join(win32.dirname(node), "node_modules", "npm", "bin", "npm-cli.js");
      const raiz = o.env.NOD_INSTALADO_EM ?? o.env.NOD_PASTA ?? win32.join(o.pastaDoMotor, "..", "..");
      const pasta = win32.join(raiz, "navegador");
      if (!existe(npm)) { log("aviso", "navegador_sem_npm", {}); return null; }
      await mkdir(pasta, { recursive: true });
      if (!existe(win32.join(pasta, "package.json"))) await writeFile(win32.join(pasta, "package.json"), '{"name":"nod-navegador","private":true}\n');
      const r = await (o.executor ?? executorPadrao)({ bin: node, args: [npm, "install", "--prefix", pasta, "--no-fund", "--no-audit", "--ignore-scripts", "--loglevel=error", `agent-browser@${AGENT_BROWSER_DA_MAQUINA}`], env: { ...ambienteDoSistema(o.env, "win32"), PATH: o.env.PATH ?? o.env.Path ?? "" }, prazoMs: PRAZO_NPM_MS, limiteSaida: 1024 * 1024 });
      if (r.codigo !== 0 || r.estourou) log("aviso", "navegador_agent_browser_nao_instalou", { codigo: r.codigo, estourou: r.estourou });
      return agentBrowserDoWindows(o.env, o.pastaDoMotor, existe);
    })();
    return tentativa;
  };
}

/** definido em 2026-11-20: o `agent-browser install` baixa o Chrome for Testing (~150 MB); 10 min cobre uma rede lenta. */
const PRAZO_INSTALAR_MS = 10 * 60_000;

/**
 * O motor desta máquina, criado no primeiro comando. Sem Chrome (nem o do sistema nem um já instalado), começa o
 * `agent-browser install` em segundo plano e responde `indisponivel` com a frase para o bot ("tente em 2 min") até
 * terminar; a marca `chrome-instalado` na pasta evita repetir nas próximas aberturas.
 */
export function motorDaMaquina(o: { dados: string; binario: string | null | (() => Promise<string | null>); chrome: () => string | null; executor?: ExecutorProcesso; env?: Readonly<Record<string, string | undefined>>; plataforma?: string }): () => Promise<MotorNavegador> {
  let motor: MotorNavegador | null = null;
  let instalando: Promise<boolean> | null = null;
  let falhouAInstalar = false;
  const executor = o.executor ?? executorPadrao;
  const marca = join(o.dados, "chrome-instalado");
  return async () => {
    if (motor) return motor;
    // O binário pode vir de uma função (o motor do Windows instala o agent-browser sozinho na primeira vez).
    if (typeof o.binario === "function") o.binario = await o.binario();
    if (!o.binario) throw new FalhaNavegador("indisponivel", "o agent-browser não está instalado nesta máquina (atualize o app do nod)");
    const chrome = o.chrome();
    if (!chrome && !existsSync(marca)) {
      if (falhouAInstalar) throw new FalhaNavegador("indisponivel", "não consegui instalar o Chrome nesta máquina");
      instalando ??= (async () => {
        await mkdir(o.dados, { recursive: true, mode: 0o700 });
        const env = o.env ?? process.env;
        const r = await executor({ bin: o.binario as string, args: ["install"], env: { ...ambienteDoSistema(env, o.plataforma ?? process.platform), PATH: env.PATH ?? "/usr/bin:/bin", HOME: env.HOME ?? env.USERPROFILE ?? o.dados, AGENT_BROWSER_NO_VERSION_CHECK: "1" }, prazoMs: PRAZO_INSTALAR_MS, limiteSaida: 1024 * 1024 });
        const ok = r.codigo === 0 && !r.estourou;
        if (ok) await writeFile(marca, "agent-browser install\n");
        else { falhouAInstalar = true; log("aviso", "navegador_chrome_nao_instalou", { codigo: r.codigo, estourou: r.estourou }); }
        return ok;
      })().finally(() => { instalando = null; });
      throw new FalhaNavegador("indisponivel", "estou preparando o Chrome nesta máquina pela primeira vez (alguns minutos); tente de novo em 2 minutos");
    }
    motor = criarMotorAgentBrowser({ dados: o.dados, segredo: await segredoDaMaquina(o.dados), binario: o.binario as string, chrome, ...(o.executor ? { executor: o.executor } : {}) });
    return motor;
  };
}

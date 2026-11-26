import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppDoComputador, PedidoSeuComputador, RespostaSeuComputador } from "../../contracts/seu-computador.ts";
import { acharApp, manifestoBounded, mesmoApp, motivoDoBloqueio, type PlataformaPessoa } from "../../domain/seu-computador.ts";
import type { AppLocal } from "./apps-locais.ts";

/**
 * O cua-driver na máquina da pessoa (ADR-197, item 2): um daemon `serve --embedded` por geração, filho do processo do
 * nod (no Mac, o próprio app: o macOS atribui Acessibilidade e Gravação de Tela ao nod; no Windows, o motor na sessão
 * interativa), em modo `bounded` com o manifesto dos apps liberados, e o proxy `mcp --embedded` para falar com ele.
 *
 * - O manifesto só cresce enquanto o daemon vive (união dos apps dos bots que pediram); a checagem por bot é daqui:
 *   o app do comando tem de estar na lista DAQUELE bot, senão volta `precisa_liberar` sem tocar no driver.
 * - `--parent-liveness-stdio`: o daemon morre com o processo do nod; ocioso por OCIOSO_MS, desligamos.
 * - Telemetria e atualização do driver desligadas; o estado dele fica numa pasta do nod (`CUA_DRIVER_RS_HOME`).
 */

/** A caixa da janela na tela, em pontos (origem no canto de cima à esquerda da tela principal). */
export type CaixaDaJanela = { x: number; y: number; largura: number; altura: number };
export type Atividade = { agenteId: string; bot: string; app: string; acao: string; em: number; /** A janela que o bot usa (a borda âmbar); null = ainda não se sabe. */ janela: CaixaDaJanela | null };

export type OpcoesSeuComputadorLocal = {
  plataforma: PlataformaPessoa;
  /** O executável do cua-driver (no app do Mac, em Resources; no Windows, baixado pelo motor). null = indisponível. */
  binario: () => Promise<string | null>;
  /** Pasta do nod para o manifesto e o estado do driver. */
  pasta: string;
  /** O id do app hospedeiro (só rótulo no `check_permissions`). */
  bundleDoHost?: string;
  listarApps: () => Promise<AppLocal[]>;
  /** A cada ação (a ilha do app: "Ada está usando seu Mac · Numbers · Parar"). */
  aoAtividade?: (a: Atividade) => void;
  spawnar?: typeof spawn;
  /**
   * ADR-197, item 6 (S2): a pessoa está mexendo neste app agora? `naFrente` = o app é o da frente; `ociosoS` = segundos
   * desde a última tecla ou mouse da pessoa. Ausente (Windows, fase 1) = nunca pausa.
   */
  pessoa?: { naFrente(appId: string): Promise<boolean>; ociosoS(): number };
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
  /** definido em 2026-11-26: sem ação por 10 min, o daemon sai (o próximo comando sobe outro em ~1 s). */
  ociosoMs?: number;
};

export type SeuComputadorLocal = {
  executar(agenteId: string, pedido: PedidoSeuComputador): Promise<RespostaSeuComputador>;
  /** Parar (ilha, barra de menus, bloqueio de tela): derruba o driver na hora e recusa por `pausaMs`. */
  parar(pausaMs?: number): Promise<void>;
  /** Desliga sem pausar (o app saindo). */
  desligar(): Promise<void>;
};

const OCIOSO_MS = 10 * 60_000;
/** definido em 2026-11-26 (S2): a pessoa mexeu no app há menos disto = o bot pausa; volta depois de RETOMA_S parada. */
export const MEXEU_S = 2;
export const RETOMA_S = 10;
/** Espera no máximo isto pela pessoa; depois o bot recebe "ela está usando o app" e decide (espera ou pergunta). */
export const ESPERA_PESSOA_MS = 60_000;
/** definido em 2026-11-26: no Windows a 1ª execução do binário novo passa pela varredura do antivírus (medido 11–16 s na CI). */
const PRAZO_SUBIR_MS = 15_000;
const PRAZO_SUBIR_WINDOWS_MS = 45_000;
const PRAZO_CHAMADA_MS = 60_000;
const CACHE_APPS_MS = 5_000;

type Geracao = { daemon: ChildProcess; mcp: ChildProcess; socket: string; dir: string | null; apps: Map<string, AppDoComputador>; chamar: (nome: string, args: Record<string, unknown>) => Promise<ResultadoDriver>; vivo: boolean };
export type ResultadoDriver = { texto: string; estruturado: Record<string, unknown> | null; imagem: { mimeType: string; data: string } | null; erro: boolean };

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Uma resposta `tools/call` do MCP do driver → texto, o JSON estruturado e a imagem (se houver). */
export function lerResultadoDriver(result: unknown): ResultadoDriver {
  const r = obj(result);
  const conteudo = Array.isArray(r.content) ? r.content : [];
  const textos: string[] = [];
  let imagem: ResultadoDriver["imagem"] = null;
  for (const c of conteudo) {
    const o = obj(c);
    if (o.type === "text" && typeof o.text === "string") textos.push(o.text);
    else if (o.type === "image" && typeof o.data === "string" && typeof o.mimeType === "string" && !imagem) imagem = { mimeType: o.mimeType, data: o.data };
  }
  const estruturado = r.structuredContent && typeof r.structuredContent === "object" ? obj(r.structuredContent) : null;
  const recusado = estruturado?.status === "refused";
  return { texto: textos.join("\n"), estruturado, imagem, erro: r.isError === true || recusado };
}

/** O efeito que o driver relata (ADR-197, item 10): confirmado, sem prova ou suspeita de que nada mudou. */
export function efeitoDoResultado(r: ResultadoDriver): "confirmado" | "sem_prova" | "sem_efeito" | undefined {
  const s = JSON.stringify(r.estruturado ?? {}) + r.texto;
  if (/suspected_noop/.test(s)) return "sem_efeito";
  if (/\bconfirmed\b/.test(s)) return "confirmado";
  if (/\bunverifiable\b/.test(s)) return "sem_prova";
  return undefined;
}

/** A caixa de uma janela numa resposta de `list_windows` (bounds/frame com x/y ou left/top). */
export function caixaDaJanela(estruturado: Record<string, unknown> | null, id: number): CaixaDaJanela | null {
  const janelas = Array.isArray(estruturado?.windows) ? estruturado!.windows.map(obj) : [];
  const j = janelas.find((w) => w.window_id === id || w.id === id);
  if (!j) return null;
  const b = obj(j.bounds ?? j.frame);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const x = n(b.x ?? b.left), y = n(b.y ?? b.top), largura = n(b.width ?? b.w), altura = n(b.height ?? b.h);
  return x !== null && y !== null && largura && altura && largura > 40 && altura > 40 ? { x, y, largura, altura } : null;
}

/** A digitação em segundo plano não chegou ao campo (o driver confere o valor e diz). */
export function entregaNaoChegou(r: ResultadoDriver): boolean {
  return /did not contain the requested text|delivery was incomplete|Retry with delivery_mode:"foreground"/i.test(r.texto);
}

/** O driver recusou (ou leu vazio) porque a tela está bloqueada ou no descanso de tela. */
export function telaBloqueada(r: ResultadoDriver): boolean {
  return /screen_locked/.test(r.texto) || r.estruturado?.degraded_reason === "screen_locked" || JSON.stringify(r.estruturado ?? {}).includes("\"screen_locked\"");
}

/** A janela principal do app numa resposta de `list_windows` (a maior na tela; senão a primeira). */
export function escolherJanela(estruturado: Record<string, unknown> | null): number | null {
  const janelas = Array.isArray(estruturado?.windows) ? estruturado!.windows.map(obj) : [];
  const comId = janelas.map((j) => ({ j, id: typeof j.window_id === "number" ? j.window_id : typeof j.id === "number" ? j.id : null })).filter((x) => x.id !== null);
  if (!comId.length) return null;
  const area = (j: Record<string, unknown>) => {
    const b = obj(j.bounds ?? j.frame);
    const w = Number(b.width ?? b.w ?? 0), h = Number(b.height ?? b.h ?? 0);
    return Number.isFinite(w * h) ? w * h : 0;
  };
  const naTela = comId.filter((x) => x.j.is_on_screen !== false && x.j.on_screen !== false && Number(x.j.layer ?? 0) === 0);
  const base = naTela.length ? naTela : comId;
  return [...base].sort((a, b) => area(b.j) - area(a.j))[0]!.id;
}

const TECLAS_MODIFICADORAS: Record<string, string> = { cmd: "cmd", shift: "shift", option: "option", alt: "alt", ctrl: "ctrl", win: "cmd", fn: "fn" };
const DIRECAO: Record<string, string> = { cima: "up", baixo: "down", esquerda: "left", direita: "right" };

/** Cliente JSON-RPC por linhas sobre o stdio do `cua-driver mcp`. */
function clienteMcp(proc: ChildProcess): (metodo: string, params: unknown, prazoMs: number) => Promise<unknown> {
  let buf = "";
  let proximo = 0;
  const pendentes = new Map<number, { resolver: (v: unknown) => void; rejeitar: (e: Error) => void; relogio: ReturnType<typeof setTimeout> }>();
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const linha = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m: Record<string, unknown>;
      try { m = obj(JSON.parse(linha)); } catch { continue; }
      if (typeof m.id !== "number") continue;
      const p = pendentes.get(m.id);
      if (!p) continue;
      pendentes.delete(m.id);
      clearTimeout(p.relogio);
      if (m.error) p.rejeitar(new Error(`mcp: ${String(obj(m.error).message ?? "erro")}`));
      else p.resolver(m.result);
    }
  });
  const falharTodos = () => { for (const [id, p] of pendentes) { pendentes.delete(id); clearTimeout(p.relogio); p.rejeitar(new Error("driver saiu")); } };
  proc.on("exit", falharTodos);
  proc.on("error", falharTodos);
  return (metodo, params, prazoMs) => new Promise((resolver, rejeitar) => {
    const id = ++proximo;
    const relogio = setTimeout(() => { pendentes.delete(id); rejeitar(new Error("driver sem resposta")); }, prazoMs);
    relogio.unref?.();
    pendentes.set(id, { resolver, rejeitar, relogio });
    proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: metodo, params })}\n`);
  });
}

export function criarSeuComputadorLocal(o: OpcoesSeuComputadorLocal): SeuComputadorLocal {
  const agora = o.agora ?? (() => Date.now());
  const spawnar = o.spawnar ?? spawn;
  const ocioso = o.ociosoMs ?? OCIOSO_MS;
  let geracao: Geracao | null = null;
  let subindo: Promise<Geracao> | null = null;
  let pausadoAte = 0;
  let relogioOcioso: ReturnType<typeof setTimeout> | null = null;
  let cacheApps: { em: number; apps: AppLocal[] } | null = null;
  let fila: Promise<unknown> = Promise.resolve();
  const sessoes = new Set<string>();
  // Medido na CI em 2026-11-26: o get_window_state do Windows (0.62.1) não aceita screenshot_format/quality (devolve PNG).
  const jpeg = (qualidade: number): Record<string, unknown> => (o.plataforma === "darwin" ? { screenshot_format: "jpeg", screenshot_quality: qualidade } : {});
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  async function mexendoAgora(appId: string): Promise<boolean> {
    if (!o.pessoa || o.pessoa.ociosoS() >= MEXEU_S) return false;
    return o.pessoa.naFrente(appId).catch(() => false);
  }
  let ultimaCaixa: CaixaDaJanela | null = null;

  async function apps(forcar = false): Promise<AppLocal[]> {
    if (!forcar && cacheApps && agora() - cacheApps.em < CACHE_APPS_MS) return cacheApps.apps;
    const lista = await o.listarApps();
    cacheApps = { em: agora(), apps: lista };
    return lista;
  }

  function ambiente(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      CUA_DRIVER_EMBEDDED: "1",
      ...(o.bundleDoHost ? { CUA_DRIVER_HOST_BUNDLE_ID: o.bundleDoHost } : {}),
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
      CUA_TELEMETRY_ENABLED: "0",
      CUA_DRIVER_RS_UPDATE_CHECK: "0",
      CUA_DRIVER_RS_HOME: join(o.pasta, "driver"),
      // A ação devolve em até 300 ms quando nada abre; o resto do vigia segue sozinho (padrão do driver).
    };
  }

  function matar(g: Geracao | null): void {
    if (!g) return;
    g.vivo = false;
    try { g.mcp.kill(); } catch { /* já saiu */ }
    try { g.daemon.stdin?.end(); g.daemon.kill(); } catch { /* já saiu */ }
    if (g.dir) rmSync(g.dir, { recursive: true, force: true });
    sessoes.clear();
  }

  /**
   * O daemon está pronto quando diz "listening on" (na saída padrão ou de erro). Medido na CI em 2026-11-26: no Windows o
   * `existsSync` do named pipe não é confiável (ora via em 11 s, ora nunca); a frase do próprio driver vale nos dois.
   * O Unix confere também o arquivo do socket. As últimas linhas do driver vão no erro.
   */
  function esperarSocket(socket: string, daemon: ChildProcess): Promise<void> {
    const prazo = o.plataforma === "win32" ? PRAZO_SUBIR_WINDOWS_MS : PRAZO_SUBIR_MS;
    return new Promise((resolver, rejeitar) => {
      const linhas: string[] = [];
      let feito = false;
      const fim = (e?: Error) => {
        if (feito) return;
        feito = true;
        clearTimeout(relogio);
        clearInterval(olhar);
        if (e) rejeitar(e); else resolver();
      };
      const ouvir = (d: Buffer | string) => {
        const texto = String(d);
        for (const l of texto.split(/\r?\n/)) if (l.trim()) { linhas.push(l.trim().slice(0, 200)); if (linhas.length > 5) linhas.shift(); }
        if (/listening on/i.test(texto)) fim();
      };
      daemon.stdout?.on("data", ouvir);
      daemon.stderr?.on("data", ouvir);
      daemon.once("exit", (codigo) => fim(new Error(`o driver saiu ao subir (código ${String(codigo)}): ${linhas.join(" | ")}`)));
      daemon.once("error", (e) => fim(e));
      const olhar = setInterval(() => { if (o.plataforma !== "win32" && existsSync(socket)) fim(); }, 100);
      const relogio = setTimeout(() => fim(new Error(`o driver não subiu a tempo: ${linhas.join(" | ") || "sem saída"}`)), prazo);
      relogio.unref?.();
    });
  }

  async function subir(appsDoManifesto: Map<string, AppDoComputador>): Promise<Geracao> {
    const binario = await o.binario();
    if (!binario) throw new ErroIndisponivel("O controle do computador ainda não está instalado neste aparelho (atualize o nod).");
    mkdirSync(join(o.pasta, "driver"), { recursive: true, mode: 0o700 });
    const manifesto = join(o.pasta, "manifesto.yaml");
    writeFileSync(manifesto, manifestoBounded([...appsDoManifesto.values()], o.plataforma), { mode: 0o600 });
    let dir: string | null = null;
    let socket: string;
    if (o.plataforma === "win32") socket = `\\\\.\\pipe\\nod-cua-${randomBytes(12).toString("hex")}`;
    else { dir = mkdtempSync(join(tmpdir(), "nod-cua-")); socket = join(dir, "d.sock"); }
    const env = ambiente();
    const daemon = spawnar(binario, ["serve", "--embedded", "--parent-liveness-stdio", "--no-permissions-gate", "--socket", socket, "--permission-mode", "bounded", "--capability-manifest", manifesto, "--approve-capability-manifest", ...(o.bundleDoHost ? ["--host-bundle-id", o.bundleDoHost] : [])], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    try { await esperarSocket(socket, daemon); } catch (e) { try { daemon.kill(); } catch { /* */ } if (dir) rmSync(dir, { recursive: true, force: true }); throw e; }
    const mcp = spawnar(binario, ["mcp", "--embedded", "--socket", socket], { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const req = clienteMcp(mcp);
    await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nod", version: "1" } }, o.plataforma === "win32" ? PRAZO_SUBIR_WINDOWS_MS : PRAZO_SUBIR_MS);
    mcp.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const g: Geracao = {
      daemon, mcp, socket, dir, apps: appsDoManifesto, vivo: true,
      chamar: async (nome, args) => lerResultadoDriver(await req("tools/call", { name: nome, arguments: args }, PRAZO_CHAMADA_MS)),
    };
    daemon.once("exit", () => { if (geracao === g) { geracao = null; matar(g); } });
    mcp.once("exit", () => { if (geracao === g) { geracao = null; matar(g); } });
    return g;
  }

  /** Um driver vivo cujo manifesto cobre estes apps (sobe ou troca de geração se precisar). */
  async function driverPara(lista: readonly AppDoComputador[]): Promise<Geracao> {
    if (subindo) await subindo.catch(() => undefined);
    const atual = geracao;
    if (atual?.vivo && lista.every((a) => atual.apps.has(a.id))) return atual;
    const uniao = new Map(atual?.apps ?? []);
    for (const a of lista) uniao.set(a.id, a);
    matar(atual);
    geracao = null;
    subindo = subir(uniao);
    try { geracao = await subindo; return geracao; } finally { subindo = null; }
  }

  function armarOcioso(): void {
    if (relogioOcioso) clearTimeout(relogioOcioso);
    relogioOcioso = setTimeout(() => { matar(geracao); geracao = null; }, ocioso);
    relogioOcioso.unref?.();
  }

  async function sessao(g: Geracao, agenteId: string, bot: string): Promise<string> {
    const nome = `nod-${agenteId.slice(0, 8)}`;
    if (!sessoes.has(nome)) {
      await g.chamar("start_session", { session: nome, label: bot.slice(0, 40) }).catch(() => undefined);
      sessoes.add(nome);
    }
    return nome;
  }

  /**
   * O campo de texto (o do token pedido, senão o primeiro editável) pelo valor: lê agora e escreve valor + texto. Sem o
   * valor atual lido, não escreve (trocaria o que a pessoa tem no campo). Devolve o resultado ou o porquê de não ter dado.
   */
  async function digitarPeloValor(g: Geracao, base: Record<string, unknown>, texto: string, token: string | null): Promise<ResultadoDriver | string> {
    const lido = await g.chamar("get_window_state", { ...base, include_screenshot: false, tree_format: "elements" }).catch((e: unknown) => e instanceof Error ? e.message : "falhou");
    if (typeof lido === "string") return `releitura: ${lido}`;
    const bruto = lido.estruturado?.elements ?? obj(lido.estruturado?.tree).elements;
    const elementos = Array.isArray(bruto) ? bruto.map(obj) : [];
    if (!elementos.length) return `sem elementos estruturados (chaves: ${Object.keys(lido.estruturado ?? {}).join(",")})`;
    const linha = token ? Number(token.split(":")[1]) : NaN;
    const editavel = (e: Record<string, unknown>) => /edit|document|text ?area|textfield|text field/i.test(String(e.role ?? e.control_type ?? "")) && (!Array.isArray(e.actions) || e.actions.includes("set_value"));
    const alvo = elementos.find((e) => e.element_index === linha && editavel(e)) ?? elementos.find(editavel);
    if (!alvo || typeof alvo.element_token !== "string") return `nenhum campo editável (papéis: ${[...new Set(elementos.map((e) => String(e.role)))].slice(0, 8).join(",")})`;
    if (typeof alvo.value !== "string" && alvo.value !== undefined && alvo.value !== null) return "o valor do campo não veio como texto";
    const atual = typeof alvo.value === "string" ? alvo.value : "";
    // Com pid e janela: sem eles o modo bounded lê como entrada na área de trabalho inteira e recusa (medido na CI).
    const r = await g.chamar("set_value", { element_token: alvo.element_token, value: atual + texto, pid: base.pid, ...(base.window_id !== undefined ? { window_id: base.window_id } : {}), session: base.session });
    if (r.erro) return `set_value: ${r.texto.slice(0, 200)}`;
    return { ...r, texto: `${r.texto}\n(Escrito pelo valor do campo: o Windows não deixou trazer a janela para a frente.)` };
  }

  async function janelaDo(g: Geracao, pid: number, session: string): Promise<number | null> {
    const r = await g.chamar("list_windows", { pid, session });
    const id = escolherJanela(r.estruturado);
    ultimaCaixa = id === null ? null : caixaDaJanela(r.estruturado, id);
    return id;
  }

  async function permissoesOk(g: Geracao): Promise<RespostaSeuComputador | null> {
    if (o.plataforma !== "darwin") return null;
    const r = await g.chamar("check_permissions", {});
    const falta: ("acessibilidade" | "gravacao_de_tela")[] = [];
    if (r.estruturado?.accessibility === false) falta.push("acessibilidade");
    if (r.estruturado?.screen_recording === false) falta.push("gravacao_de_tela");
    return falta.length ? { tipo: "sem_permissao", falta } : null;
  }

  async function executarDentro(agenteId: string, p: PedidoSeuComputador): Promise<RespostaSeuComputador> {
    if (agora() < pausadoAte) return { tipo: "parado" };
    if (p.acao === "apps") {
      const lista = await apps(true);
      return { tipo: "apps", apps: lista.filter((a) => motivoDoBloqueio(a, o.plataforma) === null).slice(0, 300).map((a) => ({ id: a.id, nome: a.nome, aberto: a.aberto })) };
    }
    const pedidoApp = String(p.args.app ?? "");
    let lista = await apps();
    let achado = acharApp(lista, pedidoApp);
    if (!("app" in achado)) { lista = await apps(true); achado = acharApp(lista, pedidoApp); }
    if (!("app" in achado)) return { tipo: "nao_achei", parecidos: achado.parecidos };
    const app = achado.app;
    const alvo: AppDoComputador = { id: app.id, nome: app.nome };
    const bloqueio = motivoDoBloqueio(alvo, o.plataforma);
    if (bloqueio) return { tipo: "bloqueado", app: alvo, motivo: bloqueio };
    if (!p.apps.some((a) => mesmoApp(a.id, app.id, o.plataforma))) return { tipo: "precisa_liberar", app: alvo };

    // S2: a pessoa está mexendo no mesmo app — o bot pausa (a ilha diz) e retoma depois de RETOMA_S sem ela mexer.
    if (o.pessoa && p.acao !== "ver" && await mexendoAgora(app.id)) {
      o.aoAtividade?.({ agenteId, bot: p.bot, app: app.nome, acao: "pausado", em: agora(), janela: null });
      const ate = agora() + ESPERA_PESSOA_MS;
      while (agora() < ate && await o.pessoa.naFrente(app.id).catch(() => false) && o.pessoa.ociosoS() < RETOMA_S) await dormir(1000);
      if (agora() >= ate) return { tipo: "pessoa_usando", app: alvo };
    }
    const g = await driverPara(p.apps.filter((a) => motivoDoBloqueio(a, o.plataforma) === null));
    armarOcioso();
    const falta = await permissoesOk(g);
    if (falta) return falta;
    const session = await sessao(g, agenteId, p.bot);
    ultimaCaixa = null;
    const avisar = () => o.aoAtividade?.({ agenteId, bot: p.bot, app: app.nome, acao: p.acao, em: agora(), janela: ultimaCaixa });
    avisar();

    const abrir = async (): Promise<number | null> => {
      const args: Record<string, unknown> = o.plataforma === "darwin" ? { bundle_id: app.id, session } : { name: app.id, session };
      if (typeof p.args.arquivo === "string" && p.args.arquivo) args.urls = [p.args.arquivo];
      const r = await g.chamar("launch_app", args);
      if (r.erro) throw new ErroDoDriver(r.texto);
      const pid = Number(r.estruturado?.pid);
      return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
    };
    if (p.acao === "abrir_app") {
      const pid = await abrir();
      cacheApps = null;
      return { tipo: "feito", texto: `${app.nome} aberto em segundo plano${pid ? ` (pid ${pid})` : ""}. Use seu_computador_ver para ler a janela.`, app: alvo };
    }
    let pid = app.pid;
    if (!pid) { pid = await abrir(); cacheApps = null; }
    if (!pid) return { tipo: "falhou", texto: `Não deu para abrir o ${app.nome}.` };
    let janela = await janelaDo(g, pid, session);
    if (janela === null) {
      await new Promise((r) => setTimeout(r, 800));
      janela = await janelaDo(g, pid, session);
    }
    if (janela === null && p.acao !== "tecla" && p.acao !== "menu") return { tipo: "falhou", texto: `O ${app.nome} está aberto mas sem janela visível. Abra um documento ou peça para a pessoa abrir a janela.` };

    if (ultimaCaixa) avisar();
    const base: Record<string, unknown> = { pid, session, ...(janela !== null ? { window_id: janela } : {}) };
    const elemento = typeof p.args.elemento === "string" && p.args.elemento ? { element_token: p.args.elemento } : {};
    const ponto = typeof p.args.x === "number" && typeof p.args.y === "number" ? { x: p.args.x, y: p.args.y } : {};
    let r: ResultadoDriver;
    switch (p.acao) {
      case "ver": {
        r = await g.chamar("get_window_state", { ...base, ...(typeof p.args.busca === "string" && p.args.busca ? { query: p.args.busca } : {}), include_screenshot: p.args.sem_imagem !== true, ...jpeg(70), max_image_dimension: 1400 });
        break;
      }
      case "clicar": {
        if (!("element_token" in elemento) && !("x" in ponto)) return { tipo: "falhou", texto: "Diga o elemento (da última leitura) ou x e y." };
        r = await g.chamar("click", { ...base, ...elemento, ...ponto, ...(p.args.botao === "direito" ? { button: "right" } : {}), ...(p.args.duplo === true && "x" in ponto ? { count: 2 } : {}) });
        if (p.args.duplo === true && "element_token" in elemento) r = await g.chamar("double_click", { ...base, ...elemento });
        break;
      }
      case "digitar": {
        const args = { ...base, ...elemento, text: String(p.args.texto ?? "") };
        r = await g.chamar("type_text", args);
        // Medido na CI (Windows Server, Bloco de Notas, 2026-11-26): a entrega em segundo plano (PostMessage) pode não
        // chegar, e o driver diz. Aí repete em primeiro plano: traz a janela um instante, digita e devolve o foco.
        // 1º: o campo pode estar sem o foco do teclado dentro da janela (a entrega vai ao foco). Foca o elemento pela
        // acessibilidade (sem cursor nem foco de janela) e digita de novo em segundo plano.
        if (entregaNaoChegou(r) && "element_token" in elemento) {
          await g.chamar("click", { ...base, ...elemento }).catch(() => null);
          r = await g.chamar("type_text", args);
        }
        if (entregaNaoChegou(r)) r = await g.chamar("type_text", { ...args, delivery_mode: "foreground" });
        // E quando o Windows não deixa trazer a janela (foreground_unavailable, a proteção contra roubo de foco): o campo
        // pelo próprio valor (UI Automation), lido agora e escrito com o texto no fim — sem foco e sem mouse.
        if (entregaNaoChegou(r) || /foreground_unavailable/.test(r.texto)) {
          const pv = await digitarPeloValor(g, base, String(p.args.texto ?? ""), typeof p.args.elemento === "string" ? p.args.elemento : null);
          r = typeof pv === "string" ? { ...r, erro: true, texto: `${r.texto}\nPelo valor do campo também não deu (${pv}). Peça para a pessoa clicar no app e tente de novo.` } : pv;
        }
        break;
      }
      case "tecla": {
        const mods = Array.isArray(p.args.modificadores) ? p.args.modificadores.map((m) => TECLAS_MODIFICADORAS[String(m)]).filter(Boolean) : [];
        const tecla = String(p.args.tecla ?? "");
        r = mods.length ? await g.chamar("hotkey", { ...base, ...elemento, keys: [...mods, tecla] }) : await g.chamar("press_key", { ...base, ...elemento, key: tecla });
        break;
      }
      case "rolar":
        r = await g.chamar("scroll", { ...base, ...elemento, ...ponto, direction: DIRECAO[String(p.args.direcao)] ?? "down", amount: typeof p.args.quantidade === "number" ? p.args.quantidade : 3 });
        break;
      case "arrastar":
        r = await g.chamar("drag", { ...base, from_x: p.args.de_x, from_y: p.args.de_y, to_x: p.args.para_x, to_y: p.args.para_y });
        break;
      case "menu":
        if (janela === null) return { tipo: "falhou", texto: `O ${app.nome} não tem janela para o menu.` };
        r = await g.chamar("invoke_menu", { pid, window_id: janela, session, path: Array.isArray(p.args.caminho) ? p.args.caminho.map(String) : [] });
        break;
    }
    if (telaBloqueada(r)) return { tipo: "tela_bloqueada" };
    if (r.erro) return { tipo: "falhou", texto: r.texto || "O computador recusou a ação." };
    // A imagem depois da ação vai ao painel (a aba "Seu Mac"), não ao bot: um quadro pequeno, sem a árvore.
    let imagem = r.imagem;
    if (!imagem && janela !== null && p.acao !== "ver") {
      const quadro = await g.chamar("get_window_state", { ...base, include_accessibility_tree: false, display_only: true, ...jpeg(60), max_image_dimension: 1000 }).catch(() => null);
      imagem = quadro?.imagem ?? null;
    }
    const efeito = efeitoDoResultado(r);
    return { tipo: "feito", texto: r.texto, app: alvo, ...(imagem && (imagem.mimeType === "image/jpeg" || imagem.mimeType === "image/png") ? { imagem: { mimeType: imagem.mimeType, data: imagem.data } } : {}), ...(efeito ? { efeito } : {}) };
  }

  return {
    executar(agenteId, pedido) {
      // Um comando por vez no driver: a ordem do bot é a ordem na tela (e dois bots não se atropelam no mesmo app).
      const r = fila.then(() => executarDentro(agenteId, pedido)).catch((e: unknown): RespostaSeuComputador => {
        if (e instanceof ErroIndisponivel) return { tipo: "indisponivel", texto: e.message };
        // As mensagens são do próprio nod ("o driver não subiu a tempo", "driver saiu") ou do driver: dizem o que houve.
        return { tipo: "falhou", texto: e instanceof Error && e.message ? `O controle do computador falhou: ${e.message.slice(0, 300)}` : "O controle do computador falhou nesta ação." };
      });
      fila = r.catch(() => undefined);
      return r;
    },
    async parar(pausaMs = 60_000) {
      pausadoAte = agora() + pausaMs;
      matar(geracao);
      geracao = null;
    },
    async desligar() {
      if (relogioOcioso) clearTimeout(relogioOcioso);
      matar(geracao);
      geracao = null;
    },
  };
}

export class ErroIndisponivel extends Error {}
export class ErroDoDriver extends Error {}

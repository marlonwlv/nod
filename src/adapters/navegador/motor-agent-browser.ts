import { spawn } from "node:child_process";
import { createHash, hkdfSync, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { LugarNavegador } from "../../contracts/navegador-do-bot.ts";
import type { CookieNavegador, MotivoFalhaNavegador } from "../../contracts/navegador-maquina.ts";
import { relayPadrao } from "./stream-local.ts";
import type { ElementoNaPagina } from "../../domain/navegador-ensinar.ts";

/**
 * O motor do navegador do bot (ADR-190): o agent-browser 0.43.0 (binário nativo do pacote npm, versão fixa), um daemon
 * com um Chrome por sessão. Cada operação é um processo curto do CLI (`--json --no-webmcp`), com env limpo, prazo e saída
 * limitada; o daemon da sessão sobrevive entre os comandos e morre sozinho com `AGENT_BROWSER_IDLE_TIMEOUT_MS`.
 *
 * Uma sessão por bot (nome do agenteId), perfil persistente por bot no diretório de dados do nod e a chave de cifra do
 * estado derivada por bot (HKDF da NOD_CREDENTIAL_KEY): nada de segredo em claro no disco nem no argv.
 *
 * medido em 2026-11-20 (agent-browser 0.43.0, example.com, Chrome for Testing 156): a resposta JSON é
 * `{success, data, error}`; `open` → `data.{title,url,targetId}`; `snapshot -i` → `data.{snapshot, refs:{e1:{name,role}},
 * origin}`; `tab` → `data.tabs[{tabId:"t1",title,url,active}]`; `screenshot <path>` grava o arquivo e devolve
 * `data.path`; `eval` → `data.result`; `get text|url|title|count|box|styles` → `data.{text|url|title|count|x,y,width,
 * height|styles}`; ref inexistente → `success:false, error:"Unknown ref: e99"` e código 1; `stream status` →
 * `data.{port,enabled,connected}`. Abrir uma aba nova invalida as referências da leitura anterior.
 */

/** A sessão de um bot no motor. `agenteId` é o id do bot (uuid); o nome da sessão sai dele. */
export type SessaoNavegador = { agenteId: string };

export type RefLida = { papel: string; nome: string };
export type LeituraNavegador = { url: string; arvore: string; refs: Readonly<Record<string, RefLida>> };
export type AbaMotor = { id: string; titulo: string; url: string; ativa: boolean };
/** Os campos de login que a página tem agora (L3, L4), já marcados para o foco (`SELETOR_CAMPO`). Nunca o valor. */
export type CamposDeLogin = { usuario: boolean; senha: boolean; codigo: boolean };
export type AlvoProcurar = { por: "papel" | "texto" | "rotulo" | "placeholder"; valor: string; acao: "clicar" | "preencher" | "passar_mouse"; texto?: string; nome?: string };

export type { MotivoFalhaNavegador };

/** A falha de um comando do motor. `detalhe` é o erro do agent-browser (texto da página pode aparecer: não confiável). */
export class FalhaNavegador extends Error {
  readonly motivo: MotivoFalhaNavegador;
  readonly detalhe: string;
  constructor(motivo: MotivoFalhaNavegador, detalhe: string) {
    super(`navegador_${motivo}`);
    this.motivo = motivo;
    this.detalhe = detalhe.slice(0, 500);
  }
}
export const ehFalhaNavegador = (e: unknown): e is FalhaNavegador => e instanceof FalhaNavegador;

/**
 * A costura por lugar (ADR-190, decisão 5): o portão fala com um `MotorNavegador`, e cada lugar dá o seu. No servidor do
 * nod, este (o agent-browser local); no Mac da pessoa e numa máquina sempre ligada, o remoto (`motor-remoto.ts`), que põe
 * cada chamada na fila da máquina, onde este mesmo motor roda (`src/adapters/executor/navegador.ts`).
 */
export interface MotorNavegador {
  readonly lugar: LugarNavegador;
  abrir(s: SessaoNavegador, url: string, novaAba?: boolean): Promise<{ url: string; titulo: string }>;
  ler(s: SessaoNavegador, o?: { soInterativos?: boolean; dentro?: string }): Promise<LeituraNavegador>;
  clicar(s: SessaoNavegador, alvo: string, duplo?: boolean): Promise<void>;
  preencher(s: SessaoNavegador, alvo: string, texto: string): Promise<void>;
  digitar(s: SessaoNavegador, alvo: string, texto: string): Promise<void>;
  tecla(s: SessaoNavegador, tecla: string): Promise<void>;
  rolar(s: SessaoNavegador, o: { direcao?: "cima" | "baixo" | "esquerda" | "direita"; pixels?: number; alvo?: string }): Promise<void>;
  esperar(s: SessaoNavegador, o: { alvo?: string; texto?: string; ms?: number }): Promise<void>;
  /** O print da página em JPEG (base64). */
  print(s: SessaoNavegador, o?: { paginaInteira?: boolean }): Promise<{ jpeg: string }>;
  texto(s: SessaoNavegador, alvo?: string): Promise<string>;
  obter(s: SessaoNavegador, oQue: "url" | "titulo" | "valor" | "atributo" | "html" | "quantos" | "caixa", alvo?: string, nome?: string): Promise<unknown>;
  estilos(s: SessaoNavegador, alvo: string): Promise<Record<string, string>>;
  selecionar(s: SessaoNavegador, alvo: string, opcoes: readonly string[]): Promise<void>;
  marcar(s: SessaoNavegador, alvo: string, marcado: boolean): Promise<void>;
  passarMouse(s: SessaoNavegador, alvo: string): Promise<void>;
  arrastar(s: SessaoNavegador, de: string, para: string): Promise<void>;
  /** Clique, movimento ou roda por coordenada da página (o `pixel` do catálogo). */
  mouse(s: SessaoNavegador, o: { acao: "mover" | "clicar" | "rolar"; x: number; y: number; delta?: number }): Promise<void>;
  historico(s: SessaoNavegador, acao: "voltar" | "avancar" | "recarregar"): Promise<void>;
  abas(s: SessaoNavegador): Promise<AbaMotor[]>;
  abaNova(s: SessaoNavegador, url?: string): Promise<void>;
  abaTrocar(s: SessaoNavegador, id: string): Promise<void>;
  abaFechar(s: SessaoNavegador, id?: string): Promise<void>;
  /** Entra num iframe (seletor ou ref); `null` volta à página principal. */
  quadro(s: SessaoNavegador, alvo: string | null): Promise<void>;
  dialogo(s: SessaoNavegador, aceitar: boolean, texto?: string): Promise<void>;
  /** Baixa clicando no alvo; o arquivo fica na pasta do bot, com o nome dado (sem caminho). */
  baixar(s: SessaoNavegador, alvo: string, nome: string): Promise<{ nome: string; bytes: number }>;
  /** Envia arquivos da pasta do bot (só nomes, nunca caminho). */
  enviarArquivo(s: SessaoNavegador, alvo: string, nomes: readonly string[]): Promise<void>;
  pdf(s: SessaoNavegador, nome: string): Promise<{ nome: string; bytes: number }>;
  procurar(s: SessaoNavegador, o: AlvoProcurar): Promise<void>;
  avaliar(s: SessaoNavegador, expressao: string): Promise<unknown>;
  /** O elemento com o foco (para classificar o Enter): papel e nome, como a leitura daria. */
  focado(s: SessaoNavegador): Promise<RefLida | null>;
  /**
   * "Ensinar uma tarefa" (T): o elemento sob o ponto da página (ou o focado, com `ponto` null), com papel, nome
   * acessível, rótulo e tipo do campo. Nunca o valor de um campo de digitar.
   */
  descreverElemento(s: SessaoNavegador, ponto: { x: number; y: number } | null): Promise<ElementoNaPagina | null>;
  url(s: SessaoNavegador): Promise<string>;
  /**
   * L3/L4: acha na página o campo de usuário, o de senha e o de código de uso único (pelo tipo, pelo autocomplete e pelo
   * rótulo, as mesmas regras de `campoEhSecreto`) e os marca com `data-nod-campo` para `inserirTexto` focar.
   */
  camposDeLogin(s: SessaoNavegador): Promise<CamposDeLogin>;
  /**
   * Põe um texto (o segredo do cofre, o código do SMS) no campo `alvo` (ou no focado, com null) como digitação, pelo
   * relay `insertText` do daemon: o texto nunca entra no argv de um processo, no log nem na resposta.
   */
  inserirTexto(s: SessaoNavegador, alvo: string | null, texto: string): Promise<void>;
  /** L1 "Trazer do meu Chrome": grava os cookies do site no perfil do bot, pelo relay (`cookies_set`), fora do argv. */
  definirCookies(s: SessaoNavegador, cookies: readonly CookieNavegador[]): Promise<void>;
  /** A porta do WebSocket de quadros da sessão (liga o streaming se estiver desligado); null sem sessão viva. */
  portaDoStream(s: SessaoNavegador): Promise<number | null>;
  /** O tamanho da página em CSS px (`set viewport`): acompanha a área de quem assiste (emenda de 2026-11-20 da ADR-190). */
  tamanho(s: SessaoNavegador, w: number, h: number): Promise<void>;
  fechar(s: SessaoNavegador): Promise<void>;
  /**
   * Ponto 09 dos cenários (2026-11-22): com o Chrome fechado, apaga o que o Chrome refaz sozinho (caches, o modelo do
   * optimization guide) e mantém o que é da pessoa (cookies, logins, IndexedDB, Local Storage). Devolve os bytes que sobraram.
   */
  limparCache?(s: SessaoNavegador): Promise<number>;
  /** O bot foi excluído: o perfil inteiro sai do disco (logins, arquivos e prints dele). */
  apagarPerfil?(s: SessaoNavegador): Promise<void>;
  /** O espaço que o navegador do bot ocupa no disco, em bytes. */
  espaco?(s: SessaoNavegador): Promise<number>;
}

/** O que o Chrome refaz sozinho: sai na pausa (relativo à pasta do perfil). */
export const CACHES_DO_PERFIL = [
  "Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/DawnGraphiteCache", "Default/DawnWebGPUCache",
  "Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache", "GraphiteDawnCache", "GrShaderCache", "ShaderCache",
  "optimization_guide_model_store", "component_crx_cache",
] as const;

/** O tamanho de uma pasta (bytes), sem seguir links; o que não dá para ler conta zero. */
export async function tamanhoDaPasta(caminho: string): Promise<number> {
  let total = 0;
  const entradas = await readdir(caminho, { withFileTypes: true }).catch(() => []);
  for (const e of entradas) {
    const c = join(caminho, e.name);
    if (e.isDirectory()) total += await tamanhoDaPasta(c);
    else if (e.isFile()) total += (await stat(c).catch(() => null))?.size ?? 0;
  }
  return total;
}

/** O que roda o binário (injetável: o teste nunca sobe Chrome). */
export type ExecutorProcesso = (p: { bin: string; args: readonly string[]; env: Readonly<Record<string, string>>; prazoMs: number; limiteSaida: number }) => Promise<{ codigo: number | null; saida: string; erro: string; estourou: boolean }>;

export type OpcoesMotorAgentBrowser = {
  /** Diretório de dados do nod para os navegadores (perfis, prints e arquivos por bot). */
  dados: string;
  /** A chave mestra do servidor (a mesma das credenciais): a cifra do estado de cada bot sai dela por HKDF. */
  segredo: Buffer;
  /** O binário; ausente = o do pacote npm desta plataforma. */
  binario?: string | null;
  /** O Chrome a usar (AGENT_BROWSER_EXECUTABLE_PATH); ausente = o que o agent-browser acha. */
  chrome?: string | null;
  executor?: ExecutorProcesso;
  /** definido em 2026-11-20: o daemon morre sozinho depois disto sem comando (ADR-190: pausa em 10 min). */
  ociosoMs?: number;
  /** AGENT_BROWSER_SOCKET_DIR; ausente = `dirSocketPadrao()`; null = o padrão do agent-browser. */
  dirSocket?: string | null;
  /** O `POST /api/command` do daemon (padrão: o relay local de stream-local.ts); o teste troca por um falso. */
  relay?: (porta: number, comando: Readonly<Record<string, unknown>>) => Promise<boolean>;
};

/** Onde `camposDeLogin` marcou cada campo (o atributo é do nod; o site pode vê-lo, e só diz "este é o campo"). */
export const SELETOR_CAMPO = { usuario: '[data-nod-campo="usuario"]', senha: '[data-nod-campo="senha"]', codigo: '[data-nod-campo="codigo"]' } as const;

/**
 * Os campos de login da página, em JS fixo do servidor (nada do modelo entra). Visível = tem caixa na tela. A senha é o
 * primeiro `type=password` visível (ou autocomplete current-password); o usuário, o campo de texto/e-mail visível antes
 * dela no mesmo formulário (autocomplete username/email primeiro), ou, sem senha na página (login em duas etapas), o campo
 * de e-mail/usuário; o código, autocomplete one-time-code, ou um campo
 * curto cujo nome/rótulo diz código, OTP, token ou SMS. Nunca lê o valor de nenhum campo.
 */
export const JS_CAMPOS_LOGIN = `(() => { document.querySelectorAll('[data-nod-campo]').forEach((e) => e.removeAttribute('data-nod-campo'));
  const visivel = (e) => !e.disabled && !e.readOnly && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const campos = [...document.querySelectorAll('input')].filter(visivel);
  const tipo = (e) => (e.getAttribute('type') || 'text').toLowerCase(); const auto = (e) => (e.getAttribute('autocomplete') || '').toLowerCase();
  const texto = (e) => [e.name, e.id, e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.labels && e.labels[0] ? e.labels[0].innerText : ''].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const senha = campos.find((e) => tipo(e) === 'password' && !/new-password/.test(auto(e))) || campos.find((e) => /current-password/.test(auto(e)));
  const deTexto = (e) => ['text', 'email', 'tel', ''].includes(tipo(e));
  let usuario = null;
  if (senha) { const antes = campos.slice(0, campos.indexOf(senha)).filter((e) => deTexto(e) && (!senha.form || e.form === senha.form));
    usuario = antes.find((e) => /username|email/.test(auto(e))) || antes[antes.length - 1] || null; }
  else usuario = campos.find((e) => /username|email/.test(auto(e))) || campos.find((e) => tipo(e) === 'email') || null;
  const codigo = campos.find((e) => /one-time-code/.test(auto(e))) || campos.find((e) => e !== senha && e !== usuario && deTexto(e) && (e.maxLength > 0 && e.maxLength <= 10 || /numeric/.test(e.inputMode || '')) && /codigo|code|otp|token|sms|verifica/.test(texto(e))) || null;
  if (senha) senha.setAttribute('data-nod-campo', 'senha'); if (usuario) usuario.setAttribute('data-nod-campo', 'usuario'); if (codigo) codigo.setAttribute('data-nod-campo', 'codigo');
  return { usuario: !!usuario, senha: !!senha, codigo: !!codigo }; })()`;

/** definido em 2026-11-20: prazo de um comando comum; abrir e baixar esperam a página. Cobrem o `wait` de até 10 s. */
const PRAZO_COMANDO_MS = 30_000;
const PRAZO_ABRIR_MS = 60_000;
const OCIOSO_PADRAO_MS = 10 * 60_000;

/**
 * O Chrome do bot se apresenta como o mesmo Chrome com janela (definido em 2026-11-22, teste do dono: o IMDb devolvia
 * "403 Forbidden"; referência: o OpenMausBot, que usa o mesmo agent-browser). Sem janela (`--headless=new`), o Chrome só
 * se denuncia pela palavra "HeadlessChrome" na identificação e por `navigator.webdriver`, que vem da marca de automação;
 * o resto é o que o mesmo binário diz com janela. Nada é inventado: a versão é a do próprio binário, o sistema é o da
 * máquina. Medido no IMDb (firewall da Amazon): 403 → página normal.
 */
export const ARGS_CHROME_DO_BOT = [
  "--disable-blink-features=AutomationControlled",
  // Ponto 09 dos cenários (2026-11-22): o cache de cada perfil fica em até 64 MB e o Chrome não baixa os modelos do
  // "optimization guide" (41 MB por bot no teste).
  "--disk-cache-size=67108864",
  "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
] as const;

/**
 * A identificação que o mesmo Chrome dá com janela: a dele sem janela com "HeadlessChrome/" trocado por "Chrome/" (o
 * OpenMausBot faz igual). null = não é um Chrome sem janela (já se apresenta como Chrome) ou não parece Chrome.
 */
export function identificacaoComJanela(semJanela: string): string | null {
  if (!semJanela.includes("HeadlessChrome/")) return null;
  const comJanela = semJanela.replace("HeadlessChrome/", "Chrome/");
  return / Chrome\/\d+[.\d]* /u.test(comJanela) && !/headless/iu.test(comJanela) ? comJanela : null;
}

/** A sessão à parte (perfil próprio, nenhum bot) que pergunta ao Chrome como ele se apresenta. */
export const SESSAO_IDENTIDADE = "identidade";
/** medido em 2026-11-20: `wait --text` sem casar só volta aos 25 s ("Wait timed out after 25000ms"); o contrato é 10 s. */
const PRAZO_ESPERAR_MS = 12_000;
/** definido em 2026-11-20: a árvore de uma página grande cabe folgada; o proxy corta para o modelo (ler_mais). */
const LIMITE_SAIDA = 4 * 1024 * 1024;
const LIMITE_STDERR = 16 * 1024;

const PACOTE_POR_PLATAFORMA: Readonly<Record<string, string>> = {
  "darwin-arm64": "@agent-browser/cli-darwin-arm64",
  "darwin-x64": "@agent-browser/cli-darwin-x64",
  "linux-x64": "@agent-browser/cli-linux-x64-gnu",
  "linux-arm64": "@agent-browser/cli-linux-arm64-gnu",
  // 2026-11-22 (o navegador no PC): o pacote do Windows serve x64 e arm64 (o lock diz as duas cpus).
  "win32-x64": "@agent-browser/cli-win32-x64-msvc",
  "win32-arm64": "@agent-browser/cli-win32-x64-msvc",
};

/** O nome do executável do agent-browser na plataforma (no Windows, `agent-browser.exe`). */
export const nomeDoBinario = (plataforma: string = process.platform): string => (plataforma.startsWith("win32") ? "agent-browser.exe" : "agent-browser");

/**
 * As variáveis do sistema que o agent-browser e o Chrome precisam além do PATH e do HOME. No Windows, sem SystemRoot,
 * LOCALAPPDATA, USERPROFILE e TEMP o Chrome não sobe (e o agent-browser não acha a pasta dele). Nenhuma variável do nod
 * (chaves, banco) passa: só estes nomes.
 */
export function ambienteDoSistema(env: Readonly<Record<string, string | undefined>> = process.env, plataforma: string = process.platform): Record<string, string> {
  const nomes = plataforma === "win32"
    ? ["SystemRoot", "SYSTEMROOT", "windir", "SystemDrive", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "COMSPEC", "PATHEXT", "HOMEDRIVE", "HOMEPATH", "USERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]
    : ["TMPDIR"];
  const saida: Record<string, string> = {};
  for (const n of nomes) { const v = env[n]; if (v) saida[n] = v; }
  return saida;
}

/** O binário nativo do agent-browser desta plataforma, pelo pacote da plataforma ou pelo bin/ do pacote principal. */
export function binarioAgentBrowser(plataforma = `${process.platform}-${process.arch}`): string | null {
  const req = createRequire(import.meta.url);
  const pacote = PACOTE_POR_PLATAFORMA[plataforma];
  const candidatos: string[] = [];
  if (pacote) {
    try { candidatos.push(join(dirname(req.resolve(`${pacote}/package.json`)), "bin", nomeDoBinario(plataforma))); } catch { /* tenta o principal */ }
  }
  try { candidatos.push(join(dirname(req.resolve("agent-browser/package.json")), "bin", `agent-browser-${plataforma}`)); } catch { /* sem o pacote */ }
  return candidatos.find((c) => existsSync(c)) ?? null;
}

const idLimpo = (agenteId: string): string => {
  const limpo = agenteId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!limpo) throw new FalhaNavegador("indisponivel", "bot sem id");
  return limpo;
};

/**
 * A pasta do bot em `dados` (perfil com os logins, prints, arquivos): `nod-<id>`, só `[A-Za-z0-9_-]`, até 64. É o nome
 * que a sessão tinha até 2026-11-24; a pasta ficou com ele para os perfis já salvos não se perderem com a troca abaixo.
 */
export function pastaDoBot(agenteId: string): string {
  return `nod-${idLimpo(agenteId)}`.slice(0, 64);
}

/**
 * O nome da sessão do agent-browser para um bot: `nod-` + 12 hex do sha256 do id (estável por bot; 48 bits, sem colisão
 * prática). Curto porque vira o nome do socket do daemon: medido em 2026-11-24 no Mac (agent-browser 0.43.0), o socket
 * fica em `<dir>/namespaces/nod/run/<sessão>.sock` e `nod-<uuid>` sob `~/.agent-browser` dava 104 bytes, acima do
 * sun_path do macOS (103 úteis) — todo `navegador_abrir` falhava com "Session name … is too long".
 */
export function nomeDaSessao(agenteId: string): string {
  return `nod-${createHash("sha256").update(idLimpo(agenteId)).digest("hex").slice(0, 12)}`;
}

/** O sun_path do macOS tem 104 bytes com o NUL (no Linux, 108): o caminho do socket precisa caber em 103. */
export const LIMITE_CAMINHO_SOCKET = 103;

/** Onde o agent-browser 0.43.0 põe o socket do daemon de uma sessão (medido em 2026-11-24). */
export const caminhoDoSocket = (dirSocket: string, sessao: string, namespace = "nod"): string => join(dirSocket, "namespaces", namespace, "run", `${sessao}.sock`);

/**
 * O diretório curto dos sockets (AGENT_BROWSER_SOCKET_DIR): `/tmp/nod-ab-<uid>`, só do usuário (0700). Sem ele o
 * agent-browser usa `~/.agent-browser`, que num HOME comprido estoura o sun_path de novo. No Windows o daemon não usa
 * socket de arquivo: null (fica o padrão).
 */
export function dirSocketPadrao(plataforma: string = process.platform, uid: number | undefined = process.getuid?.()): string | null {
  if (plataforma === "win32") return null;
  return `/tmp/nod-ab-${uid ?? "u"}`;
}

/** Cria o diretório dos sockets 0700 e confere que é um diretório nosso (não link, não de outro usuário); senão null. */
export async function prepararDirSocket(dir: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const st = await lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return null;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return null;
    if ((st.mode & 0o077) !== 0) await chmod(dir, 0o700);
    return dir;
  } catch {
    return null;
  }
}

/** A chave de cifra do estado de um bot (hex de 64), derivada da chave mestra; nunca guardada. */
export function chaveDoBot(segredo: Buffer, agenteId: string): string {
  return Buffer.from(hkdfSync("sha256", segredo, Buffer.alloc(0), `nod-navegador:${agenteId}`, 32)).toString("hex");
}

/** Nome de arquivo seguro dentro da pasta do bot: sem caminho, sem começar por ponto. */
export function nomeDeArquivo(nome: string): string {
  const b = basename(nome.replace(/\\/g, "/")).replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "").slice(0, 200);
  if (!b) throw new FalhaNavegador("alvo_invalido", "nome de arquivo vazio");
  return b;
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * A resposta de um comando: `data` no sucesso; senão a falha tipada. Saída que não é JSON é falha do motor (o CLI
 * mudou ou caiu antes de responder).
 */
export function lerResposta(saida: string, codigo: number | null): Record<string, unknown> {
  const linha = saida.trim().split("\n").filter(Boolean).at(-1) ?? "";
  let r: unknown;
  try { r = JSON.parse(linha); } catch { throw new FalhaNavegador("acao_falhou", codigo === 0 ? "resposta sem JSON" : `o navegador saiu com ${codigo ?? "sinal"}`); }
  const o = obj(r);
  if (o.success === true) return obj(o.data);
  const erro = str(o.error) || "falhou";
  if (/unknown ref|no element|not found|no node|did not match|not visible|not attached|is not an? (input|select|checkbox)/i.test(erro)) throw new FalhaNavegador("alvo_invalido", erro);
  if (/timed? ?out|timeout/i.test(erro)) throw new FalhaNavegador("tempo_esgotado", erro);
  throw new FalhaNavegador("acao_falhou", erro);
}

export function lerLeitura(data: Record<string, unknown>): LeituraNavegador {
  const refs: Record<string, RefLida> = {};
  for (const [k, v] of Object.entries(obj(data.refs))) {
    if (!/^e\d+$/.test(k)) continue;
    const r = obj(v);
    refs[k] = { papel: str(r.role), nome: str(r.name) };
  }
  return { url: str(data.origin), arvore: str(data.snapshot), refs };
}

export function lerAbas(data: Record<string, unknown>): AbaMotor[] {
  const abas = Array.isArray(data.tabs) ? data.tabs : [];
  return abas.map(obj).filter((a) => a.type === undefined || a.type === "page").map((a) => ({ id: str(a.tabId), titulo: str(a.title), url: str(a.url), ativa: a.active === true }));
}

/** O alvo como o agent-browser o entende: ref (`@e3` ou `e3`) vira `@e3`; o resto é seletor CSS. */
export function alvoDoMotor(alvo: string): string {
  const t = alvo.trim();
  return /^@?e\d+$/.test(t) ? `@${t.replace(/^@/, "")}` : t;
}

const DIRECAO: Readonly<Record<string, string>> = { cima: "up", baixo: "down", esquerda: "left", direita: "right" };
const OBTER: Readonly<Record<string, string>> = { url: "url", titulo: "title", valor: "value", atributo: "attr", html: "html", quantos: "count", caixa: "box" };
const POR: Readonly<Record<string, string>> = { papel: "role", texto: "text", rotulo: "label", placeholder: "placeholder" };
const ACAO_PROCURAR: Readonly<Record<string, string>> = { clicar: "click", preencher: "fill", passar_mouse: "hover" };

/** O elemento focado (e, num campo de formulário, o botão que o Enter dispara), em JS de página fixo do servidor. */
const JS_FOCADO = `(() => { const e = document.activeElement; if (!e || e === document.body) return null;
  const nomeDe = (x) => (x.getAttribute('aria-label') || x.innerText || x.value || x.getAttribute('title') || '').trim().slice(0, 200);
  const tag = e.tagName.toLowerCase(); const tipo = (e.getAttribute('type') || '').toLowerCase();
  if (e.form && tag === 'input' && tipo !== 'submit' && tipo !== 'button') { const b = e.form.querySelector('[type=submit], button:not([type])'); if (b) return { papel: 'button', nome: nomeDe(b) }; return { papel: 'textbox', nome: nomeDe(e) }; }
  const papel = e.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' || tipo === 'submit' || tipo === 'button' ? 'button' : tag);
  return { papel, nome: nomeDe(e) }; })()`;

/**
 * O elemento sob o ponto (ou o focado), em JS de página fixo do servidor; o ponto entra como número já conferido. Sobe
 * do nó clicado ao interativo mais próximo (o texto dentro de um botão conta como o botão). O valor de um campo de
 * digitar nunca é lido; o de um input de botão (submit) é o rótulo dele.
 */
export function jsDescreverElemento(ponto: { x: number; y: number } | null): string {
  const alvo = ponto ? `document.elementFromPoint(${Number(ponto.x)}, ${Number(ponto.y)})` : "document.activeElement";
  return `(() => { const bruto = ${alvo}; if (!bruto || bruto === document.body || bruto === document.documentElement) return null;
  const e = bruto.closest('a,button,input,textarea,select,summary,[role],[contenteditable=""],[contenteditable="true"]') || bruto;
  const tag = e.tagName.toLowerCase(); const tipo = (e.getAttribute('type') || '').toLowerCase();
  const botaoInput = tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(tipo);
  const editavel = (tag === 'input' && !botaoInput && !['checkbox', 'radio', 'file', 'range', 'color', 'hidden'].includes(tipo)) || tag === 'textarea' || e.isContentEditable === true;
  const papel = e.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' || botaoInput ? 'button' : tag === 'select' ? 'combobox' : tipo === 'checkbox' ? 'checkbox' : tipo === 'radio' ? 'radio' : editavel ? (tipo === 'search' ? 'searchbox' : 'textbox') : tag);
  const texto = (x) => (x || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  let rotulo = '';
  if (e.labels && e.labels.length) rotulo = e.labels[0].innerText;
  if (!rotulo && e.getAttribute('aria-labelledby')) { const l = document.getElementById(e.getAttribute('aria-labelledby').split(' ')[0]); if (l) rotulo = l.innerText; }
  if (!rotulo) rotulo = e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('name') || '';
  const nome = editavel ? '' : (e.getAttribute('aria-label') || (botaoInput ? e.value : e.innerText) || e.getAttribute('title') || e.getAttribute('alt') || '');
  return { papel, nome: texto(nome), rotulo: texto(rotulo), tipo: tipo || null, autocomplete: e.getAttribute('autocomplete'), editavel }; })()`;
}

export const executorPadrao: ExecutorProcesso = ({ bin, args, env, prazoMs, limiteSaida }) => new Promise((resolve) => {
  const filho = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  let erro = "";
  let estourou = false;
  let fim = false;
  const terminar = (codigo: number | null) => {
    if (fim) return;
    fim = true;
    clearTimeout(relogio);
    resolve({ codigo, saida, erro, estourou });
  };
  const relogio = setTimeout(() => { estourou = true; filho.kill("SIGKILL"); }, prazoMs);
  filho.stdout.setEncoding("utf8").on("data", (c: string) => {
    if (saida.length + c.length > limiteSaida) { estourou = true; filho.kill("SIGKILL"); return; }
    saida += c;
  });
  filho.stderr.setEncoding("utf8").on("data", (c: string) => { if (erro.length < LIMITE_STDERR) erro += c.slice(0, LIMITE_STDERR - erro.length); });
  filho.on("error", () => terminar(null));
  filho.on("close", (codigo) => terminar(codigo));
});

export function criarMotorAgentBrowser(o: OpcoesMotorAgentBrowser): MotorNavegador {
  const bin = o.binario ?? binarioAgentBrowser();
  const executor = o.executor ?? executorPadrao;
  const ocioso = o.ociosoMs ?? OCIOSO_PADRAO_MS;
  const relay = o.relay ?? relayPadrao;
  const pasta = (s: SessaoNavegador) => join(o.dados, pastaDoBot(s.agenteId));
  const pedidoDirSocket = o.dirSocket === undefined ? dirSocketPadrao() : o.dirSocket;
  let dirSocket: Promise<string | null> | null = null;
  const socketPronto = () => (dirSocket ??= pedidoDirSocket ? prepararDirSocket(pedidoDirSocket) : Promise.resolve(null));

  /**
   * A identificação com janela, perguntada ao próprio Chrome uma vez por processo (revisto em 2026-11-22: ler a versão do
   * binário só valia com o caminho configurado, e no teste do dono o agent-browser escolhia o Chrome sozinho — o IMDb
   * seguiu no 403). Numa sessão à parte: abre, lê `navigator.userAgent`, fecha; os bots sobem depois já com ela. Falhou,
   * fica a do agent-browser (só a marca de automação sai).
   */
  let identificacao: Promise<string | null> | null = null;
  function identificacaoDoChrome(): Promise<string | null> {
    identificacao ??= (async () => {
      if (!bin) return null;
      const sessaoId = { agenteId: SESSAO_IDENTIDADE };
      await mkdir(pasta(sessaoId), { recursive: true });
      const socket = await socketPronto();
      const args = (a: readonly string[]) => [...a, "--session", nomeDaSessao(SESSAO_IDENTIDADE), "--json", "--no-webmcp"];
      try {
        const r = await executor({ bin, args: args(["eval", "navigator.userAgent"]), env: ambiente(sessaoId, null, socket), prazoMs: PRAZO_COMANDO_MS, limiteSaida: LIMITE_SAIDA });
        const ua = lerResposta(r.saida, r.codigo).result;
        return typeof ua === "string" ? identificacaoComJanela(ua) : null;
      } catch {
        return null;
      } finally {
        await executor({ bin, args: args(["close"]), env: ambiente(sessaoId, null, socket), prazoMs: PRAZO_COMANDO_MS, limiteSaida: LIMITE_SAIDA }).catch(() => undefined);
      }
    })();
    return identificacao;
  }

  /** Env limpo: só o que o CLI e o daemon precisam; nenhuma variável do servidor (chaves, banco) passa. */
  function ambiente(s: SessaoNavegador, agente: string | null, socket: string | null): Record<string, string> {
    const base = pasta(s);
    return {
      ...ambienteDoSistema(),
      ...(socket ? { AGENT_BROWSER_SOCKET_DIR: socket } : {}),
      PATH: process.env.PATH ?? process.env.Path ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? process.env.USERPROFILE ?? base,
      AGENT_BROWSER_SESSION: nomeDaSessao(s.agenteId),
      AGENT_BROWSER_NAMESPACE: "nod",
      AGENT_BROWSER_PROFILE: join(base, "perfil"),
      AGENT_BROWSER_DOWNLOAD_PATH: join(base, "arquivos"),
      AGENT_BROWSER_ENCRYPTION_KEY: chaveDoBot(o.segredo, s.agenteId),
      AGENT_BROWSER_IDLE_TIMEOUT_MS: String(ocioso),
      AGENT_BROWSER_NO_VERSION_CHECK: "1",
      AGENT_BROWSER_NO_WEBMCP: "1",
      AGENT_BROWSER_SCREENSHOT_FORMAT: "jpeg",
      AGENT_BROWSER_SCREENSHOT_QUALITY: "70",
      ...(o.chrome ? { AGENT_BROWSER_EXECUTABLE_PATH: o.chrome } : {}),
      AGENT_BROWSER_ARGS: ARGS_CHROME_DO_BOT.join(","),
      ...(agente ? { AGENT_BROWSER_USER_AGENT: agente } : {}),
    };
  }

  async function rodar(s: SessaoNavegador, args: readonly string[], prazoMs = PRAZO_COMANDO_MS): Promise<Record<string, unknown>> {
    if (!bin) throw new FalhaNavegador("indisponivel", "o agent-browser não está instalado nesta máquina");
    await mkdir(join(pasta(s), "arquivos"), { recursive: true });
    const r = await executor({ bin, args: [...args, "--session", nomeDaSessao(s.agenteId), "--json", "--no-webmcp"], env: ambiente(s, await identificacaoDoChrome(), await socketPronto()), prazoMs, limiteSaida: LIMITE_SAIDA });
    if (r.estourou) throw new FalhaNavegador("tempo_esgotado", "o navegador não respondeu a tempo");
    return lerResposta(r.saida, r.codigo);
  }
  const alvoOuFalha = (alvo: string) => {
    const a = alvoDoMotor(alvo);
    if (!a) throw new FalhaNavegador("alvo_invalido", "alvo vazio");
    return a;
  };
  async function portaDoStream(s: SessaoNavegador): Promise<number | null> {
    let d = await rodar(s, ["stream", "status"]);
    if (d.enabled !== true) {
      await rodar(s, ["stream", "enable"]);
      d = await rodar(s, ["stream", "status"]);
    }
    return typeof d.port === "number" ? d.port : null;
  }
  async function arquivoNaPasta(s: SessaoNavegador, nome: string): Promise<{ nome: string; caminho: string }> {
    const n = nomeDeArquivo(nome);
    return { nome: n, caminho: join(pasta(s), "arquivos", n) };
  }

  return {
    lugar: { tipo: "nod" },
    async abrir(s, url, novaAba) {
      const d = await rodar(s, novaAba ? ["tab", "new", url] : ["open", url], PRAZO_ABRIR_MS);
      return { url: str(d.url) || url, titulo: str(d.title) };
    },
    async ler(s, l) {
      const args = ["snapshot", ...(l?.soInterativos === false ? [] : ["-i"]), ...(l?.dentro ? ["-s", l.dentro] : [])];
      return lerLeitura(await rodar(s, args));
    },
    async clicar(s, alvo, duplo) { await rodar(s, [duplo ? "dblclick" : "click", alvoOuFalha(alvo)]); },
    async preencher(s, alvo, texto) { await rodar(s, ["fill", alvoOuFalha(alvo), texto]); },
    async digitar(s, alvo, texto) { await rodar(s, ["type", alvoOuFalha(alvo), texto]); },
    async tecla(s, tecla) { await rodar(s, ["press", tecla]); },
    async rolar(s, r) {
      if (r.alvo) { await rodar(s, ["scrollintoview", alvoOuFalha(r.alvo)]); return; }
      await rodar(s, ["scroll", DIRECAO[r.direcao ?? "baixo"] ?? "down", String(Math.max(1, Math.min(20_000, Math.round(r.pixels ?? 600))))]);
    },
    async esperar(s, e) {
      // O `wait` do agent-browser espera até 25 s por um alvo ou texto; o contrato é até 10 s, então o prazo do processo corta.
      if (e.alvo) await rodar(s, ["wait", alvoOuFalha(e.alvo)], PRAZO_ESPERAR_MS);
      else if (e.texto) await rodar(s, ["wait", "--text", e.texto], PRAZO_ESPERAR_MS);
      else await rodar(s, ["wait", String(Math.max(0, Math.min(10_000, Math.round(e.ms ?? 1000))))], PRAZO_ESPERAR_MS);
    },
    async print(s, p) {
      const dir = join(pasta(s), "prints");
      await mkdir(dir, { recursive: true });
      const caminho = join(dir, `${randomUUID()}.jpg`);
      try {
        await rodar(s, ["screenshot", caminho, ...(p?.paginaInteira ? ["--full"] : [])]);
        return { jpeg: (await readFile(caminho)).toString("base64") };
      } finally { await rm(caminho, { force: true }); }
    },
    async texto(s, alvo) { return str((await rodar(s, ["get", "text", alvo ? alvoOuFalha(alvo) : "body"])).text); },
    async obter(s, oQue, alvo, nome) {
      const verbo = OBTER[oQue] ?? "url";
      const args = ["get", verbo, ...(verbo === "attr" ? [alvoOuFalha(alvo ?? ""), nome ?? ""] : alvo && verbo !== "url" && verbo !== "title" ? [alvoOuFalha(alvo)] : [])];
      const d = await rodar(s, args);
      if (verbo === "box") return { x: d.x, y: d.y, w: d.width, h: d.height };
      const chave = ({ url: "url", title: "title", value: "value", attr: "value", html: "html", count: "count" } as Record<string, string>)[verbo] ?? verbo;
      return d[chave] ?? d.text ?? d.result ?? null;
    },
    async estilos(s, alvo) {
      const st = obj((await rodar(s, ["get", "styles", alvoOuFalha(alvo)])).styles);
      return Object.fromEntries(Object.entries(st).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    },
    async selecionar(s, alvo, opcoes) { await rodar(s, ["select", alvoOuFalha(alvo), ...opcoes]); },
    async marcar(s, alvo, marcado) { await rodar(s, [marcado ? "check" : "uncheck", alvoOuFalha(alvo)]); },
    async passarMouse(s, alvo) { await rodar(s, ["hover", alvoOuFalha(alvo)]); },
    async arrastar(s, de, para) { await rodar(s, ["drag", alvoOuFalha(de), alvoOuFalha(para)]); },
    async mouse(s, m) {
      const x = String(Math.round(m.x));
      const y = String(Math.round(m.y));
      await rodar(s, ["mouse", "move", x, y]);
      if (m.acao === "clicar") { await rodar(s, ["mouse", "down", "left"]); await rodar(s, ["mouse", "up", "left"]); }
      if (m.acao === "rolar") await rodar(s, ["mouse", "wheel", String(Math.round(m.delta ?? 300))]);
    },
    async historico(s, acao) { await rodar(s, [acao === "voltar" ? "back" : acao === "avancar" ? "forward" : "reload"], PRAZO_ABRIR_MS); },
    async abas(s) { return lerAbas(await rodar(s, ["tab"])); },
    async abaNova(s, url) { await rodar(s, ["tab", "new", ...(url ? [url] : [])], PRAZO_ABRIR_MS); },
    async abaTrocar(s, id) { await rodar(s, ["tab", id]); },
    async abaFechar(s, id) { await rodar(s, ["tab", "close", ...(id ? [id] : [])]); },
    async quadro(s, alvo) { await rodar(s, ["frame", alvo === null ? "main" : alvoOuFalha(alvo)]); },
    async dialogo(s, aceitar, texto) { await rodar(s, aceitar ? ["dialog", "accept", ...(texto ? [texto] : [])] : ["dialog", "dismiss"]); },
    async baixar(s, alvo, nome) {
      const a = await arquivoNaPasta(s, nome);
      await rodar(s, ["download", alvoOuFalha(alvo), a.caminho], PRAZO_ABRIR_MS);
      return { nome: a.nome, bytes: (await stat(a.caminho)).size };
    },
    async enviarArquivo(s, alvo, nomes) {
      const caminhos = await Promise.all(nomes.map(async (n) => {
        const a = await arquivoNaPasta(s, n);
        await stat(a.caminho).catch(() => { throw new FalhaNavegador("alvo_invalido", `arquivo ${a.nome} não está nos arquivos do navegador`); });
        return a.caminho;
      }));
      await rodar(s, ["upload", alvoOuFalha(alvo), ...caminhos]);
    },
    async pdf(s, nome) {
      const a = await arquivoNaPasta(s, nome.toLowerCase().endsWith(".pdf") ? nome : `${nome}.pdf`);
      await rodar(s, ["pdf", a.caminho], PRAZO_ABRIR_MS);
      return { nome: a.nome, bytes: (await stat(a.caminho)).size };
    },
    async procurar(s, p) {
      const args = ["find", POR[p.por] ?? "text", p.valor, ACAO_PROCURAR[p.acao] ?? "click", ...(p.acao === "preencher" ? [p.texto ?? ""] : []), ...(p.nome ? ["--name", p.nome] : [])];
      await rodar(s, args);
    },
    async avaliar(s, expressao) { return (await rodar(s, ["eval", "-b", Buffer.from(expressao, "utf8").toString("base64")])).result ?? null; },
    async focado(s) {
      const r = obj((await rodar(s, ["eval", "-b", Buffer.from(JS_FOCADO, "utf8").toString("base64")])).result);
      return typeof r.papel === "string" ? { papel: r.papel, nome: str(r.nome) } : null;
    },
    async descreverElemento(s, ponto) {
      const r = obj((await rodar(s, ["eval", "-b", Buffer.from(jsDescreverElemento(ponto), "utf8").toString("base64")])).result);
      if (typeof r.papel !== "string") return null;
      return { papel: r.papel, nome: str(r.nome), rotulo: str(r.rotulo), tipo: typeof r.tipo === "string" ? r.tipo : null, autocomplete: typeof r.autocomplete === "string" ? r.autocomplete : null, editavel: r.editavel === true };
    },
    async url(s) { return str((await rodar(s, ["get", "url"])).url); },
    async camposDeLogin(s) {
      const r = obj((await rodar(s, ["eval", "-b", Buffer.from(JS_CAMPOS_LOGIN, "utf8").toString("base64")])).result);
      return { usuario: r.usuario === true, senha: r.senha === true, codigo: r.codigo === true };
    },
    // medido em 2026-11-20 (agent-browser 0.43.0, Chrome for Testing 156): o relay aceita `{action:"focus", selector}`
    // (ref `@e1` ou CSS) e `{action:"keyboard", subaction:"insertText", text}`; o texto entra inteiro no campo focado,
    // inclusive num type=password. O comando sai pelo corpo do POST local, nunca pelo argv.
    async inserirTexto(s, alvo, texto) {
      const porta = await portaDoStream(s);
      if (porta === null) throw new FalhaNavegador("indisponivel", "o navegador do bot não está aberto");
      if (alvo !== null && !(await relay(porta, { action: "focus", selector: alvoOuFalha(alvo) }).catch(() => false))) throw new FalhaNavegador("alvo_invalido", "não consegui focar o campo");
      if (!(await relay(porta, { action: "keyboard", subaction: "insertText", text: texto }).catch(() => false))) throw new FalhaNavegador("acao_falhou", "o campo não recebeu o texto");
    },
    // medido em 2026-11-20 (mesma bancada): `{action:"cookies_set", cookies:[{name,value,domain,path,secure,httpOnly,
    // sameSite,expires}]}` grava com os atributos (o Chrome corta a validade em ~400 dias).
    async definirCookies(s, cookies) {
      if (!cookies.length) return;
      const porta = await portaDoStream(s);
      if (porta === null) throw new FalhaNavegador("indisponivel", "o navegador do bot não está aberto");
      if (!(await relay(porta, { action: "cookies_set", cookies: cookies.map((c) => ({ ...c })) }).catch(() => false))) throw new FalhaNavegador("acao_falhou", "o navegador não aceitou os cookies");
    },
    portaDoStream,
    async tamanho(s, w, h) { await rodar(s, ["set", "viewport", String(Math.round(w)), String(Math.round(h))]); },
    async fechar(s) { await rodar(s, ["close"]).catch((e: unknown) => { if (!ehFalhaNavegador(e) || e.motivo === "indisponivel") throw e; }); },
    async limparCache(s) {
      const perfil = join(pasta(s), "perfil");
      for (const c of CACHES_DO_PERFIL) await rm(join(perfil, c), { recursive: true, force: true }).catch(() => undefined);
      return tamanhoDaPasta(pasta(s));
    },
    async apagarPerfil(s) { await rm(pasta(s), { recursive: true, force: true }); },
    espaco: (s) => tamanhoDaPasta(pasta(s)),
  };
}

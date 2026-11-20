import { spawnSync } from "node:child_process";
import { win32 } from "node:path";
import { invocarDoHook } from "../src/adapters/executor/drivers/claude-cli.ts";
import { acharGitBash, ehWindows, powershellDoSistema, RESPOSTA_DO_AUTOTESTE, resolverBinario, variavel, type Disco } from "../src/adapters/executor/plataforma.ts";

/**
 * ADA-11 (ADR-147): o que o motor muda quando roda no Windows nativo. A plataforma vai de verdade no anúncio e no
 * pareamento (antes era `linux` fixo), e o motor só sobe com o Git for Windows: sem o Git Bash o Claude Code não roda o
 * hook do nod, e a cerca sumiria em silêncio (risco 3 do plano).
 */
export type PlataformaDoMotor = "linux" | "win32";

export function plataformaDoMotor(plataforma: NodeJS.Platform = process.platform): PlataformaDoMotor {
  return ehWindows(plataforma) ? "win32" : "linux";
}

/**
 * Revisão do PR #642 (M4): o servidor que responde a sessão conhece o win32? Um servidor de antes da ADR-147 não manda
 * `plataformas` e trataria esta máquina como Mac; o motor do Windows não conecta nele (tenta de novo, como servidor fora).
 */
export function servidorAceitaPlataforma(dados: { plataformas?: unknown }, plataforma: NodeJS.Platform = process.platform): boolean {
  if (!ehWindows(plataforma)) return true;
  return Array.isArray(dados.plataformas) && dados.plataformas.includes("win32");
}

/** O código de saída do motor sem o Git for Windows (2 é chave/versão; 3 é "falta instalar algo nesta máquina"). */
export const SAIDA_SEM_GIT_FOR_WINDOWS = 3;

export const MENSAGEM_SEM_GIT_FOR_WINDOWS = "O nod no Windows precisa do Git for Windows (o Git Bash roda o hook que protege os comandos do bot).\nInstale com: winget install --id Git.Git -e\nDepois abra um terminal novo e rode o motor de novo.\n";

type Bash = (bash: string, script: string) => { status: number | null; stdout: string };
const bashDeVerdade: Bash = (bash, script) => {
  const r = spawnSync(bash, ["-c", script], { encoding: "utf8", timeout: 20_000, windowsHide: true });
  return { status: r.status, stdout: String(r.stdout ?? "") };
};

/**
 * No Windows: o Git Bash, o `git.exe` no PATH e o hook rodando por ele, do mesmo jeito que o Claude Code o chama
 * (`invocarDoHook` com caminhos em `/`). Devolve null quando está tudo certo, ou o motivo. Fora do Windows, sempre null.
 */
export function conferirGitForWindows(o: { plataforma?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>>; disco?: Disco; nodePath: string; hookPath: string; bash?: Bash }): string | null {
  if (!ehWindows(o.plataforma ?? process.platform)) return null;
  const env = o.env ?? process.env;
  const bash = acharGitBash({ env, ...(o.disco ? { disco: o.disco } : {}) });
  if (!bash) return "sem_git_bash";
  let git: ReturnType<typeof resolverBinario>;
  try {
    git = resolverBinario("git", { env, plataforma: "win32", ...(o.disco ? { disco: o.disco } : {}) });
  } catch {
    git = null;
  }
  if (!git) return "sem_git";
  const script = `${invocarDoHook({ nodePath: o.nodePath, hookPath: o.hookPath, windows: true })} autoteste`;
  const r = (o.bash ?? bashDeVerdade)(bash, script);
  return r.status === 0 && r.stdout.trim() === RESPOSTA_DO_AUTOTESTE ? null : "hook_nao_roda";
}

/** O Path da máquina e o do usuário como estão no registro agora (já expandidos); null no que não deu para ler. */
export type PathsDoRegistro = { maquina: string | null; usuario: string | null };

/**
 * Lê os dois Paths pelo .NET (o `GetValue` expande o REG_EXPAND_SZ) e devolve em JSON UTF-8: o `reg query` sai na
 * página OEM e estragaria uma pasta com acento (C:\Users\João).
 */
const lerPathsDeVerdade = (env: Readonly<Record<string, string | undefined>>): PathsDoRegistro => {
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; ConvertTo-Json -Compress @{ maquina = [Environment]::GetEnvironmentVariable('Path', 'Machine'); usuario = [Environment]::GetEnvironmentVariable('Path', 'User') }";
  const r = spawnSync(powershellDoSistema(env), ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 20_000, windowsHide: true });
  try {
    const lido = JSON.parse(String(r.stdout ?? "").replace(/^\uFEFF/, "").trim()) as { maquina?: unknown; usuario?: unknown };
    return { maquina: typeof lido.maquina === "string" ? lido.maquina : null, usuario: typeof lido.usuario === "string" ? lido.usuario : null };
  } catch {
    return { maquina: null, usuario: null };
  }
};

/** Uma pasta do Path como o Windows a compara: sem maiúscula e sem a `\` do fim. */
const chaveDaPasta = (pasta: string) => pasta.trim().replace(/\\+$/, "").toLowerCase();

/** Junta as listas de pastas na ordem dada, sem repetir (sem diferenciar maiúscula nem a `\` do fim). Puro. */
export function juntarPaths(...listas: (string | null | undefined)[]): string {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const lista of listas) {
    for (const bruta of (lista ?? "").split(";")) {
      const pasta = bruta.trim();
      const chave = chaveDaPasta(pasta);
      if (!chave || vistas.has(chave)) continue;
      vistas.add(chave);
      saida.push(pasta);
    }
  }
  return saida.join(";");
}

/**
 * No Windows, o Path do motor vem do registro de agora. A Tarefa Agendada sobe o motor com o ambiente que o serviço do
 * Agendador guardou no login: o Git, o Node e as IAs que o instalador acabou de pôr no Path do usuário só apareceriam
 * no próximo login, e o motor sairia com 3 (`sem_git`) logo depois da instalação. A ordem é a do Windows (máquina;
 * usuário); o que só o processo tinha fica no fim. Se ainda faltar o `git.exe` com o Git Bash achado na pasta padrão,
 * entra a `…\Git\cmd` dele. Muda o `env` (o `process.env` do motor) e devolve as pastas que entraram.
 */
export function atualizarPathNoWindows(o: { plataforma?: NodeJS.Platform; env?: Record<string, string | undefined>; disco?: Disco; lerPaths?: () => PathsDoRegistro } = {}): string[] {
  if (!ehWindows(o.plataforma ?? process.platform)) return [];
  const env = o.env ?? process.env;
  const nome = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "Path";
  const antes = variavel(env, "PATH", "win32") ?? "";
  const { maquina, usuario } = (o.lerPaths ?? (() => lerPathsDeVerdade(env)))();
  let novo = juntarPaths(maquina, usuario, antes);
  const disco = o.disco ? { disco: o.disco } : {};
  if (!resolverBinario("git", { env: { ...env, [nome]: novo }, plataforma: "win32", soExe: true, ...disco })) {
    const bash = acharGitBash({ env: { ...env, [nome]: novo }, ...disco });
    if (bash) novo = juntarPaths(novo, win32.join(win32.dirname(win32.dirname(bash)), "cmd"));
  }
  env[nome] = novo;
  const tinha = new Set(antes.split(";").map(chaveDaPasta));
  return novo.split(";").filter((p) => !tinha.has(chaveDaPasta(p)));
}

/**
 * ADA-32 (ADR-151): o comando que reinstala/atualiza o motor, como a pessoa o roda nesta plataforma. No Windows é o
 * `irm …/windows | iex` do PowerShell; no Linux, o `curl … | sh` de sempre (ADR-090).
 */
export function comandoDeReinstalar(url: string, plataforma: NodeJS.Platform = process.platform): string {
  return ehWindows(plataforma) ? `irm ${url}/windows | iex` : `curl -fsSL ${url}/motor | sh`;
}

/** O comando de parear de novo: `nod-motor` existe tanto na instalação manual quanto na feita pelo instalador. */
export function comandoDeParear(servidor: string, _plataforma: NodeJS.Platform = process.platform): string {
  return `nod-motor parear ${servidor}`;
}

/**
 * ADA-32: `parear --abrir` abre o link do pareamento no navegador padrão. Só no Windows (a máquina da pessoa, com tela),
 * pelo `explorer.exe` do sistema com caminho absoluto, e só para um link HTTP(S) já montado pelo motor. Fora do
 * Windows (VM sem tela) devolve null e o link só aparece no terminal.
 */
export function comandoParaAbrir(link: string, o: { plataforma?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>> } = {}): { exe: string; args: string[] } | null {
  if (!ehWindows(o.plataforma ?? process.platform)) return null;
  let u: URL;
  try { u = new URL(link); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const raiz = (o.env ?? process.env).SystemRoot ?? "C:\\Windows";
  return { exe: `${raiz.replace(/[\\/]+$/, "")}\\explorer.exe`, args: [u.href] };
}

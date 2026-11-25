import { existsSync, readdirSync } from "node:fs";
import { win32 } from "node:path";
import type { RecursosDoMac } from "../src/adapters/executor/navegador.ts";
import { comoRodar } from "../src/adapters/executor/plataforma.ts";
import { ambienteDoSistema } from "../src/adapters/navegador/motor-agent-browser.ts";
import { textosDoAparelho } from "../src/domain/navegador-cofre.ts";
import { criarCofresDoMac, executarDoCofre, type ExecutarDoCofre } from "./cofres-do-mac.ts";
import { cookiesDoChromeNoWindows, PRESOS_AO_CHROME } from "./cookies-do-chrome-windows.ts";
import { SEM_EXTENSAO, type PonteDoChrome } from "../src/adapters/executor/chrome-da-pessoa.ts";
import { FalhaNavegador } from "../src/adapters/navegador/motor-agent-browser.ts";
import type { CookieNavegador } from "../src/contracts/navegador-maquina.ts";

/**
 * "Trazer do meu Chrome" no PC (2026-11-23): pela extensão do nod no Chrome da pessoa quando ela está ligada (o caminho
 * que vale para o perfil do dia a dia, cifrado com a criptografia presa ao Chrome); sem ela, a leitura pela cópia do
 * perfil, que só serve aos cookies `v10` — e, esbarrando nos `v20`, o recado diz para instalar a extensão.
 */
export async function cookiesDoChromeDoPc(host: string, env: Readonly<Record<string, string | undefined>>, ponte: PonteDoChrome | null): Promise<CookieNavegador[]> {
  if (ponte?.conectada()) return ponte.cookies(host);
  try {
    return await cookiesDoChromeNoWindows({ host, env });
  } catch (e) {
    if ((e as { detalhe?: string }).detalhe === PRESOS_AO_CHROME) throw new FalhaNavegador("indisponivel", SEM_EXTENSAO);
    throw e;
  }
}

/**
 * Os cofres da pessoa no PC para o navegador do bot (2026-11-22: o navegador no Windows com tudo o que o Mac tem). A
 * lógica de listar, ler e guardar é a do Mac (cofres-do-mac.ts: o `op` e o `bw` por argv sem shell, a senha só por
 * stdin/stdout); aqui só o que é do Windows:
 *
 *  - o `op` (1Password CLI) do PATH, do WinGet ou de Arquivos de Programas, rodando só se a assinatura Authenticode for
 *    válida e da AgileBits (o par do `codesign` com o Team ID no Mac);
 *  - o `bw` (Bitwarden CLI) `.exe` ou o atalho `.cmd` do npm, que vira `node <script>` (sem o cmd.exe, CVE-2024-27980);
 *  - o "Trazer do meu Chrome" pelo próprio Chrome da pessoa (cookies-do-chrome-windows.ts);
 *  - a confirmação de pagar pelo Windows Hello (rosto, digital ou PIN); sem o Hello configurado, uma caixa do Windows com
 *    o mesmo motivo — a pessoa está no PC, que é o que a trava pede. Cancelar = não paga.
 *
 * Quem usa é o motor do Windows (motor/main.ts): no PC, o executor e o navegador do bot rodam no motor, não no app.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** O PowerShell do sistema (o 5.1, que fala com o WinRT do Windows Hello), pelo SystemRoot e nunca pelo PATH. */
export function powershellDoWindows(env: Env): string {
  const raiz = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return win32.join(raiz, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * O env do PowerShell do sistema: o do processo (o PowerShell 5.1 precisa de várias variáveis do Windows para carregar os
 * módulos, e com o mínimo o `Get-AuthenticodeSignature` não sobe — medido no runner), menos as do nod e tudo que tenha
 * cara de segredo. O que vem de fora (o caminho, o motivo) vai em `extra`.
 */
export function ambienteDoPowerShell(env: Env, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    // O PSModulePath fica de fora: herdado de um PowerShell 7 (pwsh), ele aponta para os módulos da versão 7, que o 5.1
    // não carrega ("Get-AuthenticodeSignature … the module could not be loaded", medido no runner). Sem ele, o 5.1 usa o seu.
    if (v === undefined || /^PSModulePath$/iu.test(k) || /^NOD_/iu.test(k) || /(KEY|TOKEN|SECRET|PASSWORD|SENHA|SESSION|DATABASE)/iu.test(k)) continue;
    saida[k] = v;
  }
  return { ...saida, ...extra };
}

/** O env que o `op`, o `bw` e o PowerShell precisam no Windows: as pastas do sistema e do usuário e o PATH; nada do nod. */
export function ambienteDoWindows(env: Env, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { ...ambienteDoSistema(env, "win32"), PATH: env.PATH ?? env.Path ?? "", ...extra };
}

/**
 * Roda o `op`/`bw` no Windows: um `.cmd` do npm vira `node <script>` (comoRodar), o `.exe` roda direto. O que não sabe
 * rodar sem o cmd.exe falha como "não rodou" (código -1), e o cofre trata como ausente.
 */
export function executarNoWindows(env: Env, executar: ExecutarDoCofre = executarDoCofre): ExecutarDoCofre {
  return async (bin, args, o) => {
    // O `.exe` já achado roda direto; o `.cmd` do npm vira `node <script>`.
    let alvo: { bin: string; args: string[] } | null;
    if (/\.exe$/iu.test(bin)) alvo = { bin, args: [] };
    else { try { alvo = comoRodar(bin, { env, plataforma: "win32" }); } catch { alvo = null; } }
    if (!alvo) return { codigo: -1, saida: "", erro: "não sei rodar este binário sem o cmd.exe", estourou: false };
    return executar(alvo.bin, [...alvo.args, ...args], o);
  };
}

/** Os lugares do `op.exe`: o PATH, o atalho do WinGet, os pacotes do WinGet e Arquivos de Programas. */
export function candidatosDoOp(env: Env, listar: (p: string) => string[] = (p) => { try { return readdirSync(p); } catch { return []; } }): string[] {
  const c: string[] = [];
  for (const d of (env.PATH ?? env.Path ?? "").split(";").map((p) => p.trim()).filter((p) => p && win32.isAbsolute(p))) c.push(win32.join(d, "op.exe"));
  if (env.LOCALAPPDATA) {
    c.push(win32.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "op.exe"));
    const pacotes = win32.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
    for (const p of listar(pacotes).filter((n) => /^AgileBits\.1Password\.CLI/iu.test(n))) c.push(win32.join(pacotes, p, "op.exe"));
  }
  for (const v of ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]) if (env[v]) c.push(win32.join(env[v]!, "1Password CLI", "op.exe"));
  return [...new Set(c)];
}

/** Os lugares do `bw`: `bw.exe` (WinGet, Scoop, Chocolatey, solto no PATH) e o `bw.cmd` do npm global. */
export function candidatosDoBw(env: Env): string[] {
  const c: string[] = [];
  const pastas = (env.PATH ?? env.Path ?? "").split(";").map((p) => p.trim()).filter((p) => p && win32.isAbsolute(p));
  for (const d of pastas) c.push(win32.join(d, "bw.exe"));
  if (env.LOCALAPPDATA) c.push(win32.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "bw.exe"));
  for (const d of pastas) c.push(win32.join(d, "bw.cmd"));
  if (env.APPDATA) c.push(win32.join(env.APPDATA, "npm", "bw.cmd"));
  return [...new Set(c)];
}

/**
 * A assinatura do `op.exe` é válida e da AgileBits (o `Get-AuthenticodeSignature` do Windows confere a cadeia). O caminho
 * vai por variável de ambiente, nunca dentro do comando: nada do disco vira código do PowerShell.
 */
export async function opDaAgileBitsNoWindows(caminho: string, env: Env, executar: ExecutarDoCofre = executarDoCofre): Promise<boolean> {
  const script = "$s = Get-AuthenticodeSignature -LiteralPath $env:NOD_ARQUIVO; [Console]::Out.Write($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)";
  const r = await executar(powershellDoWindows(env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { prazoMs: 30_000, env: ambienteDoPowerShell(env, { NOD_ARQUIVO: caminho }) });
  return r.codigo === 0 && assinaturaDaAgileBits(r.saida);
}

/**
 * "Valid|CN=Agilebits, O=Agilebits, S=Ontario, C=CA" (o op.exe oficial, medido no runner em 2026-11-22: sem "Inc." e
 * com o "b" minúsculo): válida (cadeia confiável do Windows) e emitida para a organização AgileBits, com ou sem "Inc.".
 */
export function assinaturaDaAgileBits(saida: string): boolean {
  const [status, sujeito] = saida.trim().split("|");
  return status === "Valid" && /(?:^|,\s*)O=AgileBits(?: Inc\.?)?(?:,|$)/iu.test(sujeito ?? "");
}

/**
 * O Windows Hello pelo WinRT (`UserConsentVerifier`) no PowerShell 5.1. Com o Hello pronto, a pessoa confirma com o rosto,
 * a digital ou o PIN; sem ele (não configurado, sem sensor), a caixa do Windows com o motivo e OK/Cancelar. O motivo vai
 * por variável de ambiente (nunca dentro do script). A saída é "hello:<resultado>" ou "caixa:<botão>".
 */
export const SCRIPT_DO_WINDOWS_HELLO = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]",
  "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  "function Esperar($Operacao, [Type]$Tipo) { $t = $asTask.MakeGenericMethod($Tipo).Invoke($null, @($Operacao)); $null = $t.Wait(-1); return $t.Result }",
  "$disponivel = 'Indisponivel'",
  "try { $disponivel = [string](Esperar ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])) } catch { $disponivel = 'Erro' }",
  // Só a prova da CI (tests/windows): o WinRT carrega no PowerShell 5.1 e responde, sem abrir nada na tela.
  "if ($env:NOD_SO_CHECAR -eq '1') { [Console]::Out.Write('disponivel:' + $disponivel); return }",
  "if ($disponivel -eq 'Available') {",
  "  $r = Esperar ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:NOD_MOTIVO)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])",
  "  [Console]::Out.Write('hello:' + [string]$r)",
  "} else {",
  "  Add-Type -AssemblyName System.Windows.Forms",
  "  $b = [System.Windows.Forms.MessageBox]::Show($env:NOD_MOTIVO, 'nod: o navegador do bot pede a sua confirmação', 'OKCancel', 'Question', 'Button2', 'DefaultDesktopOnly')",
  "  [Console]::Out.Write('caixa:' + [string]$b)",
  "}",
].join("\n");

/** A resposta do script: só "hello:Verified" e "caixa:OK" confirmam; o resto (cancelou, falhou, demorou) é não. */
export function confirmouNoWindows(saida: string): boolean {
  const s = saida.trim();
  return s === "hello:Verified" || s === "caixa:OK";
}

/** definido em 2026-11-22: a confirmação espera a pessoa até 90 s (o mesmo prazo de ler um cofre). */
const PRAZO_CONFIRMAR_MS = 90_000;

export async function confirmarNoWindows(motivo: string, env: Env, executar: ExecutarDoCofre = executarDoCofre): Promise<boolean> {
  const r = await executar(powershellDoWindows(env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT_DO_WINDOWS_HELLO], { prazoMs: PRAZO_CONFIRMAR_MS, env: ambienteDoPowerShell(env, { NOD_MOTIVO: motivo.slice(0, 200) }) });
  return r.codigo === 0 && !r.estourou && confirmouNoWindows(r.saida);
}

export type OpcoesCofresDoWindows = {
  env: Env;
  /** O processo sem shell (o teste passa `op`/`bw`/PowerShell falsos). */
  executar?: ExecutarDoCofre;
  existe?: (p: string) => boolean;
  /** A sessão destravada do Bitwarden (BW_SESSION); null = travado. */
  sessaoBitwarden?: () => string | null;
  /** Os cookies do Chrome (padrão: o Chrome da pessoa, cookies-do-chrome-windows.ts). */
  cookies?: RecursosDoMac["cookiesDoChrome"];
  /** A confirmação (padrão: o Windows Hello, ou a caixa). */
  confirmar?: (motivo: string) => Promise<boolean>;
};

export function criarCofresDoWindows(o: OpcoesCofresDoWindows): RecursosDoMac {
  const env = o.env;
  const executar = executarNoWindows(env, o.executar);
  const cru = o.executar ?? executarDoCofre;
  const existe = o.existe ?? existsSync;
  const textos = textosDoAparelho("pc");
  const assinaturas = new Map<string, boolean>();
  return criarCofresDoMac({
    home: env.USERPROFILE ?? "",
    executar,
    // A assinatura de cada op.exe é conferida uma vez por processo (o PowerShell leva ~1 s, e a lista do cartão tem 4 s).
    acharOp: async () => {
      for (const c of candidatosDoOp(env)) {
        if (!existe(c)) continue;
        let ok = assinaturas.get(c);
        if (ok === undefined) { ok = await opDaAgileBitsNoWindows(c, env, cru); assinaturas.set(c, ok); }
        if (ok) return c;
      }
      return null;
    },
    acharBw: async () => candidatosDoBw(env).find((c) => existe(c)) ?? null,
    sessaoBitwarden: o.sessaoBitwarden ?? (() => env.BW_SESSION ?? null),
    touchId: o.confirmar ?? ((motivo) => confirmarNoWindows(motivo, env, cru)),
    plataforma: {
      ambiente: (extra = {}) => ambienteDoWindows(env, extra),
      pastaDoBitwarden: win32.join(env.APPDATA ?? win32.join(env.USERPROFILE ?? "", "AppData", "Roaming"), "Bitwarden CLI"),
      cookies: o.cookies ?? ((host) => cookiesDoChromeNoWindows({ host, env })),
      onde: "neste PC",
      bitwardenTravado: textos.bitwardenTravado,
    },
  });
}

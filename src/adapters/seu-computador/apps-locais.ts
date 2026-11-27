import { execFile } from "node:child_process";
import type { AppDoComputador } from "../../contracts/seu-computador.ts";
import { idDeAppValido, type PlataformaPessoa } from "../../domain/seu-computador.ts";
import { powershellDoSistema } from "../executor/plataforma.ts";

/**
 * Os apps do computador da pessoa (ADR-197), sem o cua-driver: em modo `bounded` o `list_apps` dele é recusado (olha a
 * tela inteira), e é aqui que o nome que o bot disse vira o bundle (Mac) ou o executável (Windows) que entra no
 * manifesto. Mac: um JXA com o NSWorkspace (abertos) e as pastas de apps (instalados), sem pedir permissão nenhuma.
 * Windows: o PowerShell do sistema, com os processos de janela e os atalhos do Menu Iniciar.
 */
export type AppLocal = AppDoComputador & { aberto: boolean; pid: number | null; /** O outro nome do app (no Mac, o do arquivo: "TextEdit" para "Editor de Texto"). */ apelido?: string };

export type ExecutarTexto = (bin: string, args: readonly string[], prazoMs: number) => Promise<string>;

const executarPadrao: ExecutarTexto = (bin, args, prazoMs) => new Promise((resolver, rejeitar) => {
  execFile(bin, [...args], { timeout: prazoMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: "utf8" }, (erro, saida) => (erro ? rejeitar(erro) : resolver(saida)));
});

/** JXA: abertos (regulares, com Dock) + instalados nas pastas de apps (até dois níveis). Uma linha JSON. */
export const SCRIPT_APPS_MAC = `
ObjC.import('AppKit');
var ws = $.NSWorkspace.sharedWorkspace;
var fm = $.NSFileManager.defaultManager;
var saida = {};
var abertos = ws.runningApplications;
for (var i = 0; i < abertos.count; i++) {
  var a = abertos.objectAtIndex(i);
  if (Number(a.activationPolicy) !== 0) continue;
  var id = ObjC.unwrap(a.bundleIdentifier);
  if (!id) continue;
  var url = a.bundleURL ? ObjC.unwrap(a.bundleURL.lastPathComponent) : '';
  saida[id] = { id: id, nome: ObjC.unwrap(a.localizedName) || id, aberto: true, pid: Number(a.processIdentifier), apelido: String(url || '').replace(/\\.app$/, '') };
}
var home = ObjC.unwrap($.NSHomeDirectory());
var pastas = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', home + '/Applications'];
function olhar(pasta, nivel) {
  var itens = fm.contentsOfDirectoryAtPathError(pasta, null);
  if (!itens) return;
  for (var j = 0; j < itens.count; j++) {
    var n = ObjC.unwrap(itens.objectAtIndex(j));
    var caminho = pasta + '/' + n;
    if (/\\.app$/.test(n)) {
      var b = $.NSBundle.bundleWithPath(caminho);
      if (!b) continue;
      var id2 = ObjC.unwrap(b.bundleIdentifier);
      if (!id2 || saida[id2]) continue;
      var nome = ObjC.unwrap(fm.displayNameAtPath(caminho)).replace(/\\.app$/, '');
      saida[id2] = { id: id2, nome: nome, aberto: false, pid: null, apelido: n.replace(/\\.app$/, '') };
    } else if (nivel < 1 && n.indexOf('.') !== 0) {
      var ehPasta = Ref();
      if (fm.fileExistsAtPathIsDirectory(caminho, ehPasta) && ehPasta[0]) olhar(caminho, nivel + 1);
    }
  }
}
for (var k = 0; k < pastas.length; k++) olhar(pastas[k], 0);
var lista = [];
for (var c in saida) lista.push(saida[c]);
JSON.stringify(lista);
`;

/**
 * PowerShell: processos com janela (o caminho do .exe e o título do produto) e os atalhos .lnk do Menu Iniciar (da
 * pessoa e de todos) que apontam para um .exe. Uma linha JSON.
 */
export const SCRIPT_APPS_WINDOWS = `
$ErrorActionPreference = 'SilentlyContinue'
$saida = @{}
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path } | ForEach-Object {
  $nome = $_.MainModule.FileVersionInfo.FileDescription
  if (-not $nome) { $nome = $_.ProcessName }
  $saida[$_.Path.ToLower()] = @{ id = $_.Path; nome = $nome; aberto = $true; pid = $_.Id }
}
$sh = New-Object -ComObject WScript.Shell
$pastas = @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs")
foreach ($p in $pastas) {
  Get-ChildItem -Path $p -Filter *.lnk -Recurse | ForEach-Object {
    $alvo = $sh.CreateShortcut($_.FullName).TargetPath
    if ($alvo -and $alvo.ToLower().EndsWith('.exe') -and (Test-Path $alvo)) {
      $k = $alvo.ToLower()
      if ($saida.ContainsKey($k)) { if (-not $saida[$k].atalho) { $saida[$k].nome = $_.BaseName; $saida[$k].atalho = $true } }
      else { $saida[$k] = @{ id = $alvo; nome = $_.BaseName; aberto = $false; pid = $null; atalho = $true } }
    }
  }
}
@($saida.Values | ForEach-Object { [pscustomobject]@{ id = $_.id; nome = $_.nome; aberto = $_.aberto; pid = $_.pid } }) | ConvertTo-Json -Compress -Depth 3
`;

/** Converte e confere o que o script devolveu (formas estranhas saem; o id tem de ser do formato do sistema). */
export function lerApps(json: string, plataforma: PlataformaPessoa): AppLocal[] {
  let cru: unknown;
  try { cru = JSON.parse(json.trim() || "[]"); } catch { return []; }
  const lista = Array.isArray(cru) ? cru : cru && typeof cru === "object" ? [cru] : [];
  const saem: AppLocal[] = [];
  for (const v of lista) {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !idDeAppValido(o.id, plataforma)) continue;
    const nome = typeof o.nome === "string" && o.nome.trim() ? o.nome.trim().slice(0, 120) : o.id;
    const apelido = typeof o.apelido === "string" && o.apelido.trim() && o.apelido.trim() !== nome ? o.apelido.trim().slice(0, 120) : undefined;
    saem.push({ id: o.id, nome, aberto: o.aberto === true, pid: typeof o.pid === "number" && Number.isSafeInteger(o.pid) && o.pid > 0 ? o.pid : null, ...(apelido ? { apelido } : {}) });
  }
  return saem.sort((a, b) => Number(b.aberto) - Number(a.aberto) || a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function listarAppsLocais(plataforma: PlataformaPessoa, o: { executar?: ExecutarTexto; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<AppLocal[]> {
  const executar = o.executar ?? executarPadrao;
  if (plataforma === "darwin") return lerApps(await executar("/usr/bin/osascript", ["-l", "JavaScript", "-e", SCRIPT_APPS_MAC], 15_000), plataforma);
  const ps = powershellDoSistema(o.env ?? process.env);
  return lerApps(await executar(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT_APPS_WINDOWS], 30_000), plataforma);
}

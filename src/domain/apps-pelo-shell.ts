import { semPadraoDeBusca } from "./comando.ts";

/**
 * Os apps da pessoa pelo terminal (ADR-197, item 7; achado 2 do QA da rc.15 no Windows). No Mac e no Windows o motor
 * roda o Claude/Codex como a própria pessoa, na sessão gráfica dela: sem esta cerca, o Bash abria o Gerenciador de
 * Credenciais (`control.exe /name Microsoft.CredentialManager`) e o Bloco de Notas (`notepad.exe`) sem cartão, ilha nem
 * borda, e os bloqueios de `seu-computador.ts` valiam só para o manifesto do cua-driver. Medido em 2026-11-26 no QA da
 * rc.15 (Windows Server, motor rc.15, Claude): os dois apps abriram na frente, com o shell do bot como pai.
 *
 * Regra: na máquina da pessoa (darwin/win32), abrir ou controlar app de desktop pelo shell nunca passa — vai por
 * `seu_computador_*`, com cartão, ou para a pessoa. O que é sensível (senhas, cofre, ajustes, registro, o nod) nem
 * por lá. O terminal segue útil para o resto: git, npm, node e arquivos.
 *
 * Linux fica de fora: lá o motor roda numa máquina do bot (ADR-090), não na sessão gráfica da pessoa.
 * Domínio puro: só texto, sem processo nem disco. Fail-closed por desenho: na dúvida (programa no começo de um trecho
 * do comando, com caminho, aspas ou `.exe`), o nome casa.
 */

export const FRASE_APP_PELO_SHELL = "abrir ou controlar apps do computador da pessoa pelo terminal não é permitido (sem cartão, sem ilha, sem borda). Para um app dela, use as ferramentas seu_computador_* (com o cartão de permissão); sem elas, peça para a pessoa abrir. O terminal segue liberado para git, npm, node e arquivos";
export const FRASE_SENSIVEL_PELO_SHELL = "senhas, cofre e gerenciador de credenciais, ajustes do sistema, registro, terminais e o próprio nod ficam sempre de fora do nod, também pelo terminal. Não tente por outro caminho: peça para a pessoa fazer esta parte";

type Regra = { nomes: readonly string[]; sensivel: boolean };

/** Windows: programas pelo nome, sem `.exe` (comparação sem maiúsculas, com ou sem caminho). */
const WINDOWS: readonly Regra[] = [
  {
    sensivel: true,
    nomes: [
      "control", "cmdkey", "vaultcmd", "credwiz", "keymgr", "rundll32", "regedit", "regedt32", "systemsettings", "mmc",
      "taskmgr", "secpol", "gpedit", "certmgr", "lusrmgr", "netplwiz", "useraccountcontrolsettings", "runas", "sudo",
      "1password", "bitwarden", "keepass", "keepassxc", "lastpass", "dashlane", "enpass", "nordpass", "roboform",
      "keeperpasswordmanager", "protonpass",
      "windowsterminal", "wt", "conhost", "openconsole", "mintty", "git-bash",
      "nod", "nod-motor",
    ],
  },
  {
    sensivel: false,
    nomes: [
      "start", "start-process", "saps", "invoke-item", "ii", "explorer", "mshta", "wscript", "cscript",
      "notepad", "mspaint", "pbrush", "calc", "wordpad", "write", "winword", "excel", "powerpnt", "outlook", "onenote",
      "msedge", "chrome", "firefox", "iexplore", "snippingtool", "magnify", "osk",
    ],
  },
];

/** Mac: programas pelo nome (o `open` cobre `open -a`, `open x.pdf` e `open https://…`). */
const MAC: readonly Regra[] = [
  { sensivel: true, nomes: ["security", "osascript", "automator", "nod"] },
  { sensivel: false, nomes: ["open", "shortcuts"] },
];

/** Em qualquer ponto do comando (URI, DLL, app do sistema): o texto já sem padrão de busca nem mensagem de commit. */
const EM_QUALQUER_PONTO_WINDOWS: readonly RegExp[] = [
  /\bms-settings:/, /\bkeymgr(?:\.dll)?\b/, /\bmicrosoft\.credentialmanager\b/, /\bshell:::?\{/, /\.cpl\b/, /\.msc\b/,
  /\[\s*(?:system\.)?diagnostics\.process\s*\]\s*::\s*start\b/, /\bnew-object\s+-comobject\s+(?:wscript\.shell|shell\.application)\b/,
  /\bpasswordvault\b/, /\bcredentialmanager\b/, /\bget-storedcredential\b/,
];
const EM_QUALQUER_PONTO_MAC: readonly RegExp[] = [
  /\bx-apple\.systempreferences:/, /\/system\/library\/preferencepanes\b/, /\.prefpane\b/, /\bkeychain(?:s|access)?\b/,
  /\.app\/contents\/macos\//, /\bsystem events\b/, /\bapp\.nod\.desktop\b/,
];

/**
 * Onde um programa começa: o início do comando ou de um trecho (`;`, `&`, `|`, `(`, `{`, nova linha, crase, `$(`), ou
 * depois do que manda executar texto (`cmd /c`, `cmd //c` do Git Bash, `-c`, `-command`, `-encodedcommand` fica com a
 * cerca do git). Aspas e o `&` de chamada do PowerShell são aceitos antes do nome; `call`, `exec`, `nohup`, `env` e
 * `command` também.
 */
const INICIO = String.raw`(?:^|[;&|({\n\x60]|\$\(|\s/{1,2}[ck]\s|\s-(?:c|command|e)\s)`;
const PREFIXOS = String.raw`(?:\s*(?:@|call\s+|exec\s+|nohup\s+|env\s+|command\s+|&\s*|["']))*\s*`;
// Entre aspas o caminho pode ter espaço (`"C:/Program Files/Bitwarden/Bitwarden.exe"`).
const CAMINHO = String.raw`(?:(?<=["'])[^"'\n|;&]*/|(?:[a-z]:)?(?:[^\s"'|;&()]*/)?)`;
const FIM = String.raw`(?:\.(?:exe|com|bat|cmd|lnk|app))?(?=$|[\s"'|;&()\x60,])`;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
function regexDosNomes(nomes: readonly string[]): RegExp {
  return new RegExp(`${INICIO}${PREFIXOS}${CAMINHO}(?:${nomes.map(escapar).join("|")})${FIM}`);
}

const REGRAS = {
  win32: { sensiveis: regexDosNomes(WINDOWS.filter((r) => r.sensivel).flatMap((r) => r.nomes)), apps: regexDosNomes(WINDOWS.filter((r) => !r.sensivel).flatMap((r) => r.nomes)), qualquer: EM_QUALQUER_PONTO_WINDOWS },
  darwin: { sensiveis: regexDosNomes(MAC.filter((r) => r.sensivel).flatMap((r) => r.nomes)), apps: regexDosNomes(MAC.filter((r) => !r.sensivel).flatMap((r) => r.nomes)), qualquer: EM_QUALQUER_PONTO_MAC },
} as const;

/** O texto comparável: minúsculas, `\` vira `/`, o `^` de escape do cmd sai, sem padrão de busca nem mensagem de commit. */
function normalizar(comando: string): string {
  return semPadraoDeBusca(comando).toLowerCase().replace(/\\/g, "/").replace(/\^/g, "");
}

/**
 * Por que este comando não roda na máquina da pessoa: null = passa (segue para o servidor como sempre); texto = o
 * motivo que o modelo lê. `plataforma` é a do processo do hook (`process.platform`), nunca a que o modelo diz.
 */
export function motivoAppPeloShell(comando: string, plataforma: string): string | null {
  if (plataforma !== "win32" && plataforma !== "darwin") return null;
  const r = REGRAS[plataforma];
  const texto = normalizar(comando);
  if (r.sensiveis.test(texto) || r.qualquer.some((x) => x.test(texto))) return FRASE_SENSIVEL_PELO_SHELL;
  if (r.apps.test(texto)) return FRASE_APP_PELO_SHELL;
  return null;
}

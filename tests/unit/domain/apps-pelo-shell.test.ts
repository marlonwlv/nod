import { describe, expect, it } from "vitest";
import { FRASE_APP_PELO_SHELL, FRASE_SENSIVEL_PELO_SHELL, motivoAppPeloShell } from "../../../src/domain/apps-pelo-shell.ts";
import { decidirNativa } from "../../../src/domain/nativas.ts";
import { BLOQUEADOS_WINDOWS, motivoDoBloqueio } from "../../../src/domain/seu-computador.ts";
import { linhaAppsPeloTerminal } from "../../../src/domain/prompt-sistema.ts";

const win = (c: string) => motivoAppPeloShell(c, "win32");
const mac = (c: string) => motivoAppPeloShell(c, "darwin");

describe("apps da pessoa pelo terminal (achado 2 do QA da rc.15, ADR-197 item 7)", () => {
  it("Windows: o cofre, os ajustes e o registro nunca passam — com maiúscula, caminho absoluto, aspas e cmd /c start", () => {
    const sensiveis = [
      // Os dois caminhos do achado e os vizinhos.
      "control.exe /name Microsoft.CredentialManager",
      "CONTROL /name Microsoft.CredentialManager",
      "C:\\Windows\\System32\\control.exe keymgr.dll",
      "\"C:\\Windows\\System32\\control.exe\" /name Microsoft.CredentialManager",
      "& 'C:/Windows/System32/control.exe' /name Microsoft.CredentialManager",
      "control",
      "rundll32 keymgr.dll,KRShowKeyMgr",
      "RunDll32.EXE keymgr.dll,KRShowKeyMgr",
      "C:\\Windows\\System32\\rundll32.exe shell32.dll,Control_RunDLL",
      "cmdkey /list",
      "CmdKey.exe /list",
      "cd C:\\tmp && cmdkey /list",
      "vaultcmd /listcreds:\"Windows Credentials\"",
      "credwiz",
      "start ms-settings:",
      "cmd /c start ms-settings:privacy",
      "cmd.exe /C \"start ms-settings:\"",
      "cmd //c start ms-settings:",
      "explorer.exe ms-settings:",
      "Start-Process 'ms-settings:'",
      "powershell -Command \"Start-Process control.exe -ArgumentList '/name Microsoft.CredentialManager'\"",
      "regedit",
      "regedit.exe /s chave.reg",
      "Get-StoredCredential -Target github",
      "[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]",
      "mmc certmgr.msc",
      "start inetcpl.cpl",
      "explorer shell:::{1206F5F1-0569-412C-8FEC-3204630DFB70}",
      "\"C:\\Program Files\\Bitwarden\\Bitwarden.exe\"",
      "C:/Users/x/AppData/Local/Programs/nod/nod.exe",
      "nod-motor --parar",
      "wt.exe",
      "taskmgr",
      "runas /user:Administrator cmd",
    ];
    for (const c of sensiveis) expect(win(c), c).toBe(FRASE_SENSIVEL_PELO_SHELL);
  });

  it("Windows: abrir app de desktop pelo shell vai para seu_computador_* ou para a pessoa", () => {
    const apps = [
      "notepad.exe C:\\Users\\pessoa\\nod\\bot\\teste-qa-rc15.txt",
      "Notepad teste.txt",
      "C:\\Windows\\System32\\notepad.exe teste.txt",
      "C:\\WINDOWS\\SYSTEM32\\NOTEPAD.EXE",
      "echo oi > a.txt && notepad a.txt",
      "echo oi > a.txt; notepad a.txt",
      "start notepad",
      "START \"\" \"C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE\"",
      "cmd /c start notepad",
      "cmd.exe /c \"start notepad a.txt\"",
      "cmd //c start notepad",
      "Start-Process notepad.exe",
      "start-process -FilePath 'mspaint'",
      "saps calc",
      "powershell -NoProfile -Command \"Start-Process 'notepad.exe'\"",
      "pwsh -c \"Invoke-Item .\\relatorio.pdf\"",
      "ii relatorio.xlsx",
      "explorer .",
      "explorer.exe C:\\Users",
      "[System.Diagnostics.Process]::Start('notepad.exe')",
      "$s = New-Object -ComObject WScript.Shell; $s.SendKeys('x')",
      "wscript abre.vbs",
      "mspaint",
      "calc",
      "msedge https://example.com",
      "x=$(notepad a.txt)",
    ];
    for (const c of apps) expect(win(c), c).not.toBeNull();
    expect(win("notepad.exe a.txt")).toBe(FRASE_APP_PELO_SHELL);
    expect(win("cmd /c start notepad")).toBe(FRASE_APP_PELO_SHELL);
  });

  it("Windows: o terminal segue útil — git, npm, node, arquivos e textos que só citam os nomes", () => {
    const livres = [
      "git status",
      "git -C C:\\Users\\x\\nod\\bot\\repo log --oneline -5",
      "git commit -s -m \"start: abrir o notepad pelo driver\"",
      "npm start",
      "npm run start",
      "npm ci && npm run test:unit",
      "node scripts/start.js",
      "node -e \"console.log(1)\"",
      "gh pr list -R dono/repo",
      "ls C:\\Users\\x\\nod\\bot",
      "cat notas/control-de-versao.md",
      "rg \"ms-settings:\" src",
      "rg cmdkey docs",
      "mkdir relatorios && cd relatorios",
      "Get-ChildItem C:\\Users\\x\\nod\\bot",
      "python -m http.server 8000",
      "echo controle > a.txt",
      "type explorer-notes.txt",
      "dir C:\\Users\\x\\Documents",
    ];
    for (const c of livres) expect(win(c), c).toBeNull();
  });

  it("Mac: open, osascript, Keychain e Ajustes do Sistema nunca passam; git e npm passam", () => {
    for (const c of [
      "security find-generic-password -s github -w",
      "/usr/bin/security dump-keychain",
      "osascript -e 'tell application \"Numbers\" to activate'",
      "OSASCRIPT -e 'tell application \"System Events\" to keystroke \"a\"'",
      "open x-apple.systempreferences:com.apple.preference.security",
      "open /System/Library/PreferencePanes/Security.prefPane",
      "open -a \"Keychain Access\"",
      "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
      "automator fluxo.workflow",
    ]) expect(mac(c), c).toBe(FRASE_SENSIVEL_PELO_SHELL);
    for (const c of ["open -a Numbers", "open relatorio.pdf", "open https://example.com", "/usr/bin/open -a TextEdit", "cd ~/nod/bot && open .", "bash -c \"open -a Notes\"", "shortcuts run Foco"]) expect(mac(c), c).toBe(FRASE_APP_PELO_SHELL);
    for (const c of ["git status", "npm run test:unit", "gh pr view 12", "ls ~/nod/bot", "git commit -s -m \"open: abrir o Numbers\"", "rg osascript src", "node scripts/open-report.js", "cat ~/nod/bot/notas.md"]) expect(mac(c), c).toBeNull();
  });

  it("Linux (máquina do bot, ADR-090) e plataforma desconhecida ficam sem a cerca", () => {
    expect(motivoAppPeloShell("xdg-open a.pdf", "linux")).toBeNull();
    expect(motivoAppPeloShell("open a.pdf", "linux")).toBeNull();
    expect(motivoAppPeloShell("notepad a.txt", "freebsd")).toBeNull();
  });

  it("decidirNativa nega o Bash e o Monitor na máquina da pessoa, antes do servidor; sem plataforma, segue como antes", () => {
    for (const ferramenta of ["Bash", "Monitor"]) {
      expect(decidirNativa({ ferramenta, entrada: { command: "control.exe /name Microsoft.CredentialManager" }, plataforma: "win32" })).toEqual({ permitir: false, motivo: FRASE_SENSIVEL_PELO_SHELL, contamina: false });
      expect(decidirNativa({ ferramenta, entrada: { command: "open -a Numbers" }, plataforma: "darwin" })).toEqual({ permitir: false, motivo: FRASE_APP_PELO_SHELL, contamina: false });
      expect(decidirNativa({ ferramenta, entrada: { command: "git status" }, plataforma: "win32" })).toMatchObject({ permitir: true, comando: "git status" });
    }
    expect(decidirNativa({ ferramenta: "Bash", entrada: { command: "control.exe" }, plataforma: "linux" })).toMatchObject({ permitir: true, comando: "control.exe" });
    expect(decidirNativa({ ferramenta: "Bash", entrada: { command: "control.exe" } })).toMatchObject({ permitir: true, comando: "control.exe" });
  });

  it("BLOQUEADOS_WINDOWS cobre o cofre por fora do control.exe; o Explorer segue liberável pelo driver", () => {
    for (const exe of ["rundll32.exe", "credwiz.exe", "cmdkey.exe", "vaultcmd.exe", "regedt32.exe", "mshta.exe", "wscript.exe"]) expect(BLOQUEADOS_WINDOWS, exe).toContain(exe);
    expect(motivoDoBloqueio({ id: "C:\\Windows\\System32\\RUNDLL32.EXE", nome: "rundll32" }, "win32")).not.toBeNull();
    expect(motivoDoBloqueio({ id: "C:\\Windows\\explorer.exe", nome: "Explorador de Arquivos" }, "win32")).toBeNull();
  });

  it("a linha do prompt manda para seu_computador_* ou para a pessoa, com os exemplos da plataforma", () => {
    expect(linhaAppsPeloTerminal("PC")).toContain("seu_computador_*");
    expect(linhaAppsPeloTerminal("PC")).toContain("cmdkey");
    expect(linhaAppsPeloTerminal("Mac")).toContain("osascript");
    expect(linhaAppsPeloTerminal("Mac")).not.toContain("cmdkey");
  });
});

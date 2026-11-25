import { describe, expect, it } from "vitest";
import { AGENT_BROWSER_DA_MAQUINA, agentBrowserDoWindows, chromeDoWindows } from "../../../src/adapters/executor/navegador.ts";
import { ambienteDoSistema, nomeDoBinario } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { scriptDeInstalacaoWindows } from "../../../src/adapters/http/motor-instalacao-windows.ts";
import { AGENT_BROWSER_DO_MOTOR } from "../../../src/adapters/http/motor-instalacao.ts";
import { ambienteDoPowerShell, assinaturaDaAgileBits, candidatosDoBw, candidatosDoOp, confirmarNoWindows, confirmouNoWindows, criarCofresDoWindows, opDaAgileBitsNoWindows, powershellDoWindows, SCRIPT_DO_WINDOWS_HELLO } from "../../../desktop/cofres-do-windows.ts";
import { cookiesDoCdpParaOHost, googleChromeDoWindows } from "../../../desktop/cookies-do-chrome-windows.ts";
import type { ExecutarDoCofre } from "../../../desktop/cofres-do-mac.ts";

/**
 * 2026-11-22 (o navegador no PC, com tudo o que o Mac tem): as peças do Windows com programas falsos. A prova com o
 * agent-browser, o Chrome e o PowerShell de verdade é tests/windows/navegador-windows.test.ts, no runner Windows da CI.
 */
const ENV = {
  SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\ana", APPDATA: "C:\\Users\\ana\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local",
  ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", TEMP: "C:\\Users\\ana\\AppData\\Local\\Temp",
  PATH: "C:\\Windows\\System32;C:\\Tools", NOD_CREDENTIAL_KEY: "nao-pode-vazar", DATABASE_URL: "postgres://segredo",
};

describe("onde estão as coisas no PC", () => {
  it("o Chrome do sistema, senão o Edge; o Google Chrome dos cookies é só o Chrome", () => {
    const chromeUsuario = "C:\\Users\\ana\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(chromeDoWindows(ENV, (p) => p === chromeUsuario || p === edge)).toBe(chromeUsuario);
    expect(chromeDoWindows(ENV, (p) => p === edge)).toBe(edge);
    expect(chromeDoWindows(ENV, () => false)).toBeNull();
    expect(googleChromeDoWindows(ENV, (p) => p === edge)).toBeNull();
  });

  it("o agent-browser que a instalação pôs em <pasta do nod>\\navegador, achado pela pasta do motor", () => {
    const exe = "C:\\Users\\ana\\AppData\\Local\\nod\\navegador\\node_modules\\@agent-browser\\cli-win32-x64-msvc\\bin\\agent-browser.exe";
    expect(agentBrowserDoWindows({ ...ENV, LOCALAPPDATA: undefined }, "C:\\Users\\ana\\AppData\\Local\\nod\\motor\\app", (p) => p === exe)).toBe(exe);
    expect(agentBrowserDoWindows(ENV, null, (p) => p === exe)).toBe(exe);
    expect(agentBrowserDoWindows({ ...ENV, NOD_AGENT_BROWSER: "D:\\ab.exe" }, null, (p) => p === "D:\\ab.exe")).toBe("D:\\ab.exe");
    expect(agentBrowserDoWindows(ENV, null, () => false)).toBeNull();
    expect(nomeDoBinario("win32")).toBe("agent-browser.exe");
    expect(nomeDoBinario("darwin")).toBe("agent-browser");
  });

  it("o ambiente do Chrome no Windows leva as pastas do sistema e nada do nod", () => {
    const amb = ambienteDoSistema(ENV, "win32");
    expect(amb).toMatchObject({ SystemRoot: "C:\\Windows", LOCALAPPDATA: ENV.LOCALAPPDATA, USERPROFILE: ENV.USERPROFILE, TEMP: ENV.TEMP });
    expect(Object.keys(amb)).not.toContain("NOD_CREDENTIAL_KEY");
    expect(Object.keys(amb)).not.toContain("DATABASE_URL");
    expect(ambienteDoSistema({ TMPDIR: "/tmp/x", SystemRoot: "C:\\Windows" }, "darwin")).toEqual({ TMPDIR: "/tmp/x" });
  });

  it("o op e o bw nos lugares do Windows (PATH, WinGet, Arquivos de Programas, npm global)", () => {
    const op = candidatosDoOp(ENV, (p) => (p.endsWith("Packages") ? ["AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe", "Outro.Pacote"] : []));
    expect(op).toContain("C:\\Tools\\op.exe");
    expect(op).toContain("C:\\Users\\ana\\AppData\\Local\\Microsoft\\WinGet\\Links\\op.exe");
    expect(op).toContain("C:\\Users\\ana\\AppData\\Local\\Microsoft\\WinGet\\Packages\\AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe\\op.exe");
    expect(op).toContain("C:\\Program Files\\1Password CLI\\op.exe");
    expect(op.some((c) => c.includes("Outro.Pacote"))).toBe(false);
    const bw = candidatosDoBw(ENV);
    expect(bw.indexOf("C:\\Tools\\bw.exe")).toBeLessThan(bw.indexOf("C:\\Users\\ana\\AppData\\Roaming\\npm\\bw.cmd"));
  });
});

describe("a assinatura do op e a confirmação", () => {
  it("só a assinatura válida emitida para a AgileBits passa; o caminho vai por variável, não no comando", async () => {
    expect(assinaturaDaAgileBits("Valid|CN=AgileBits Inc., O=AgileBits Inc., L=Toronto, S=Ontario, C=CA")).toBe(true);
    expect(assinaturaDaAgileBits("Valid|CN=Agilebits, O=Agilebits, S=Ontario, C=CA")).toBe(true);
    expect(assinaturaDaAgileBits("NotSigned|")).toBe(false);
    expect(assinaturaDaAgileBits("HashMismatch|CN=Agilebits, O=Agilebits, S=Ontario, C=CA")).toBe(false);
    expect(assinaturaDaAgileBits("Valid|CN=Agilebits, O=Agilebits Falsa, C=CA")).toBe(false);
    expect(assinaturaDaAgileBits("Valid|CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond")).toBe(false);
    expect(assinaturaDaAgileBits("Valid|CN=Falso, O=AgileBits Inc. Falsa")).toBe(false);
    const vistos: { bin: string; args: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
    const executar: ExecutarDoCofre = async (bin, args, o) => { vistos.push({ bin, args, ...(o?.env ? { env: o.env } : {}) }); return { codigo: 0, saida: "Valid|CN=AgileBits Inc., O=AgileBits Inc.", erro: "", estourou: false }; };
    expect(await opDaAgileBitsNoWindows("C:\\Tools\\op.exe'; rm -r C:\\", ENV, executar)).toBe(true);
    expect(vistos[0]!.bin).toBe(powershellDoWindows(ENV));
    expect(vistos[0]!.args.join(" ")).not.toContain("op.exe");
    expect(vistos[0]!.env?.NOD_ARQUIVO).toBe("C:\\Tools\\op.exe'; rm -r C:\\");
    // O PowerShell leva o ambiente do Windows, mas nada do nod nem com cara de segredo.
    expect(vistos[0]!.env).toMatchObject({ SystemRoot: "C:\\Windows", APPDATA: ENV.APPDATA });
    expect(Object.keys(vistos[0]!.env ?? {})).not.toContain("NOD_CREDENTIAL_KEY");
    expect(Object.keys(vistos[0]!.env ?? {})).not.toContain("DATABASE_URL");
    expect(Object.keys(ambienteDoPowerShell({ ...ENV, PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules" }))).not.toContain("PSModulePath");
    // O PowerShell leva o ambiente do Windows, mas nada do nod nem com cara de segredo.
    expect(vistos[0]!.env).toMatchObject({ SystemRoot: "C:\\Windows", APPDATA: ENV.APPDATA });
    expect(Object.keys(vistos[0]!.env ?? {})).not.toContain("NOD_CREDENTIAL_KEY");
    expect(Object.keys(vistos[0]!.env ?? {})).not.toContain("DATABASE_URL");
    expect(Object.keys(ambienteDoPowerShell({ ...ENV, PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules" }))).not.toContain("PSModulePath");
  });

  it("Windows Hello: só Verified ou OK confirmam; o motivo vai por variável, e o script cai na caixa do Windows sem o Hello", async () => {
    expect(confirmouNoWindows("hello:Verified")).toBe(true);
    expect(confirmouNoWindows("caixa:OK")).toBe(true);
    for (const s of ["hello:Canceled", "hello:RetriesExhausted", "caixa:Cancel", "", "disponivel:Available"]) expect(confirmouNoWindows(s), s).toBe(false);
    expect(SCRIPT_DO_WINDOWS_HELLO).toContain("UserConsentVerifier]::RequestVerificationAsync($env:NOD_MOTIVO)");
    expect(SCRIPT_DO_WINDOWS_HELLO).toContain("MessageBox]::Show($env:NOD_MOTIVO");
    let env: Readonly<Record<string, string>> | undefined;
    const executar: ExecutarDoCofre = async (_b, args, o) => { env = o?.env; expect(args.join(" ")).not.toContain("Pagar R$"); return { codigo: 0, saida: "hello:Verified", erro: "", estourou: false }; };
    expect(await confirmarNoWindows("Pagar R$ 3.780 na TAP", ENV, executar)).toBe(true);
    expect(env?.NOD_MOTIVO).toBe("Pagar R$ 3.780 na TAP");
    const demorou: ExecutarDoCofre = async () => ({ codigo: 0, saida: "hello:Verified", erro: "", estourou: true });
    expect(await confirmarNoWindows("x", ENV, demorou)).toBe(false);
  });
});

describe("os cofres do PC (a lógica do Mac com o que é do Windows)", () => {
  it("o bw do npm vira node + script (sem o cmd.exe), a pasta do Bitwarden é a do APPDATA e as frases dizem PC", async () => {
    const chamadas: { bin: string; args: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
    const executar: ExecutarDoCofre = async (bin, args, o) => {
      chamadas.push({ bin, args, ...(o?.env ? { env: o.env } : {}) });
      if (args.includes("list")) return { codigo: 0, saida: JSON.stringify([{ id: "abc-123", name: "Itaú", login: { username: "ana@x.com", uris: [{ uri: "https://www.itau.com.br/" }] } }]), erro: "", estourou: false };
      return { codigo: 0, saida: "", erro: "", estourou: false };
    };
    const bwExe = "C:\\Tools\\bw.exe";
    const cofres = criarCofresDoWindows({ env: ENV, executar, existe: (p) => p === bwExe, sessaoBitwarden: () => "sessao-1", confirmar: async () => true, cookies: async () => [] });
    const opcoes = await cofres.listar("itau.com.br");
    expect(opcoes).toEqual([expect.objectContaining({ fonte: "bitwarden", ref: "abc-123", disponivel: true })]);
    const bw = chamadas.find((c) => c.bin === bwExe)!;
    expect(bw.env).toMatchObject({ BW_SESSION: "sessao-1", BITWARDENCLI_APPDATA_DIR: "C:\\Users\\ana\\AppData\\Roaming\\Bitwarden CLI", SystemRoot: "C:\\Windows" });
    expect(Object.keys(bw.env ?? {})).not.toContain("NOD_CREDENTIAL_KEY");
    const travado = criarCofresDoWindows({ env: ENV, executar, existe: (p) => p === bwExe, sessaoBitwarden: () => null, confirmar: async () => true, cookies: async () => [] });
    expect(await travado.listar("itau.com.br")).toEqual([expect.objectContaining({ fonte: "bitwarden", disponivel: false, motivoIndisponivel: "destravar no seu PC" })]);
    await expect(travado.ler("bitwarden", "abc-123", "itau.com.br")).rejects.toMatchObject({ motivo: "recusado", detalhe: "o Bitwarden está travado neste PC" });
    expect(await travado.touchId("Pagar")).toBe(true);
  });
});

describe("os cookies que o Chrome da pessoa devolve pelo CDP", () => {
  it("só os do site e dos pais dele, sem os vencidos; sessão vira -1 e o sameSite desconhecido, Lax", () => {
    const agora = 1_800_000_000;
    const lista = [
      { name: "sessao", value: "abc", domain: ".itau.com.br", path: "/", expires: agora + 3600, httpOnly: true, secure: true, sameSite: "Strict", session: false },
      { name: "tema", value: "escuro", domain: "www.itau.com.br", path: "/", expires: -1, httpOnly: false, secure: false, session: true },
      { name: "velho", value: "x", domain: ".itau.com.br", path: "/", expires: agora - 1, session: false },
      { name: "outro", value: "y", domain: ".google.com", path: "/", expires: agora + 3600, session: false },
      { name: "", value: "z", domain: ".itau.com.br" },
    ];
    expect(cookiesDoCdpParaOHost(lista, "www.itau.com.br", agora)).toEqual([
      { name: "sessao", value: "abc", domain: ".itau.com.br", path: "/", expires: agora + 3600, secure: true, httpOnly: true, sameSite: "Strict" },
      { name: "tema", value: "escuro", domain: "www.itau.com.br", path: "/", expires: -1, secure: false, httpOnly: false, sameSite: "Lax" },
    ]);
  });
});

describe("a instalação do motor no Windows põe o navegador do bot", () => {
  it("o agent-browser fixo em %LOCALAPPDATA%\\nod\\navegador, sem os scripts do npm, sem derrubar a instalação", () => {
    const s = scriptDeInstalacaoWindows({ servidor: "https://nod.exemplo.com", versao: "1.2.3" });
    expect(s).toContain("function InstalarNavegador");
    // O motor que se instala sozinho (agentBrowserNoWindows) pega a mesma versão do instalador.
    expect(AGENT_BROWSER_DA_MAQUINA).toBe(AGENT_BROWSER_DO_MOTOR);
    expect(s).toContain(`'agent-browser@${AGENT_BROWSER_DO_MOTOR}'`);
    expect(s).toContain("'--ignore-scripts'");
    expect(s).toContain("node_modules\\@agent-browser\\cli-win32-x64-msvc\\bin\\agent-browser.exe");
    expect(s).toMatch(/InstalarMotor\s+InstalarNavegador\s+CriarComandos/u);
    const funcao = s.slice(s.indexOf("function InstalarNavegador"), s.indexOf("function InstalarMotor"));
    expect(funcao).not.toContain("Falhar");
  });
});

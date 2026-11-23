import { execFileSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentBrowserNoWindows, chromeDoWindows } from "../../src/adapters/executor/navegador.ts";
import { binarioAgentBrowser, criarMotorAgentBrowser } from "../../src/adapters/navegador/motor-agent-browser.ts";
import { relayPadrao } from "../../src/adapters/navegador/stream-local.ts";
import { executarDoCofre } from "../../desktop/cofres-do-mac.ts";
import { ambienteDoPowerShell, criarCofresDoWindows, executarNoWindows, opDaAgileBitsNoWindows, powershellDoWindows, SCRIPT_DO_WINDOWS_HELLO } from "../../desktop/cofres-do-windows.ts";
import { cookiesDoChromeNoWindows, googleChromeDoWindows } from "../../desktop/cookies-do-chrome-windows.ts";

/**
 * 2026-11-22 (o navegador no PC, com tudo o que o Mac tem): a prova no Windows de verdade (job `windows` da CI,
 * windows-latest, que já vem com o Google Chrome). O agent-browser.exe do npm dirige o Chrome do runner; o "Trazer do meu
 * Chrome" lê os cookies que o próprio Chrome cifrou (DPAPI e app-bound) numa cópia do perfil; o Windows Hello carrega o
 * WinRT no PowerShell 5.1; a assinatura do op é conferida pelo Authenticode. Fora do Windows o arquivo inteiro pula.
 */
vi.setConfig({ testTimeout: 120_000 });
const noWindows = process.platform === "win32";

let servidor: Server;
let base = "";
beforeAll(async () => {
  if (!noWindows) return;
  servidor = createServer((req, res) => {
    if (req.url === "/cookie") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "nod_teste=ok-do-chrome; Max-Age=3600; Path=/; HttpOnly" });
      res.end("<!doctype html><title>cookie</title><p>cookie posto</p>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="pt-BR"><head><title>Loja de teste</title></head><body>
      <h1>Loja de teste</h1>
      <label>Nome <input id="nome" aria-label="Nome"></label>
      <button id="botao" onclick="document.getElementById('saida').textContent = 'clicado'">Adicionar ao carrinho</button>
      <p id="saida">nada</p></body></html>`);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const a = servidor.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => { if (servidor) await new Promise<void>((r) => servidor.close(() => r())); });

describe.skipIf(!noWindows)("o navegador do bot no Windows de verdade", () => {
  it("o motor: agent-browser.exe + o Chrome do sistema abrem, leem, clicam, preenchem e dão o stream", async () => {
    const bin = binarioAgentBrowser();
    expect(bin).toMatch(/agent-browser\.exe$/u);
    const chrome = chromeDoWindows(process.env);
    expect(chrome).toMatch(/(chrome|msedge)\.exe$/u);
    const dados = mkdtempSync(join(tmpdir(), "nod-nav-"));
    const motor = criarMotorAgentBrowser({ dados, segredo: randomBytes(32), binario: bin, chrome });
    const s = { agenteId: "11111111-1111-4111-8111-111111111111" };
    try {
      const aberta = await motor.abrir(s, `${base}/`);
      expect(aberta.url).toContain("127.0.0.1");
      const leitura = await motor.ler(s);
      const botao = Object.entries(leitura.refs).find(([, r]) => r.nome === "Adicionar ao carrinho")?.[0];
      const campo = Object.entries(leitura.refs).find(([, r]) => r.nome === "Nome")?.[0];
      expect(botao).toBeTruthy();
      expect(campo).toBeTruthy();
      await motor.clicar(s, `@${botao}`);
      expect(await motor.texto(s, "#saida")).toBe("clicado");
      await motor.preencher(s, `@${campo}`, "Ana");
      expect(await motor.avaliar(s, "document.getElementById('nome').value")).toBe("Ana");
      // A vista ao vivo e o cofre usam o stream do Chrome do bot (a porta e o relay de texto).
      const porta = await motor.portaDoStream(s);
      expect(typeof porta).toBe("number");
      expect(await relayPadrao(porta!, { action: "focus", selector: "#nome" })).toBe(true);
      expect(await relayPadrao(porta!, { action: "keyboard", subaction: "insertText", text: " Souza" })).toBe(true);
      expect(await motor.avaliar(s, "document.getElementById('nome').value")).toBe("Ana Souza");
    } finally {
      await motor.fechar(s).catch(() => undefined);
      rmSync(dados, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });

  it("Trazer do meu Chrome: o Chrome da pessoa devolve o cookie que ele mesmo cifrou, lido de uma cópia do perfil", async () => {
    const chrome = googleChromeDoWindows(process.env);
    expect(chrome).toMatch(/chrome\.exe$/u);
    // O "Chrome da pessoa": um perfil de verdade, com o cookie posto pelo site e gravado cifrado no disco.
    const perfil = mkdtempSync(join(tmpdir(), "nod-perfil-"));
    try {
      const filho = spawn(chrome!, ["--headless=new", `--user-data-dir=${perfil}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `${base}/cookie`], { stdio: "ignore" });
      let porta = "", caminho = "";
      for (let i = 0; i < 200 && !caminho; i++) {
        try { [porta = "", caminho = ""] = readFileSync(join(perfil, "DevToolsActivePort"), "utf8").split(/\r?\n/u); } catch { /* ainda subindo */ }
        if (!caminho) await new Promise((r) => setTimeout(r, 150));
      }
      expect(caminho).toMatch(/^\/devtools\/browser\//u);
      // Espera o cookie chegar e fecha o Chrome pelo CDP (o fechamento grava os cookies no disco).
      await new Promise((r) => setTimeout(r, 3_000));
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${porta}${caminho}`);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
        ws.onclose = () => resolve();
        ws.onerror = () => resolve();
      });
      await new Promise<void>((r) => { if (filho.exitCode !== null) r(); else filho.once("exit", () => r()); });
      // O Chrome do runner cifra como o da pessoa: a chave do usuário (DPAPI) e, no Chrome 127+, a app-bound.
      const localState = JSON.parse(readFileSync(join(perfil, "Local State"), "utf8")) as { os_crypt?: Record<string, unknown> };
      expect(localState.os_crypt?.encrypted_key).toBeTruthy();

      const cookies = await cookiesDoChromeNoWindows({ host: "127.0.0.1", env: process.env, pastaDoChrome: perfil, chrome });
      expect(cookies).toEqual([expect.objectContaining({ name: "nod_teste", value: "ok-do-chrome", httpOnly: true })]);
      // Outro site não leva nada.
      expect(await cookiesDoChromeNoWindows({ host: "exemplo.com", env: process.env, pastaDoChrome: perfil, chrome })).toEqual([]);
    } finally {
      rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });

  it("o PC que já tinha o motor: o motor instala o agent-browser sozinho com o npm do Node e o acha depois", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "nod-raiz-"));
    try {
      const env = { ...process.env, NOD_INSTALADO_EM: raiz, NOD_AGENT_BROWSER: undefined, PATH: process.env.PATH };
      const achar = agentBrowserNoWindows({ env, pastaDoMotor: join(raiz, "motor", "app") });
      const bin = await achar();
      expect(bin).toBe(join(raiz, "navegador", "node_modules", "@agent-browser", "cli-win32-x64-msvc", "bin", "agent-browser.exe"));
      expect(await achar()).toBe(bin);
    } finally {
      rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });

  it("Windows Hello: o script carrega o WinRT no PowerShell 5.1 e responde a disponibilidade", async () => {
    const r = await executarDoCofre(powershellDoWindows(process.env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT_DO_WINDOWS_HELLO], { prazoMs: 60_000, env: ambienteDoPowerShell(process.env, { NOD_SO_CHECAR: "1", NOD_MOTIVO: "teste" }) });
    expect(r.erro).toBe("");
    expect(r.saida).toMatch(/^disponivel:(Available|DeviceNotPresent|NotConfiguredForUser|DisabledByPolicy|DeviceBusy|Erro)$/u);
  });

  it("a assinatura: o Authenticode do Windows roda, e um binário assinado por outra empresa não passa como o op da AgileBits", async () => {
    // O chrome.exe traz a assinatura embutida, como o op.exe da AgileBits (o powershell.exe é assinado por catálogo, e a
    // consulta ao catálogo leva mais que o prazo no runner).
    const chrome = googleChromeDoWindows(process.env);
    let saida = "", erro = "";
    const espiao: typeof executarDoCofre = async (bin, args, o) => { const r = await executarDoCofre(bin, args, o); saida = r.saida; erro = r.erro; return r; };
    expect(await opDaAgileBitsNoWindows(chrome!, process.env, espiao)).toBe(false);
    expect(saida, erro).toMatch(/^Valid\|.*Google/u);
  });
  it("o 1Password de verdade: o op.exe oficial passa na conferência da AgileBits, roda e, sem conta, a lista fica vazia", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "nod-op-"));
    try {
      const r = await fetch("https://cache.agilebits.com/dist/1P/op2/pkg/v2.30.3/op_windows_amd64_v2.30.3.zip");
      expect(r.ok).toBe(true);
      writeFileSync(join(pasta, "op.zip"), Buffer.from(await r.arrayBuffer()));
      execFileSync("tar", ["-xf", join(pasta, "op.zip"), "-C", pasta]);
      const op = join(pasta, "op.exe");
      expect(existsSync(op)).toBe(true);
      let assinatura = "";
      const espiao: typeof executarDoCofre = async (bin, args, o) => { const x = await executarDoCofre(bin, args, o); assinatura = `${x.saida} ${x.erro}`; return x; };
      expect(await opDaAgileBitsNoWindows(op, process.env, espiao), assinatura).toBe(true);
      const versao = await executarNoWindows(process.env)(op, ["--version"], { env: ambienteDoPowerShell(process.env) });
      expect(versao.saida.trim()).toBe("2.30.3");
      // Sem conta no runner: o cofre acha o op (pelo PATH), confere e não cai — lista vazia ou, se o op demorar mais que o
      // prazo do cartão, a opção genérica do 1Password (o caso do op que espera o desbloqueio).
      const cofres = criarCofresDoWindows({ env: { ...process.env, PATH: `${pasta};${process.env.PATH}` }, cookies: async () => [], confirmar: async () => false });
      const opcoes = await cofres.listar("exemplo.com");
      expect(opcoes.every((o) => o.fonte === "1password" && o.ref === "")).toBe(true);
    } finally {
      rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });

  it("o Bitwarden de verdade: o bw do npm roda pelo atalho .cmd (node + script, sem cmd.exe) e, sem login, não quebra a lista", async () => {
    const prefixo = mkdtempSync(join(tmpdir(), "nod-bw-"));
    try {
      execFileSync(process.execPath, [join(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"), "install", "-g", "--prefix", prefixo, "--no-fund", "--no-audit", "--loglevel=error", "@bitwarden/cli@2026.9.1"], { stdio: "ignore", timeout: 300_000 });
      const bwCmd = join(prefixo, "bw.cmd");
      expect(existsSync(bwCmd)).toBe(true);
      const env = { ...process.env, PATH: `${prefixo};${process.env.PATH}`, BITWARDENCLI_APPDATA_DIR: join(prefixo, "dados") };
      const versao = await executarNoWindows(env)(bwCmd, ["--version"], { prazoMs: 60_000, env: ambienteDoPowerShell(env) });
      expect(versao.saida.trim()).toBe("2026.9.1");
      // Travado (sem a sessão): o cofre mostra a opção cinza "destravar no seu PC"; com uma sessão que não vale, não cai.
      const travado = criarCofresDoWindows({ env, sessaoBitwarden: () => null, cookies: async () => [], confirmar: async () => false });
      expect(await travado.listar("exemplo.com")).toEqual([expect.objectContaining({ fonte: "bitwarden", disponivel: false, motivoIndisponivel: "destravar no seu PC" })]);
      const semLogin = criarCofresDoWindows({ env, sessaoBitwarden: () => "sessao-que-nao-vale", cookies: async () => [], confirmar: async () => false });
      expect(Array.isArray(await semLogin.listar("exemplo.com"))).toBe(true);
    } finally {
      rmSync(prefixo, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });

  it("Trazer do meu Chrome no perfil de uso diário: o Default da pasta padrão do Chrome do usuário", async () => {
    const chrome = googleChromeDoWindows(process.env);
    const padrao = join(process.env.LOCALAPPDATA!, "Google", "Chrome", "User Data");
    // O Chrome da pessoa no dia a dia: o Chrome com janela, na pasta padrão, o site gravando o cookie como qualquer site.
    const filho = spawn(chrome!, [`--user-data-dir=${padrao}`, "--no-first-run", "--no-default-browser-check", `${base}/cookie`], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 8_000));
      // Com o Chrome aberto, o Windows pode travar o banco: a pessoa ouve o recado (ou a leitura já funciona).
      try {
        await cookiesDoChromeNoWindows({ host: "127.0.0.1", env: process.env, chrome });
      } catch (e) {
        expect((e as { detalhe?: string }).detalhe).toBe("feche o Google Chrome e tente de novo: com ele aberto, o Windows não deixa ler os cookies");
      }
      // A pessoa fecha o Chrome (o pedido de fechar da janela, sem /F): é quando ele grava os cookies no disco.
      try { execFileSync("taskkill", ["/T", "/PID", String(filho.pid)], { stdio: "ignore" }); } catch { /* já saindo */ }
      await new Promise<void>((r) => { const t = setTimeout(r, 30_000); if (filho.exitCode !== null) { clearTimeout(t); r(); } else filho.once("exit", () => { clearTimeout(t); r(); }); });
    } finally {
      if (filho.exitCode === null) {
        try { execFileSync("taskkill", ["/F", "/T", "/PID", String(filho.pid)], { stdio: "ignore" }); } catch { /* já saiu */ }
        await new Promise<void>((r) => { if (filho.exitCode !== null) r(); else filho.once("exit", () => r()); });
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
    // O que ficou no banco do perfil padrão (diagnóstico: o cookie chegou ao disco? cifrado como?).
    const diagnostico = await (async () => {
      const banco = [join(padrao, "Default", "Network", "Cookies"), join(padrao, "Default", "Cookies")].find((c) => existsSync(c));
      if (!banco) return `sem banco de cookies em ${padrao}\\Default (Local State: ${existsSync(join(padrao, "Local State"))})`;
      const copia = join(mkdtempSync(join(tmpdir(), "nod-diag-")), "Cookies");
      writeFileSync(copia, readFileSync(banco));
      const { DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (c: string, o: { readOnly: boolean }) => { prepare(q: string): { all(): Record<string, unknown>[] }; close(): void } };
      const db = new DatabaseSync(copia, { readOnly: true });
      try {
        const linhas = db.prepare("select host_key, name, substr(encrypted_value, 1, 3) as pre from cookies").all();
        return `${linhas.length} cookies: ${linhas.map((l) => `${String(l.host_key)}/${String(l.name)}/${Buffer.from(l.pre as Uint8Array).toString("latin1")}`).join(", ")}`;
      } finally { db.close(); }
    })().catch((e: unknown) => `diagnóstico falhou: ${String(e)}`);
    // Fechado o Chrome, sem dizer a pasta: o padrão do usuário, como o motor faz.
    const cookies = await cookiesDoChromeNoWindows({ host: "127.0.0.1", env: process.env });
    expect(cookies, diagnostico).toEqual([expect.objectContaining({ name: "nod_teste", value: "ok-do-chrome", httpOnly: true })]);
  }, 240_000);
});

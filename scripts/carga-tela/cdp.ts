// Chrome DevTools Protocol mínimo para o teste de carga da tela: acha o Chrome for Testing do cache do Playwright
// (ou CARGA_CHROME), abre headless e fala com a aba por WebSocket (o Node 24 tem WebSocket global).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Cdp = {
  enviar<T = Record<string, unknown>>(metodo: string, params?: Record<string, unknown>): Promise<T>;
  fechar(): void;
};

function acharChrome(): string {
  if (process.env.CARGA_CHROME) return process.env.CARGA_CHROME;
  const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  const versoes = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const v of versoes) {
    for (const rel of ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-linux/chrome", "chrome-linux64/chrome"]) {
      const p = join(cache, v, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error("Chrome não encontrado: instale com `npx playwright install chromium` ou defina CARGA_CHROME");
}

export function portaDoDevTools(perfil: string): number | null {
  try {
    const porta = Number(readFileSync(join(perfil, "DevToolsActivePort"), "utf8").split("\n", 1)[0]);
    return Number.isInteger(porta) && porta > 0 && porta <= 65_535 ? porta : null;
  } catch {
    return null;
  }
}

export async function abrirChrome(_porta: number, perfil: string): Promise<{ cdp: Cdp; chrome: ChildProcess }> {
  rmSync(perfil, { recursive: true, force: true });
  mkdirSync(perfil, { recursive: true });
  const chrome = spawn(acharChrome(), [
    "--headless=new",
    // O próprio Chrome escolhe uma porta livre e a publica em DevToolsActivePort. Os testes de navegador rodam em série
    // no mesmo processo e chrome.kill() não espera o socket fechar; reutilizar a porta derivada do PID falhava no teste
    // seguinte, depois de centenas de jornadas verdes (medido na CI do PR #89 em 2026-11-16).
    "--remote-debugging-port=0",
    `--user-data-dir=${perfil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,900",
    // Sem estrangular timers e renderer: a aba headless conta como "na frente" o tempo todo.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-extensions",
    // Só no runner de CI com user namespaces travados pelo AppArmor (ubuntu 24.04; o ci.yml liga a variável): sem isso o
    // Chrome não sobe e a porta de depuração nunca abre (NOD-429, o teste no Chrome real travava o beforeAll na CI).
    ...(process.env.NOD_CAPTURA_SEM_SANDBOX === "1" ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: "ignore" });
  // medido em 2026-09-30: a primeira abertura do Chrome for Testing no macOS levou 19 s até a porta responder.
  let alvo: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 400 && !alvo; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const porta = portaDoDevTools(perfil);
      if (!porta) continue;
      const lista = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      alvo = lista.find((t) => t.type === "page");
    } catch {
      // ainda subindo
    }
  }
  if (!alvo) {
    chrome.kill();
    throw new Error("o Chrome não abriu a porta de depuração");
  }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise<void>((ok, erro) => {
    ws.onopen = () => ok();
    ws.onerror = () => erro(new Error("websocket do Chrome"));
  });
  let seq = 0;
  const pendentes = new Map<number, { ok: (v: unknown) => void; erro: (e: Error) => void }>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (msg.id === undefined) return;
    const p = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    if (msg.error) p?.erro(new Error(msg.error.message));
    else p?.ok(msg.result);
  };
  const cdp: Cdp = {
    enviar(metodo, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method: metodo, params }));
      return new Promise((ok, erro) => pendentes.set(id, { ok: ok as (v: unknown) => void, erro }));
    },
    fechar() {
      ws.close();
      chrome.kill();
    },
  };
  return { cdp, chrome };
}

export async function avaliar<T>(cdp: Cdp, expressao: string): Promise<T> {
  const r = await cdp.enviar<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression: expressao, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`avaliar: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value as T;
}

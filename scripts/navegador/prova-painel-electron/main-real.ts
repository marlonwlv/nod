/**
 * 2026-11-28: a mesma prova do painel (main.ts), num site REAL e externo com login: o SauceDemo (saucedemo.com), feito
 * para testes de automação, com o usuário de teste que o próprio site publica na tela de login. A pessoa entra pelo
 * painel (cada tecla confirmada pela vista local); depois da pausa do Chrome, a rotina do bot abre a área logada, ordena
 * os produtos e lê a lista, com o login feito no painel. Rodar: `NOD_PROVA_SITE=real node .../rodar.mjs` (precisa de rede).
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromeDoMac, chromeDoWindows } from "../../../src/adapters/executor/navegador.ts";
import { conectarCdpGlobal } from "../../../src/adapters/navegador/entrada-cdp.ts";
import { binarioAgentBrowser, criarMotorAgentBrowser } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { conectarStreamGlobal, relayPadrao } from "../../../src/adapters/navegador/stream-local.ts";
import { criarVistaLocal } from "../../../src/adapters/navegador/vista-local.ts";
import { ligarNavegadorLocal } from "../../../desktop/navegador-local.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const BOT = "44444444-4444-4444-8444-444444444444";
const SITE = "https://www.saucedemo.com";

app.whenReady().then(async () => {
  setTimeout(() => { process.stdout.write("RESULTADO {\"erro\":\"tempo esgotado\"}\n"); app.exit(1); }, 150_000).unref();
  const dados = mkdtempSync(join(tmpdir(), "nod-prova-real-"));
  const motor = criarMotorAgentBrowser({ dados, segredo: randomBytes(32), binario: binarioAgentBrowser(), chrome: process.platform === "win32" ? chromeDoWindows(process.env) : chromeDoMac(process.env.HOME ?? ""), ociosoMs: 600_000 });
  const s = { agenteId: BOT };
  await motor.abrir(s, `${SITE}/`);
  const vista = criarVistaLocal({ motor: async () => motor, conectarStream: (p) => conectarStreamGlobal(p, undefined, 30), relay: relayPadrao, conectarCdp: (u) => conectarCdpGlobal(u) });
  ligarNavegadorLocal({ ipcMain, endereco: () => vista.iniciar(), validar: () => undefined });
  ipcMain.handle("prova:centro", async (_e, sel: string) => motor.avaliar(s, "(() => { const r = document.querySelector(" + JSON.stringify(sel) + ").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()"));
  ipcMain.handle("prova:url", async () => motor.url(s).then((u) => u.replace(SITE, "")));
  ipcMain.handle("prova:avaliar", async (_e, js: string) => motor.avaliar(s, js));
  ipcMain.handle("prova:valor", async (_e, sel: string) => motor.avaliar(s, "document.querySelector(" + JSON.stringify(sel) + ").value"));
  ipcMain.handle("prova:fim", async (_e, r: Record<string, unknown>) => {
    if (r.erro) { process.stdout.write(`RESULTADO ${JSON.stringify(r)}\n`); app.exit(1); return; }
    for (let i = 0; i < 50 && !(await motor.url(s).catch(() => "")).includes("/inventory"); i++) await new Promise((x) => setTimeout(x, 100));
    const logadoPeloPainel = (await motor.url(s)).includes("/inventory");
    // A pausa (o Chrome fecha; o perfil guarda a sessão) e a rotina: ordenar por preço e ler os produtos.
    await vista.parar();
    await motor.fechar(s);
    const aberta = await motor.abrir(s, `${SITE}/inventory.html`);
    await motor.selecionar(s, ".product_sort_container", ["lohi"]);
    const produtos = await motor.avaliar(s, "[...document.querySelectorAll('.inventory_item_name')].map((e) => e.textContent)") as string[];
    const precos = await motor.avaliar(s, "[...document.querySelectorAll('.inventory_item_price')].map((e) => e.textContent)") as string[];
    const rotina = { url: aberta.url.replace(SITE, ""), produtos: produtos.length, maisBarato: `${produtos[0]} ${precos[0]}` };
    process.stdout.write(`RESULTADO ${JSON.stringify({ ...r, logadoPeloPainel, rotina })}\n`);
    await motor.fechar(s).catch(() => undefined); rmSync(dados, { recursive: true, force: true }); app.exit(0);
  });
  const w = new BrowserWindow({ show: false, webPreferences: { preload: join(AQUI, "preload.cjs"), contextIsolation: true, sandbox: false } });
  await w.loadFile(join(AQUI, "pagina-real.html"));
}).catch((e: unknown) => { process.stdout.write(`RESULTADO ${JSON.stringify({ erro: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })}\n`); app.exit(1); });

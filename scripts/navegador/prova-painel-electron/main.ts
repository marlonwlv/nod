/**
 * 2026-11-28 (o painel como um navegador normal): a prova no Electron de verdade, a mesma do app. Uma janela com a ponte
 * do preload (desktop/preload-navegador-local.ts), o processo principal com a ponte (desktop/navegador-local.ts), a vista
 * local e o Chrome do bot. Um site de teste com login de verdade (CPF com máscara, senha com acento e colada, código do
 * SMS, cookie de sessão) e uma área logada com busca de perfis. A página mede pelo lado da pessoa: a primeira imagem, cada
 * tecla confirmada e o clique até a imagem nova. Depois a pausa e a rotina do bot com o login feito no painel.
 * Rodar: `node scripts/navegador/prova-painel-electron/rodar.mjs` (Mac e Windows; no job windows da CI).
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { createServer } from "node:http";
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

/** A pasta do bundle (o rodar.mjs põe o preload e a página ao lado). */
const AQUI = dirname(fileURLToPath(import.meta.url));

const BOT = "33333333-3333-4333-8333-333333333333";
const recebidos: Record<string, string> = {};
const LOGIN = `<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;margin:24px"><h1>Banco</h1>
<input id="cpf" style="display:block;font-size:18px;margin:8px 0;width:320px"><input id="senha" type="password" style="display:block;font-size:18px;margin:8px 0;width:320px">
<button id="cor" onclick="document.body.style.background=document.body.style.background?'':'rgb(255,220,0)'">cor</button>
<script>const c=document.getElementById('cpf');c.addEventListener('input',()=>{const d=c.value.replace(/\\D/g,'').slice(0,11);let v=d.slice(0,3);if(d.length>3)v+='.'+d.slice(3,6);if(d.length>6)v+='.'+d.slice(6,9);if(d.length>9)v+='-'+d.slice(9);c.value=v;});
document.getElementById('senha').addEventListener('keydown',async(e)=>{if(e.key==='Enter'){await fetch('/entrar',{method:'POST',body:JSON.stringify({cpf:c.value,senha:document.getElementById('senha').value})});location.href='/codigo';}});</script>`;
const SESSAO = randomBytes(8).toString("hex");
const PERFIS = ["Ana Souza · designer de produto", "Bruno Lima · designer gráfico", "Davi Rocha · engenheiro"];
const CODIGO_HTML = '<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;margin:24px"><h1>Código</h1><input id="codigo" autocomplete="one-time-code" style="font-size:18px;width:200px"><script>document.getElementById("codigo").addEventListener("keydown",async(e)=>{if(e.key==="Enter"){const r=await fetch("/codigo",{method:"POST",body:JSON.stringify({codigo:e.target.value})});if(r.ok)location.href="/area";}});</script>';
const site = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  const logado = (req.headers.cookie ?? "").includes("sessao=" + SESSAO);
  if (req.method === "POST") { let t = ""; req.on("data", (d) => { t += d; }); req.on("end", () => {
    const b = JSON.parse(t); Object.assign(recebidos, b);
    if (u.pathname === "/codigo") { if (b.codigo === "481516") res.writeHead(200, { "set-cookie": "sessao=" + SESSAO + "; Max-Age=86400; Path=/; HttpOnly" }).end("ok"); else res.writeHead(401).end(); return; }
    res.end("ok"); }); return; }
  if (u.pathname === "/codigo") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(CODIGO_HTML); return; }
  if (u.pathname === "/area") {
    if (!logado) { res.writeHead(302, { location: "/" }).end(); return; }
    const q = u.searchParams.get("q") ?? "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end('<!doctype html><meta charset="utf-8"><h1 id="ola">Olá, José</h1><button id="cor" onclick="document.body.style.background=document.body.style.background?\'\':\'rgb(255,220,0)\'">cor</button><form action="/area"><input id="busca" name="q"><button id="buscar">Buscar</button></form><ul>' + (q ? PERFIS.filter((p) => p.includes(q)) : []).map((p) => '<li class="perfil">' + p + "</li>").join("") + "</ul>");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(LOGIN);
});

app.whenReady().then(async () => {
  setTimeout(() => { process.stdout.write("RESULTADO {\"erro\":\"tempo esgotado\"}\n"); app.exit(1); }, 150_000).unref();
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  const dados = mkdtempSync(join(tmpdir(), "nod-prova-electron-"));
  const motor = criarMotorAgentBrowser({ dados, segredo: randomBytes(32), binario: binarioAgentBrowser(), chrome: process.platform === "win32" ? chromeDoWindows(process.env) : chromeDoMac(process.env.HOME ?? ""), ociosoMs: 600_000 });
  const s = { agenteId: BOT };
  await motor.abrir(s, `${base}/`);
  const vista = criarVistaLocal({ motor: async () => motor, conectarStream: (p) => conectarStreamGlobal(p, undefined, 30), relay: relayPadrao, conectarCdp: (u) => conectarCdpGlobal(u) });
  ligarNavegadorLocal({ ipcMain, endereco: () => vista.iniciar(), validar: () => undefined });
  ipcMain.handle("prova:centro", async (_e, sel: string) => motor.avaliar(s, "(() => { const r = document.querySelector(" + JSON.stringify(sel) + ").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()"));
  ipcMain.handle("prova:url", async () => motor.url(s).then((u) => u.replace(base, "")));
  ipcMain.handle("prova:fim", async (_e, r: Record<string, unknown>) => {
    if (r.erro) { process.stdout.write(`RESULTADO ${JSON.stringify(r)}\n`); app.exit(1); return; }
    for (let i = 0; i < 50 && !(await motor.url(s).catch(() => "")).endsWith("/area"); i++) await new Promise((x) => setTimeout(x, 100));
    const logadoPeloPainel = (await motor.url(s)).endsWith("/area");
    // A pausa (o Chrome fecha, o perfil guarda o login) e a rotina do bot na área logada.
    await vista.parar();
    await motor.fechar(s);
    const aberta = await motor.abrir(s, base + "/area");
    await motor.preencher(s, "#busca", "designer");
    await motor.clicar(s, "#buscar");
    for (let i = 0; i < 50 && !(await motor.url(s)).includes("q=designer"); i++) await new Promise((x) => setTimeout(x, 100));
    const rotina = { url: aberta.url.replace(base, ""), ola: await motor.texto(s, "#ola"), perfis: await motor.avaliar(s, "[...document.querySelectorAll('.perfil')].map((e) => e.textContent)") };
    r = { ...r, logadoPeloPainel, rotina };
    process.stdout.write(`RESULTADO ${JSON.stringify({ ...r, recebidos })}\n`);
    await vista.parar(); await motor.fechar(s).catch(() => undefined); rmSync(dados, { recursive: true, force: true }); site.close(); app.exit(0);
  });
  const w = new BrowserWindow({ show: false, webPreferences: { preload: join(AQUI, "preload.cjs"), contextIsolation: true, sandbox: false } });
  await w.loadFile(join(AQUI, "pagina.html"));
}).catch((e: unknown) => { process.stdout.write(`RESULTADO ${JSON.stringify({ erro: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })}\n`); app.exit(1); });

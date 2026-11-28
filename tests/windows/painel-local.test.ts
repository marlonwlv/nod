import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromeDoMac, chromeDoWindows } from "../../src/adapters/executor/navegador.ts";
import { conectarCdpGlobal } from "../../src/adapters/navegador/entrada-cdp.ts";
import { binarioAgentBrowser, criarMotorAgentBrowser } from "../../src/adapters/navegador/motor-agent-browser.ts";
import { conectarStreamGlobal, relayPadrao } from "../../src/adapters/navegador/stream-local.ts";
import { criarVistaLocal } from "../../src/adapters/navegador/vista-local.ts";
import type { EntradaNavegador } from "../../src/contracts/navegador-do-bot.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a prova de ponta a ponta da vista local, com o Chrome de verdade, no
 * job `windows` da CI e no Mac (NOD_PAINEL_LOCAL=1). Um site de teste com login de verdade (CPF com máscara, senha com
 * acento e texto colado, código por SMS, cookie de sessão) e uma área logada com busca de perfis. A pessoa entra pelo
 * painel: cada clique e cada tecla vão pela vista local (127.0.0.1, sem nuvem) e voltam confirmados pelo Chrome. Depois o
 * Chrome fecha (a pausa) e o bot, numa "rotina", abre a área logada e busca perfis com o login que ela fez.
 *
 * Os números do objetivo: o painel abre com o primeiro quadro em menos de 1 s (com o Chrome do bot ligado) e o clique
 * vira quadro novo em menos de 150 ms (mediana de 10).
 */
vi.setConfig({ testTimeout: 180_000 });
const LIGADO = process.platform === "win32" || process.env.NOD_PAINEL_LOCAL === "1";

const CPF = "123.456.789-09";
const SENHA = "Senhã@2026 çé";
const CODIGO = "481516";
const SESSAO = randomBytes(16).toString("hex");
const recebidos: { cpf?: string; senha?: string; codigo?: string } = {};

const PAGINA_LOGIN = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Banco de teste</title>
<style>body{font:16px sans-serif;margin:24px} input{display:block;font-size:18px;margin:8px 0;padding:6px;width:320px} button{font-size:18px;padding:6px 16px}</style></head><body>
<h1>Banco de teste</h1>
<form id="f1"><label>CPF <input id="cpf" inputmode="numeric" autocomplete="username"></label>
<label>Senha <input id="senha" type="password" autocomplete="current-password"></label>
<button id="entrar" type="submit">Entrar</button></form>
<form id="f2" hidden><label>Código do SMS <input id="codigo" autocomplete="one-time-code" inputmode="numeric"></label><button type="submit">Confirmar</button></form>
<p id="msg"></p>
<script>
const cpf = document.getElementById('cpf');
// A máscara do CPF como nos bancos: reformata a cada tecla (o input), e só aceita dígitos.
cpf.addEventListener('input', () => { const d = cpf.value.replace(/\\D/g, '').slice(0, 11); let v = d.slice(0, 3); if (d.length > 3) v += '.' + d.slice(3, 6); if (d.length > 6) v += '.' + d.slice(6, 9); if (d.length > 9) v += '-' + d.slice(9); cpf.value = v; });
document.getElementById('f1').addEventListener('submit', async (e) => { e.preventDefault();
  const r = await fetch('/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cpf: cpf.value, senha: document.getElementById('senha').value }) });
  if (r.ok) { document.getElementById('f1').hidden = true; document.getElementById('f2').hidden = false; document.getElementById('codigo').focus(); } else document.getElementById('msg').textContent = 'CPF ou senha errados'; });
document.getElementById('f2').addEventListener('submit', async (e) => { e.preventDefault();
  const r = await fetch('/codigo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo: document.getElementById('codigo').value }) });
  if (r.ok) location.href = '/area'; else document.getElementById('msg').textContent = 'código errado'; });
</script></body></html>`;

const PERFIS = ["Ana Souza · designer de produto", "Bruno Lima · designer gráfico", "Carla Dias · designer de serviços", "Davi Rocha · engenheiro"];

function paginaArea(busca: string): string {
  const achados = busca ? PERFIS.filter((p) => p.includes(busca)) : [];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Área logada</title></head><body style="font:16px sans-serif;margin:24px">
<h1 id="ola">Olá, José</h1>
<form action="/area"><label>Buscar perfis <input id="busca" name="q" value="${busca}"></label><button id="buscar" type="submit">Buscar</button></form>
<ul id="perfis">${achados.map((p) => `<li class="perfil">${p}</li>`).join("")}</ul>
<button id="cor" onclick="document.body.style.background = document.body.style.background ? '' : 'rgb(255, 220, 0)'">Mudar a cor</button>
</body></html>`;
}

let servidor: Server;
let base = "";
beforeAll(async () => {
  if (!LIGADO) return;
  servidor = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const logado = (req.headers.cookie ?? "").includes(`sessao=${SESSAO}`);
    const corpo = () => new Promise<Record<string, string>>((r) => { let t = ""; req.on("data", (c: Buffer) => { t += c.toString("utf8"); }); req.on("end", () => { try { r(JSON.parse(t) as Record<string, string>); } catch { r({}); } }); });
    if (req.method === "POST" && u.pathname === "/entrar") {
      void corpo().then((b) => { recebidos.cpf = b.cpf; recebidos.senha = b.senha; res.writeHead(b.cpf === CPF && b.senha === SENHA ? 200 : 401).end(); });
      return;
    }
    if (req.method === "POST" && u.pathname === "/codigo") {
      void corpo().then((b) => {
        recebidos.codigo = b.codigo;
        if (b.codigo !== CODIGO) { res.writeHead(401).end(); return; }
        res.writeHead(200, { "set-cookie": `sessao=${SESSAO}; Max-Age=86400; Path=/; HttpOnly` }).end();
      });
      return;
    }
    if (u.pathname === "/area") {
      if (!logado) { res.writeHead(302, { location: "/" }).end(); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(paginaArea(u.searchParams.get("q") ?? ""));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGINA_LOGIN);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const a = servidor.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => { if (servidor) await new Promise<void>((r) => servidor.close(() => r())); });

/** O lado do app: um WebSocket na vista local, com a confirmação de cada entrada e o relógio dos quadros. */
async function abrirPainel(porta: number, token: string, agenteId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/navegador/${agenteId}?t=${token}`, { perMessageDeflate: false, maxPayload: 64 << 20 });
  const confirmacoes = new Map<number, (ok: boolean) => void>();
  let quadros = 0;
  let primeiroQuadroEm = 0;
  const inicio = performance.now();
  ws.on("message", (d) => {
    const t = d.toString();
    if (t.startsWith('{"t":"ok"')) { const m = JSON.parse(t) as { n: number; ok: boolean }; confirmacoes.get(m.n)?.(m.ok); confirmacoes.delete(m.n); return; }
    if (/"type":"frame"/.test(t.slice(0, 200)) || /"type":"frame"/.test(t.slice(-300))) { quadros++; if (!primeiroQuadroEm) primeiroQuadroEm = performance.now() - inicio; }
  });
  await new Promise<void>((r, j) => { ws.once("open", () => r()); ws.once("error", j); });
  let n = 0;
  const enviar = (e: EntradaNavegador) => new Promise<boolean>((r) => { const k = ++n; confirmacoes.set(k, r); ws.send(JSON.stringify({ t: "entrada", n: k, e })); });
  return {
    enviar,
    quadros: () => quadros,
    primeiroQuadroEm: () => primeiroQuadroEm,
    async esperarQuadro(desde: number, prazo = 3_000) { const t = performance.now(); while (quadros === desde && performance.now() - t < prazo) await new Promise((r) => setTimeout(r, 2)); return performance.now() - t; },
    fechar: () => ws.close(),
  };
}

describe.skipIf(!LIGADO)("o painel como um navegador normal: login e rotina pela vista local", () => {
  it("entra pelo painel sem perder tecla, abre em < 1 s, responde em < 150 ms e a rotina usa o login", async () => {
    const plataforma = process.platform;
    const chrome = plataforma === "win32" ? chromeDoWindows(process.env) : plataforma === "darwin" ? chromeDoMac(process.env.HOME ?? "") : process.env.NOD_NAVEGADOR_CHROME ?? null;
    if (chrome) expect(existsSync(chrome)).toBe(true);
    const dados = mkdtempSync(join(tmpdir(), "nod-painel-"));
    const motor = criarMotorAgentBrowser({ dados, segredo: randomBytes(32), binario: binarioAgentBrowser(), chrome, ociosoMs: 600_000 });
    const s = { agenteId: "22222222-2222-4222-8222-222222222222" };
    const vista = criarVistaLocal({ motor: async () => motor, conectarStream: (p) => conectarStreamGlobal(p, undefined, 30), relay: relayPadrao, conectarCdp: (u) => conectarCdpGlobal(u) });
    try {
      // O bot chegou na tela de login (o Chrome dele está ligado, como quando ele pede para a pessoa entrar).
      await motor.abrir(s, `${base}/`);
      const { porta, token } = await vista.iniciar();

      // 1. O painel abre: o primeiro quadro chega em menos de 1 s.
      const t0 = performance.now();
      const painel = await abrirPainel(porta, token, s.agenteId);
      await painel.esperarQuadro(0, 5_000);
      const abrirMs = performance.now() - t0;
      process.stdout.write(`painel: primeiro quadro em ${abrirMs.toFixed(0)} ms\n`);
      expect(painel.quadros()).toBeGreaterThan(0);
      expect(abrirMs).toBeLessThan(1_000);

      const centro = async (sel: string) => (await motor.avaliar(s, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)) as { x: number; y: number };
      const clicar = async (sel: string) => {
        const p = await centro(sel);
        expect(await painel.enviar({ t: "mouse", evento: "mousePressed", x: p.x, y: p.y, botao: "left", cliques: 1 })).toBe(true);
        expect(await painel.enviar({ t: "mouse", evento: "mouseReleased", x: p.x, y: p.y, botao: "left", cliques: 1 })).toBe(true);
      };
      const confirmacoes: number[] = [];
      /** Uma tecla como a web manda (keydown com o texto e keyup), cada uma esperando a confirmação. */
      const tecla = async (tecla: string, codigo: string, modificadores = 0) => {
        const t = performance.now();
        const imprime = [...tecla].length === 1;
        expect(await painel.enviar({ t: "tecla", evento: "keyDown", tecla, codigo, ...(imprime ? { texto: tecla } : {}), modificadores })).toBe(true);
        expect(await painel.enviar({ t: "tecla", evento: "keyUp", tecla, codigo, modificadores })).toBe(true);
        confirmacoes.push(performance.now() - t);
      };
      const codigoDe = (c: string) => (/\d/.test(c) ? `Digit${c}` : /[a-z]/i.test(c) ? `Key${c.toUpperCase()}` : c === " " ? "Space" : c === "@" ? "Digit2" : "Unidentified");

      // 2. O CPF, dígito a dígito (a máscara do site reformata a cada um).
      await clicar("#cpf");
      for (const c of "12345678909") await tecla(c, codigoDe(c));
      expect(await motor.avaliar(s, "document.getElementById('cpf').value")).toBe(CPF);

      // 3. A senha: letras (a maiúscula com Shift), o "ã" que o acento composto manda como texto, e o resto colado.
      await clicar("#senha");
      await tecla("S", "KeyS", 8);
      for (const c of "enh") await tecla(c, codigoDe(c));
      expect(await painel.enviar({ t: "tecla", evento: "keyDown", tecla: "Dead", codigo: "Quote" })).toBe(true);
      expect(await painel.enviar({ t: "tecla", evento: "char", texto: "ã" })).toBe(true);
      expect(await painel.enviar({ t: "tecla", evento: "char", texto: "@2026 çé" })).toBe(true);
      // Errou e apagou: Backspace e digita de novo.
      await tecla("x", "KeyX");
      await tecla("Backspace", "Backspace");
      expect(await motor.avaliar(s, "document.getElementById('senha').value")).toBe(SENHA);
      await tecla("Enter", "Enter");

      // 4. O código do SMS, dígito a dígito, e Enter.
      for (let i = 0; i < 50 && (await motor.avaliar(s, "document.getElementById('f2').hidden")) !== false; i++) await new Promise((r) => setTimeout(r, 100));
      await clicar("#codigo");
      for (const c of CODIGO) await tecla(c, codigoDe(c));
      await tecla("Enter", "Enter");
      for (let i = 0; i < 50 && !(await motor.url(s)).endsWith("/area"); i++) await new Promise((r) => setTimeout(r, 100));
      expect(recebidos).toEqual({ cpf: CPF, senha: SENHA, codigo: CODIGO });
      expect(await motor.url(s)).toBe(`${base}/area`);
      const ordenadas = [...confirmacoes].sort((a, b) => a - b);
      process.stdout.write(`teclas: ${confirmacoes.length}, confirmação mediana ${ordenadas[Math.floor(ordenadas.length / 2)]!.toFixed(1)} ms, pior ${ordenadas.at(-1)!.toFixed(1)} ms\n`);

      // 5. Do clique ao quadro novo: mediana de 10 menor que 150 ms.
      const p = await centro("#cor");
      const latencias: number[] = [];
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const antes = painel.quadros();
        const t = performance.now();
        await painel.enviar({ t: "mouse", evento: "mousePressed", x: p.x, y: p.y, botao: "left", cliques: 1 });
        await painel.enviar({ t: "mouse", evento: "mouseReleased", x: p.x, y: p.y, botao: "left", cliques: 1 });
        await painel.esperarQuadro(antes);
        latencias.push(performance.now() - t);
      }
      latencias.sort((a, b) => a - b);
      const mediana = latencias[5]!;
      process.stdout.write(`clique → quadro: mediana ${mediana.toFixed(0)} ms, pior ${latencias[9]!.toFixed(0)} ms\n`);
      expect(mediana).toBeLessThan(150);
      painel.fechar();

      // 6. A pausa: o Chrome do bot fecha (o perfil guarda o login). A rotina do dia seguinte: o bot abre a área logada e
      // busca perfis, sem a pessoa.
      await motor.fechar(s);
      const aberta = await motor.abrir(s, `${base}/area`);
      expect(aberta.url).toBe(`${base}/area`);
      expect(await motor.texto(s, "#ola")).toBe("Olá, José");
      await motor.preencher(s, "#busca", "designer");
      await motor.clicar(s, "#buscar");
      for (let i = 0; i < 50 && !(await motor.url(s)).includes("q=designer"); i++) await new Promise((r) => setTimeout(r, 100));
      const perfis = await motor.avaliar(s, "[...document.querySelectorAll('.perfil')].map((e) => e.textContent)");
      expect(perfis).toEqual(PERFIS.slice(0, 3));
    } finally {
      await vista.parar();
      await motor.fechar(s).catch(() => undefined);
      rmSync(dados, { recursive: true, force: true });
    }
  });
});

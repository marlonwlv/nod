import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-360: mede no Chrome real a troca fala viva -> fala gravada. O topo cobrado é o do primeiro balão,
 * tanto na viewport quanto dentro do artigo; assim a rolagem automática não consegue esconder a perda do resumo.
 */
const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("NOD-360: o CI precisa da web montada (npx vite build) e do Chromium");
const descrever = chrome ? describeIntegracao : describe.skip;
const RESPOSTA = "A fala terminou sem mudar de lugar.";
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Posicao = {
  topo: number;
  topoNoArtigo: number;
  disclosure: string | null;
  aberto: boolean;
};

descrever("NOD-360: a fala não pula quando o turno acaba", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({
      env: { NOD_STATIC_DIR: WEB },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 40 })],
    });
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); }
    await srv.json("POST", "onboarding/concluir", {});
    dir = mkdtempSync(join(tmpdir(), "nod360-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  }, 30_000);

  async function ate(expressao: string, oQue: string, ms = 20_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
      await espera(100);
    }
    throw new Error(`esperei ${ms} ms por ${oQue}`);
  }

  async function criarBot(nome: string): Promise<{ id: string; conversaId: string }> {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Testa a estabilidade da conversa" });
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    return { id: r.agente.id, conversaId: r.conversa.id };
  }

  async function abrirConversa(bot: { id: string }, largura: number, altura: number): Promise<void> {
    const celular = largura < 700;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: celular ? 2 : 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "hover", value: celular ? "none" : "hover" },
      { name: "pointer", value: celular ? "coarse" : "fine" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    await ate(`document.querySelector('[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]')`, "o bot na lista");
    await avaliar(cdp, `document.querySelector('[data-bot-contexto="${bot.id}"] [data-act="abrir-conversa"], button[data-bot-contexto="${bot.id}"]').click()`);
    await ate(`document.getElementById("composer-texto")`, "a conversa");
    await avaliar(cdp, `document.documentElement.style.scrollBehavior = "auto"`);
  }

  const artigoVivo = `document.querySelector('#timeline .message.bot.fala-viva.ao-vivo:has(.bubble)')`;
  const artigoGravado = `[...document.querySelectorAll('#timeline .message.bot[data-mensagem]')].find((m) => m.querySelector('.bubble')?.textContent.includes(${JSON.stringify(RESPOSTA)}))`;

  async function posicao(artigo: string): Promise<Posicao> {
    return avaliar<Posicao>(cdp, `(() => { const a = ${artigo}; const b = a.querySelector(".bubble"); const p = a.querySelector(".pensar"); const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect();
      return { topo: br.top, topoNoArtigo: br.top - ar.top, disclosure: p?.getAttribute("data-disclosure") ?? null, aberto: !!p?.open }; })()`);
  }

  async function provar(largura: number, altura: number): Promise<void> {
    const bot = await criarBot(`Sem pulo ${largura}`);
    await abrirConversa(bot, largura, altura);
    const roteiro = `Confira a posição [[tool: lembrar {"tipo":"fato","texto":"a fala deve ficar estável"}]] [[delta: ${RESPOSTA}]] [[espera: 1800]] [[texto: ${RESPOSTA}]]`;
    await avaliar(cdp, `(() => { const t = document.getElementById("composer-texto"); t.value = ${JSON.stringify(roteiro)}; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector('.composer [data-act="enviar"]').click(); })()`);
    await ate(`${artigoVivo}?.querySelector('.pensar') && ${artigoVivo}?.querySelector('.bubble')?.textContent.includes(${JSON.stringify(RESPOSTA)})`, "a fala viva com resumo e balão");
    await avaliar(cdp, `(() => { const a = ${artigoVivo}; a.scrollIntoView({ block: "center" }); a.querySelector(".pensar > summary").click(); })()`);
    await ate(`${artigoVivo}?.querySelector('.pensar')?.open`, "o resumo vivo aberto");
    const antes = await posicao(artigoVivo);

    await ate(`${artigoGravado}?.querySelector('.pensar[data-fase="pronto"]') && !${artigoGravado}?.classList.contains("ao-vivo")`, "a fala gravada com resumo", 30_000);
    const depois = await posicao(artigoGravado);

    expect(depois.disclosure, "o mesmo disclosure ocupa o mesmo lugar").toBe(antes.disclosure);
    expect(depois.aberto, "o resumo aberto sobrevive à troca").toBe(true);
    expect(depois.topoNoArtigo - antes.topoNoArtigo, "deslocamento do balão dentro da fala").toBe(0);
    expect(depois.topo - antes.topo, "deslocamento do balão na viewport").toBe(0);
  }

  it("mantém 0 px no desktop e no celular, inclusive com o resumo aberto", async () => {
    await provar(1280, 800);
    await provar(390, 844);
  }, 120_000);
});

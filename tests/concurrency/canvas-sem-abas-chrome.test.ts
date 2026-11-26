import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * XUM-10 (relato do dono, 2026-11-26): com as abas abertas, o Canvas de um bot abria com a fileira de abas em cima (só
 * disfarçada por CSS), e a faixa do cabeçalho cobria a barra do canvas: o nome e o ▾ ficavam atrás, e o menu de trocar de
 * canvas aparecia atrás das abas. No app de verdade (a web montada, o servidor completo, o app Canvas instalado e com
 * acesso): o Canvas abre só com a pílula e o botão de abas, a barra e o menu ficam por cima e recebem o clique, e a volta
 * para a Conversa traz as mesmas abas. A lista e a vista do canvas vêm pela interceptação de rede do Chrome (Fetch), para
 * não depender de um bot publicando. Sem a web montada (npx vite build) ou sem Chrome, pula, como os outros e2e de Chrome.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("XUM-10: o CI precisa da web montada (npx vite build) e do Chromium para provar o Canvas sem as abas");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

const item = (id: string, issue: string, titulo: string, estado: "esperando_voce" | "aprovado") =>
  ({ id, issue, titulo, versao: 2, origemUrl: null, atualizadoEm: 1_700_000_000_000, abertos: 0, estado, etapa: null, aprovadoEm: null, telas: 1, jornadas: 1 });
const CANVAS = [item("cvA", "NOD-1", "Agenda do bot", "esperando_voce"), item("cvB", "NOD-2", "Quadro no celular", "aprovado")];
const vista = (c: (typeof CANVAS)[number]) => ({ canvas: c, confiavel: true, versoes: 2, comentarios: [], proximaRodada: 1,
  estrutura: { issue: c.issue, titulo: c.titulo, versaoTexto: null, links: [], css: [], js: [], notas: [], jornadas: [{ id: "J1", titulo: "Entrada", resumo: "Abrir",
    telas: [{ id: "J1-1", jornada: "J1", titulo: "Início", legenda: "Primeira", tamanho: "desk", hoje: true, novo: [], html: "<main>Início</main>", miniatura: null }] }] } });

descrever("XUM-10: o Canvas abre sem as abas e o menu fica por cima (Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];
  let agenteId = "";
  const tarefas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_STATIC_DIR: WEB, NOD_QUADROS: "todos" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })] });
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); agenteId = onb.guia.id; }
    await srv.json("POST", "onboarding/concluir", {});
    // A pílula de páginas (o quadro em teste) e a página Canvas (o app instalado, com acesso deste bot).
    await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
    await srv.json("PUT", "canvas/app", {});
    await srv.json("PUT", `canvas/app/acessos/${agenteId}`, { nivel: "ver_comentar" });
    // Duas tarefas do bot, que viram abas (as abas e o modo abas moram no localStorage do navegador).
    for (const texto of ["Revisar o protótipo da agenda", "Ajustar as cores do quadro"]) {
      // A aba é do trabalho da tarefa (o id que a fileira conhece).
      const r = await srv.json<{ trabalhoId: string }>("POST", `agentes/${agenteId}/tarefas`, { texto });
      tarefas.push(r.trabalhoId);
    }
    dir = mkdtempSync(join(tmpdir(), "canvas-sem-abas-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9750 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
    // A lista e a vista do canvas (o resto vai ao servidor de verdade).
    cdp.ouvir("Fetch.requestPaused", (ev) => {
      const id = ev["requestId"] as string;
      const url = (ev["request"] as { url: string }).url;
      const corpo = /\/agentes\/[^/]+\/canvas(\?|$)/.test(url) ? { canvas: CANVAS }
        : /\/canvas\/cv[AB]\/(versoes|blobs)/.test(url) ? { versoes: [], blobs: {} }
          : /\/canvas\/cv[AB](\?|$)/.test(url) ? vista(CANVAS.find((c) => url.includes(`/canvas/${c.id}`))!) : null;
      if (!corpo) { void cdp.enviar("Fetch.continueRequest", { requestId: id }); return; }
      void cdp.enviar("Fetch.fulfillRequest", { requestId: id, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(corpo)).toString("base64") });
    });
    await cdp.enviar("Fetch.enable", { patterns: [{ urlPattern: "*/canvas*", requestStage: "Request" }] });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas }).catch(() => {});
  });

  const esperarAte = async (expr: string, ms = 8000): Promise<boolean> => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await avaliar<boolean>(cdp, expr)) return true; await espera(100); } return false; };
  const abasNoTopo = () => avaliar<string[]>(cdp, `[...document.querySelectorAll("#cabecalho .abas-tarefa .at-aba")].map((a) => a.dataset.aba)`);
  /** O clique de verdade (mouse do Chrome) no centro do elemento: só acerta se ele estiver por cima no ponto. */
  const centro = (sel: string) => avaliar<{ x: number; y: number }>(cdp, `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  const clicarNoCentro = async (sel: string): Promise<void> => {
    // O mouse chega antes (a doca da pílula abre ao passar e empurra o botão de abas) e o clique vai no lugar de agora.
    let r = await centro(sel);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    await espera(700);
    r = await centro(sel);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    for (const type of ["mousePressed", "mouseReleased"]) await cdp.enviar("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
  };
  /** O elemento do topo no centro de `sel` é ele (ou está dentro dele)? */
  const porCima = (sel: string) => avaliar<boolean>(cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })()`);

  async function abrirComAbas(): Promise<void> {
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    expect(await esperarAte(`!!document.querySelector("#cabecalho")`, 15_000)).toBe(true);
    await avaliar(cdp, `localStorage.setItem("nod:abas-de-tarefa", ${JSON.stringify(JSON.stringify(tarefas.map((id) => ({ id, agenteId }))))}); localStorage.setItem("nod:modo-abas", ${JSON.stringify(JSON.stringify([agenteId]))})`);
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    expect(await esperarAte(`document.querySelectorAll("#cabecalho .abas-tarefa .at-aba").length === ${tarefas.length}`, 15_000)).toBe(true);
    expect(await esperarAte(`!!document.querySelector('#cabecalho .pg-ic[data-pg-id="canvas"]')`, 10_000)).toBe(true);
  }

  it("abrir o Canvas com abas abertas: as abas recolhem para a pílula, o menu do canvas fica por cima e clicável, e a volta traz as mesmas abas", async () => {
    await abrirComAbas();
    expect(await abasNoTopo()).toEqual(tarefas);

    await avaliar(cdp, `document.querySelector('#cabecalho .pg-ic[data-pg-id="canvas"]').click()`);
    expect(await esperarAte(`!!document.querySelector(".cv-fer-nome")`)).toBe(true);
    // A fileira saiu do topo (não só escondida): ficam a pílula do bot e o botão de abas ao lado.
    expect(await esperarAte(`!document.querySelector("#cabecalho .abas-tarefa")`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector("#cabecalho .pilula-e-abas .qd-pil") && !!document.querySelector('#cabecalho .pilula-e-abas [data-act="mostrar-em-abas"]')`)).toBe(true);
    // A barra do canvas começa depois do botão de abas e está por cima de tudo no ponto do nome.
    await esperarAte(`(() => { const a = document.querySelector("#cabecalho .pilula-e-abas").getBoundingClientRect(); return document.querySelector(".cv-fer").getBoundingClientRect().left >= a.right; })()`, 3000);
    expect(await avaliar<boolean>(cdp, `document.querySelector(".cv-fer").getBoundingClientRect().left >= document.querySelector("#cabecalho .pilula-e-abas").getBoundingClientRect().right`)).toBe(true);
    expect(await porCima(".cv-fer-nome")).toBe(true);

    // O menu abre com o clique de verdade, inteiro na tela e por cima em todos os cantos.
    await clicarNoCentro(".cv-fer-nome");
    expect(await esperarAte(`!!document.querySelector(".cv-menu-nome")`)).toBe(true);
    const menu = await avaliar<{ dentro: boolean; cantos: boolean[] }>(cdp, `(() => {
      const m = document.querySelector(".cv-menu-nome"), r = m.getBoundingClientRect();
      const pts = [[r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]];
      return { dentro: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, cantos: pts.map(([x, y]) => m.contains(document.elementFromPoint(x, y))) };
    })()`);
    expect(menu).toEqual({ dentro: true, cantos: [true, true, true, true] });
    // E um item do menu recebe o clique (troca de canvas).
    await clicarNoCentro('.cv-menu-nome .cv-mi[data-id="cvB"]');
    expect(await esperarAte(`(document.querySelector(".cv-fer-nome")?.textContent ?? "").includes("NOD-2")`)).toBe(true);

    // De volta à Conversa: as mesmas abas, com a Conversa (a pílula) ativa.
    await avaliar(cdp, `document.querySelector('#cabecalho .pg-ic[data-pg-id="conversa"]').click()`);
    expect(await esperarAte(`document.querySelectorAll("#cabecalho .abas-tarefa .at-aba").length === ${tarefas.length}`)).toBe(true);
    expect(await abasNoTopo()).toEqual(tarefas);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector("#cabecalho .abas-tarefa .at-pilula.ativa")`)).toBe(true);
  }, 120_000);

  it("no Canvas, o botão de abas ao lado da pílula volta para a Conversa com as abas", async () => {
    await abrirComAbas();
    await avaliar(cdp, `document.querySelector('#cabecalho .pg-ic[data-pg-id="canvas"]').click()`);
    expect(await esperarAte(`!document.querySelector("#cabecalho .abas-tarefa") && !!document.querySelector(".cv-fer-nome")`)).toBe(true);
    await clicarNoCentro('#cabecalho [data-act="mostrar-em-abas"]');
    expect(await esperarAte(`!document.querySelector(".stage")?.classList.contains("qd-no-quadro")`)).toBe(true);
    expect(await esperarAte(`document.querySelectorAll("#cabecalho .abas-tarefa .at-aba").length === ${tarefas.length}`)).toBe(true);
    expect(await abasNoTopo()).toEqual(tarefas);
  }, 120_000);
});

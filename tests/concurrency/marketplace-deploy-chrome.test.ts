import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
 * XUM-9 (app inteiro: servidor completo + a web montada, no Chrome de verdade): a página carregada antes de um deploy
 * clica em "Conectar aplicativos" e o pedaço do modal do Marketplace já não existe no servidor (404, como em produção
 * depois do deploy de 26/11). Antes: o toast "Algo deu errado nesta tela" e o Marketplace não abria. Agora: a web vê o
 * index.html novo, recarrega uma vez e o Marketplace abre sozinho, sem o toast.
 *
 * O deploy é simulado pelo CDP (Fetch): o pedaço do modal responde 404 uma vez, e a sonda do index.html (o `fetch("/")`
 * da web, que o Chrome marca como XHR) recebe o index com outro script principal. A navegação de verdade (a recarga) recebe o index de sempre.
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como os outros e2e de Chrome.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("marketplace no deploy: o CI precisa da web montada (npx vite build) e do Chromium");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FRASE = "Algo deu errado nesta tela";

/** O pedaço do bundle que tem o modal do Marketplace (o `import()` de web/react/marketplace/regiao.tsx). */
function pedacoDoMarketplace(): string {
  const dir = join(WEB, "assets");
  const nome = readdirSync(dir).find((f) => f.endsWith(".js") && readFileSync(join(dir, f), "utf8").includes("desenharMarketplace") && !f.startsWith("index-"));
  if (!nome) throw new Error("não achei o pedaço do Marketplace em dist/web/assets");
  return nome;
}

descrever("botão de apps depois de um deploy (Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];
  let pedaco = "";
  /** Quantas vezes o pedaço ainda responde 404 e se a sonda do index recebe a versão "nova". */
  const deploy = { falhasDoPedaco: 0, indexNovo: false, sondas: 0, pedidosDoPedaco: 0 };

  beforeAll(async () => {
    pedaco = pedacoDoMarketplace();
    srv = await servidorCompleto({ env: { NOD_STATIC_DIR: WEB }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })] });
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); }
    await srv.json("POST", "onboarding/concluir", {});
    dir = mkdtempSync(join(tmpdir(), "marketplace-deploy-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    // Sem cache: o pedaço não pode vir do disco do perfil numa segunda rodada.
    await cdp.enviar("Network.setCacheDisabled", { cacheDisabled: true });
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
    // O pedido que a recarga cancelou some antes da resposta ("Invalid InterceptionId"): não é falha do teste.
    const responder = (metodo: string, params: Record<string, unknown>) => { cdp.enviar(metodo, params).catch(() => undefined); };
    cdp.ouvir("Fetch.requestPaused", (p) => {
      const requestId = p.requestId as string;
      const url = new URL((p.request as { url: string }).url);
      const tipo = p.resourceType as string;
      if (url.pathname === `/assets/${pedaco}`) {
        deploy.pedidosDoPedaco++;
        if (deploy.falhasDoPedaco > 0) {
          deploy.falhasDoPedaco--;
          responder("Fetch.fulfillRequest", { requestId, responseCode: 404, body: Buffer.from("").toString("base64") });
          return;
        }
      } else if (url.pathname === "/" && tipo !== "Document" && deploy.indexNovo) {
        deploy.sondas++;
        const html = readFileSync(join(WEB, "index.html"), "utf8").replace(/(<script\b[^>]*type="module"[^>]*src=")\/assets\/index-[^"]+\.js"/, "$1/assets/index-DEPLOYNOVO.js\"");
        responder("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/html; charset=utf-8" }], body: Buffer.from(html).toString("base64") });
        return;
      }
      responder("Fetch.continueRequest", { requestId });
    });
    await cdp.enviar("Fetch.enable", { patterns: [{ urlPattern: `*/assets/${pedaco}`, requestStage: "Request" }, { urlPattern: "*", resourceType: "Fetch", requestStage: "Request" }] });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  }, 30_000);

  async function ate(expressao: string, oQue: string, ms = 15_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`).catch(() => false)) return;
      await espera(100);
    }
    throw new Error(`esperei ${ms} ms por ${oQue}`);
  }
  const clicarNoBotao = () => avaliar(cdp, `(() => { const el = document.querySelector('[data-act="navegar"][data-tela="conectores"]'); if (!el) throw new Error("não achei o botão de apps"); el.click(); return true; })()`);
  const toast = () => avaliar<boolean>(cdp, `document.body.innerText.includes(${JSON.stringify(FRASE)})`);
  const marketplaceAberto = `document.querySelector("#marketplace dialog.rx-mk[open]")`;

  async function abrirApp(): Promise<void> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    await ate(`document.querySelector('[data-act="navegar"][data-tela="conectores"]') && document.querySelector('[data-act="abrir-conversa"]')`, "a barra com o botão de apps");
  }

  it("página de antes do deploy: o botão de apps recarrega uma vez e abre o Marketplace, sem o toast", async () => {
    await abrirApp();
    await avaliar(cdp, `(window.__antesDoDeploy = true)`);
    // O deploy: o pedaço do modal some do servidor (404) e o index.html aponta para outro script principal.
    deploy.falhasDoPedaco = 1;
    deploy.indexNovo = true;
    await clicarNoBotao();
    await ate(marketplaceAberto, "o Marketplace aberto depois da recarga", 20_000);
    expect(await avaliar<boolean>(cdp, `window.__antesDoDeploy === true`)).toBe(false);
    expect(deploy.sondas).toBe(1);
    expect(deploy.pedidosDoPedaco).toBe(2);
    expect(await toast()).toBe(false);
    // O Marketplace aberto é o de sempre: a busca dos apps à vista.
    expect(await avaliar<boolean>(cdp, `!!document.querySelector("#marketplace dialog.rx-mk[open] input[type=search], #marketplace dialog.rx-mk[open] input")`)).toBe(true);
  }, 90_000);

  it("sem deploy (o mesmo index no servidor), uma falha do pedaço mostra o erro e não recarrega em laço", async () => {
    deploy.indexNovo = false;
    await abrirApp();
    // Sem a hora da recarga do teste anterior: aqui quem segura é o "mesmo index".
    await avaliar(cdp, `(sessionStorage.clear(), window.__semDeploy = true)`);
    deploy.falhasDoPedaco = 1;
    await clicarNoBotao();
    await ate(`document.body.innerText.includes(${JSON.stringify(FRASE)})`, "o erro de sempre");
    expect(await avaliar<boolean>(cdp, `window.__semDeploy === true`)).toBe(true);
  }, 60_000);
});

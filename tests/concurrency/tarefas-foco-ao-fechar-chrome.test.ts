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
 * QA r230: na tela Tarefas, abrir uma tarefa pelo teclado e fechá-la com Esc punha o foco no <body>; quem usa
 * teclado ou leitor de tela recomeçava do topo da página. O foco volta à linha da tarefa (ou ao filtro ativo).
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como os outros e2e de Chrome.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("foco ao fechar a tarefa: o CI precisa da web montada (npx vite build) e do Chromium");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("tela Tarefas: foco ao fechar a tarefa (Chrome real)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  const agentes: string[] = [];
  const conversas: string[] = [];
  let agenteId = "";

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_STATIC_DIR: WEB }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })] });
    const onb = await srv.json<EstadoOnboarding>("GET", "onboarding");
    if (onb.guia) { agentes.push(onb.guia.id); conversas.push(onb.guia.conversaId); agenteId = onb.guia.id; }
    await srv.json("POST", "onboarding/concluir", {});
    dir = mkdtempSync(join(tmpdir(), "tarefas-foco-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9850 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const u = new URL(srv.url);
    await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: cookieDeSessao(srv.pessoa.cookie), domain: u.hostname, path: "/" });
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas }).catch(() => {});
  });

  const tecla = async (key: string, code: string, vk: number, text?: string): Promise<void> => {
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  };
  const foco = () => avaliar<{ cls: string; id: string | null }>(cdp, `({ cls: document.activeElement?.className?.toString() ?? "", id: document.activeElement?.getAttribute("data-id") ?? null })`);
  const esperarAte = async (expr: string, ms = 5000): Promise<boolean> => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await avaliar<boolean>(cdp, expr)) return true; await espera(100); } return false; };

  it("Esc devolve o foco à linha da tarefa", async () => {
    const criada = await srv.json<{ tarefa: { id: string } }>("POST", `agentes/${agenteId}/tarefas`, { texto: "Conferir o extrato de outubro" });
    expect(criada.tarefa.id).toBeTruthy();
    await espera(1500);
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    expect(await esperarAte(`!!document.querySelector('[data-tela="trabalhos"]')`, 10_000)).toBe(true);
    await avaliar(cdp, `document.querySelector('[data-tela="trabalhos"]').click()`);
    expect(await esperarAte(`!!document.querySelector(".tela-tarefas .tf-chip")`)).toBe(true);
    await avaliar(cdp, `[...document.querySelectorAll(".tela-tarefas .tf-chip")].find((b) => b.textContent.trim().startsWith("Todas"))?.click()`);
    await avaliar(cdp, `[...document.querySelectorAll(".tela-tarefas .tf-vista-op")].find((b) => b.textContent.trim() === "Por estado")?.click()`);
    expect(await esperarAte(`!!document.querySelector(".tela-tarefas .tf-tarefa")`)).toBe(true);
    const id = await avaliar<string>(cdp, `document.querySelector(".tela-tarefas .tf-tarefa").getAttribute("data-id")`);

    await avaliar(cdp, `document.querySelector('.tela-tarefas .tf-tarefa[data-id="${id}"]').focus()`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!document.querySelector(".tela-tarefas")`)).toBe(true);
    await espera(500);
    await avaliar(cdp, `document.activeElement?.blur()`);
    await tecla("Escape", "Escape", 27);
    expect(await esperarAte(`!!document.querySelector(".tela-tarefas")`)).toBe(true);
    await esperarAte(`document.activeElement !== document.body`, 2000);
    expect(await foco()).toMatchObject({ cls: expect.stringContaining("tf-tarefa"), id });

  }, 120_000);
});

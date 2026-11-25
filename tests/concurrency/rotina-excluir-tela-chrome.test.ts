import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * QA r235: o Excluir da tela de Rotinas (PR #333) deixava o foco no <body> ao cancelar (o "ocupado" redesenha a linha) e
 * ao excluir (a linha some). Cancelar volta ao Excluir; excluir vai à rotina vizinha ou ao "Nova rotina".
 * Sem a web montada (npx vite build) ou sem Chrome, pula, como os outros e2e de Chrome.
 */
const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EVID = process.env.QA_EVID ?? "";

descrever("Rotinas: Excluir pela tela (Chrome real)", () => {
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
    dir = mkdtempSync(join(tmpdir(), "rotina-excluir-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9840 + (process.pid % 100), join(dir, "perfil")));
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
  const ativo = () => avaliar<string>(cdp, `(() => { const a = document.activeElement; if (!a || a === document.body) return "BODY"; return a.tagName + "." + (a.className?.toString() ?? "") + "[" + (a.getAttribute("data-act") ?? "") + "] " + (a.textContent ?? "").trim().slice(0, 40); })()`);
  const esperarAte = async (expr: string, ms = 5000): Promise<boolean> => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await avaliar<boolean>(cdp, expr)) return true; await espera(100); } return false; };
  const print = async (nome: string) => { if (!EVID) return; const r = await cdp.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" }); writeFileSync(join(EVID, nome), Buffer.from(r.data, "base64")); };
  const criar = (instrucao: string, cron: string) => srv.json<{ ids: { rotinaId: string } }>("POST", "rotinas", { agenteId, cron, fusoIana: "America/Sao_Paulo", instrucao, fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" });

  it("excluir pelo teclado: diálogo, linha some, foco não cai no body", async () => {
    const a = await criar("Resumo das vendas da manhã", "0 9 * * *");
    await criar("Conferir o caixa da tarde", "0 15 * * *");
    await cdp.enviar("Page.navigate", { url: `${srv.url}/` });
    expect(await esperarAte(`!!document.querySelector('[data-tela="trabalhos"]')`, 10_000)).toBe(true);
    await avaliar(cdp, `(() => { const b = document.createElement("button"); b.dataset.act = "navegar"; b.dataset.tela = "rotinas"; document.body.append(b); b.click(); b.remove(); })()`);
    expect(await esperarAte(`!!document.querySelector('#espaco [data-act="agenda-linha"][data-id="${a.ids.rotinaId}"]')`, 8000)).toBe(true);
    await avaliar(cdp, `document.querySelector('#espaco [data-act="agenda-linha"][data-id="${a.ids.rotinaId}"]').focus()`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!!document.querySelector('#espaco [data-act="excluir-rotina"]')`)).toBe(true);
    await print("1-detalhe-aberto.png");
    await avaliar(cdp, `document.querySelector('#espaco [data-act="excluir-rotina"]').focus()`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!!document.querySelector('.rx-dlg')`)).toBe(true);
    await print("2-dialogo.png");
    expect(await ativo()).toContain("Cancelar");
    // Cancelar com Esc: foco volta ao Excluir
    await tecla("Escape", "Escape", 27);
    await esperarAte(`!document.querySelector('.rx-dlg')`);
    await espera(300);
    const aposEsc = await ativo();
    expect(aposEsc).toContain("[excluir-rotina]");
    // De novo, agora confirmando
    await avaliar(cdp, `document.querySelector('#espaco [data-act="excluir-rotina"]').focus()`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!!document.querySelector('.rx-dlg')`)).toBe(true);
    const confirmou = await avaliar<boolean>(cdp, `(() => { const b = [...document.querySelectorAll('.rx-dlg button')].find((x) => x.textContent.trim() === "Excluir"); b?.focus(); return !!b; })()`);
    expect(confirmou).toBe(true);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!document.querySelector('#espaco [data-act="agenda-linha"][data-id="${a.ids.rotinaId}"]')`, 8000)).toBe(true);
    await espera(800);
    await print("3-depois.png");
    const depois = await ativo();
    expect(depois).toContain("[agenda-linha]");
    expect(depois).toContain("Conferir o caixa");

    // A última rotina: a lista fica vazia e o foco vai para o "Nova rotina" da caixa vazia.
    const b = await avaliar<string>(cdp, `document.activeElement.getAttribute("data-id")`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!!document.querySelector('#espaco [data-act="excluir-rotina"][data-id="${b}"]')`)).toBe(true);
    await avaliar(cdp, `document.querySelector('#espaco [data-act="excluir-rotina"]').focus()`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!!document.querySelector('.rx-dlg')`)).toBe(true);
    await avaliar(cdp, `[...document.querySelectorAll('.rx-dlg button')].find((x) => x.textContent.trim() === "Excluir").focus()`);
    await tecla("Enter", "Enter", 13, "\r");
    expect(await esperarAte(`!document.querySelector('#espaco [data-act="agenda-linha"]')`, 8000)).toBe(true);
    await espera(800);
    await print("4-vazia.png");
    const noVazio = await ativo();
    expect(noVazio).toContain("Nova rotina");
  }, 120_000);
});

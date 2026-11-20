import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

const RAIZ = new URL("../../", import.meta.url);
const chrome = (() => { try { return acharChrome() ?? null; } catch { return null; } })();
const descrever = chrome ? describe : describe.skip;

/** NOD-84: a jornada real do cartão e da gaveta no menor celular suportado, inclusive a confirmação de rotação. */
const ENTRADA = `
import { enderecoNoCard, blocoDoEndereco } from "./web/telas/webhook.ts";
const r = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "i", cron: "0 0 31 2 *", fusoIana: "America/Sao_Paulo", estado: "ativa", exigeAprovacao: true, fonte: "", entregavel: "", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: 0, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "webhook", provedor: "GitHub", eventos: ["push"] };
const dto = { rotina: r, proximaExecucao: 0, bloqueio: null, resumo: "Quando o GitHub avisa", espera: null, webhook: { prefixo: "Ab3_xY9z", provedor: "GitHub", eventos: ["push"], chamadasHoje: 0, recusadasHoje: 0, recusaPendente: false, ultimas: [] } };
document.getElementById("palco").innerHTML = enderecoNoCard(dto, "https://nod.exemplo", Date.now()) + blocoDoEndereco(dto, "https://nod.exemplo", true);
document.querySelector('.wh-confirma').hidden = false;
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let css = "";
  for (const f of ["estilos.css", "interface.css", "navegacao.css", "mobile.css"]) css += readFileSync(new URL(`web/${f}`, RAIZ), "utf8");
  const arq = join(dir, "webhook.html");
  writeFileSync(arq, `<meta name="viewport" content="width=device-width"><style>${css}</style><main id="palco" style="width:288px"></main><script>${js.outputFiles[0]!.text}</script>`);
  return pathToFileURL(arq).href;
}

descrever("webhook no celular", () => {
  let cdp: Cdp;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "webhook-celular-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9700 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url: await pagina(dir) });
    await avaliar(cdp, `new Promise((resolve) => document.readyState === "complete" ? resolve(true) : addEventListener("load", () => resolve(true), { once: true }))`);
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  it("mantem todos os controles com alvo de 44 px e sem rolagem lateral", async () => {
    const r = await avaliar<{ botoes: { nome: string; largura: number; altura: number }[]; doc: number; viewport: number }>(cdp, `(() => ({
      botoes: [...document.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { nome: b.textContent.trim() || b.getAttribute('aria-label'), largura: r.width, altura: r.height }; }),
      doc: document.documentElement.scrollWidth, viewport: innerWidth
    }))()`);
    expect(r.doc).toBe(r.viewport);
    for (const b of r.botoes) { expect(b.largura, b.nome).toBeGreaterThanOrEqual(44); expect(b.altura, b.nome).toBeGreaterThanOrEqual(44); }
  });
});

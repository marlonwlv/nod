import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/** QA: revogar e rebaixar o acesso de um bot no Chrome real móvel. */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("o QA de acessos precisa do Chrome");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { estadoInicial } from "./web/estado/reducer.ts";
import { renderDetalhes } from "./web/telas/detalhes.ts";
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Vera", titulo: "Jurídica", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null };
const conector = { id: "k1", ownerId: "p", nome: "Gmail", slug: "gmail", catalogo: [
  { nome: "GMAIL_FETCH_EMAILS", readOnlyHint: true }, { nome: "GMAIL_SEND_EMAIL", readOnlyHint: false }
], habilitado: true, transporte: "http", env: {}, args: [], declaracao: "nao-toca", ultimaFalha: null, sondadoEm: null };
const estado = { ...estadoInicial, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [agente], negacoes: [] },
  conectores: [conector], concessoes: { a1: [
    { id: "g1", agenteId: "a1", conectorId: "k1", capacidade: "GMAIL_FETCH_EMAILS" },
    { id: "g2", agenteId: "a1", conectorId: "k1", capacidade: "GMAIL_SEND_EMAIL" }
  ] }, gaveta: { agenteId: "a1", nivel: { tipo: "acesso", id: "gmail" } } };
window.__montar = () => {
  const n = renderDetalhes(estado);
  document.body.className = "com-detalhes detalhes-abertos";
  document.body.innerHTML = '<main class="detalhes"><div class="gv-corpo">' + n + '</div></main>';
};
`;

descrever("acessos do bot no Chrome real móvel", () => {
  let cdp: Cdp;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-acessos-bot-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
    const css = ["estilos.css", "interface.css", "navegacao.css", "mobile.css"].map((f) => readFileSync(new URL(`web/${f}`, RAIZ), "utf8")).join("\n");
    writeFileSync(join(dir, "acessos.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><script>${js.outputFiles[0]!.text}</script></body></html>`);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9840 + (process.pid % 120), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    await cdp.enviar("Page.navigate", { url: pathToFileURL(join(dir, "acessos.html")).href });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__montar")); i++) await new Promise((r) => setTimeout(r, 25));
    await avaliar(cdp, "window.__montar()");
  }, 120_000);

  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("mantém rebaixamento e revogação tocáveis em 320 px", async () => {
    const resultado = JSON.parse(await avaliar<string>(cdp, `JSON.stringify((() => {
      const botoes = [...document.querySelectorAll('[data-act="revogar-acessos"]')].map((b) => ({ texto: b.textContent.trim(), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
      return { botoes, largura: [document.documentElement.scrollWidth, innerWidth] };
    })())`)) as { botoes: { texto: string; w: number; h: number }[]; largura: [number, number] };
    expect(resultado.botoes.map((b) => b.texto)).toEqual(["Deixar só leitura", "Revogar acesso ao Gmail"]);
    expect(resultado.botoes.filter((b) => b.w < 44 || b.h < 44)).toEqual([]);
    expect(resultado.largura[0]).toBeLessThanOrEqual(resultado.largura[1]);
  });
});

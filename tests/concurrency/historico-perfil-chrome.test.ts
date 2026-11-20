import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/** QA: Histórico do perfil no Chrome real, inclusive Unicode, volume, erro e alvos móveis. */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("o QA do histórico precisa do Chrome");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { nivelHistorico, nivelVersao } from "./web/telas/historico-perfil.ts";
import { HISTORICO_INICIAL } from "./web/lib/historico-perfil.ts";
const agora = new Date(2026, 10, 17, 6, 40).getTime();
const bot = { id: "qa", nome: "QA 👩‍🔬" };
const perfil = (descricao) => ({ nome: bot.nome, titulo: "Qualidade", descricao, forma: "shape-square", cor: "c-purple", voz: null, vozVelocidade: 1 });
const versao = (n) => ({ id: "v" + n, agenteId: bot.id, versao: n, origem: n === 1 ? "inicial" : "tela", autor: "pessoa", propostaId: null,
  restauradaDe: null, perfil: perfil(n === 1 ? "A😀X" : "Missão " + n), campos: n === 1 ? [] : ["descricao"], criadoEm: agora - n * 60000, redigida: false });
const historico = (mudanca = {}) => ({ ...HISTORICO_INICIAL, ...mudanca });
window.__montarLista = () => {
  const versoes = Array.from({ length: 50 }, (_, i) => versao(100 - i));
  const n = nivelHistorico(bot, historico({ lista: { versoes, total: 100, atual: 100, mais: true, virtual: false } }), agora);
  document.body.className = 'com-detalhes detalhes-abertos'; document.body.innerHTML = '<main class="detalhes"><div class="gv-corpo">' + n.corpo + '</div></main>';
};
window.__montarErro = () => {
  const n = nivelHistorico(bot, historico({ erro: true }), agora);
  document.body.className = 'com-detalhes detalhes-abertos'; document.body.innerHTML = '<main class="detalhes"><div class="gv-corpo">' + n.corpo + '</div></main>';
};
window.__montarVersao = () => {
  const v = versao(1);
  const detalhe = { versao: v, atual: perfil("A😁X"), numeroAtual: 100, proxima: 101, restauravel: true, perdeSegredo: false, propostaPendente: null };
  const n = nivelVersao(bot, historico({ detalhe }), 1, agora);
  document.body.className = 'com-detalhes detalhes-abertos'; document.body.innerHTML = '<main class="detalhes"><div class="gv-corpo">' + n.corpo + '</div><footer class="gv-rodape p20-rodape">' + n.rodape + '</footer></main>';
};
`;

descrever("Histórico do perfil no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-historico-perfil-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
    const css = ["estilos.css", "interface.css", "navegacao.css", "historico-perfil.css"].map((f) => readFileSync(new URL(`web/${f}`, RAIZ), "utf8")).join("\n");
    writeFileSync(join(dir, "historico.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><script>${js.outputFiles[0]!.text}</script></body></html>`);
    url = pathToFileURL(join(dir, "historico.html")).href;
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9720 + (process.pid % 120), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await cdp.enviar("Page.navigate", { url });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__montarLista")); i++) await new Promise((r) => setTimeout(r, 25));
  }, 120_000);

  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("preserva emoji no comparativo e mantém as ações tocáveis em 320 px", async () => {
    await avaliar(cdp, "window.__montarVersao()");
    const resultado = JSON.parse(await avaliar<string>(cdp, `JSON.stringify((() => {
      const trecho = document.querySelector('.p20-agora .p20-texto').cloneNode(true); trecho.querySelector('.sr-only')?.remove();
      const texto = trecho.textContent;
      const botoes = [...document.querySelectorAll('button')].map((b) => ({ texto: b.textContent.trim(), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
      return { texto, botoes, largura: [document.documentElement.scrollWidth, innerWidth] };
    })())`)) as { texto: string; botoes: { texto: string; w: number; h: number }[]; largura: [number, number] };
    expect(resultado.texto).toContain("A😁X");
    expect(resultado.texto).not.toContain("�");
    expect(resultado.botoes.filter((b) => b.w < 44 || b.h < 44)).toEqual([]);
    expect(resultado.largura[0]).toBeLessThanOrEqual(resultado.largura[1]);
  });

  it("renderiza 50 de 100 versões e a recuperação de erro sem transbordo", async () => {
    await avaliar(cdp, "window.__montarLista()");
    expect(await avaliar<number>(cdp, "document.querySelectorAll('.p20-versao').length")).toBe(50);
    expect(await avaliar<string>(cdp, "document.body.textContent")).toContain("Mostrando 50 de 100");
    await avaliar(cdp, "window.__montarErro()");
    expect(await avaliar<string>(cdp, "document.querySelector('[data-act=historico-recarregar]').textContent")).toBe("Tentar de novo");
    expect(await avaliar<number>(cdp, "document.querySelector('[data-act=historico-recarregar]').getBoundingClientRect().height")).toBeGreaterThanOrEqual(44);
    expect(await avaliar<boolean>(cdp, "document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  });
});

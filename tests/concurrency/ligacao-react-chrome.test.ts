import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * ADR-179 (item 4): a região `#ligacao` em React no Chrome real, com o CSS do app. Desenha a mesma ligação pelas duas
 * vias (o desenho por string do controle e o componente) e compara as caixas dos elementos — o layout é o mesmo — e mede
 * o redesenho de cada segundo (o cronômetro), que agora passa pelo React.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADR-179: o CI precisa do Chrome para provar a ligação em React (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { partesDaLigacao } from "./web/telas/ligacao.ts";
import { montarLigacaoNoReact } from "./web/react/ligacao/ligacao.tsx";
const ligacao = { id: "l1", agenteId: "a", conversaId: "c1", estado: "em_curso", voz: "bento", iniciadaEm: 0, atendidaEm: 0 };
const tela = (extra) => ({ ligacao, agente: { id: "a", nome: "Nina", cor: "c-blue", forma: "shape-square" }, modo: "cheia", fase: "ouvindo", rotulo: null, desde: 0, agora: 192000,
  legendas: [{ chave: "1", autor: "pessoa", texto: "Oi, tudo bem?", final: true, espera: false }, { chave: "2", autor: "bot", texto: "Tudo! Em que posso ajudar hoje?", final: true, espera: false }],
  janela: null, mudo: false, teclado: false, voz: "bento", velocidade: 1, aviso: { tom: "alerta", texto: "A conexão está instável." }, quemFala: "bot", audioSuspenso: false, sugestoes: ["Resume o dia"], ...extra });
const CAIXAS = [".ligacao-cheia", ".ligacao-pilula", ".lc-topo .lig-bt", "#ligacao-mascote", "#ligacao-info", ".lc-relogio", ".lp-relogio", "#ligacao-aviso", ".aviso-estado", "#ligacao-legenda", ".lc-fala.lc-bot", ".chip-sugestao", "#ligacao-controles", ".lig-bt.desligar", ".lp-onda"];
const caixas = () => Object.fromEntries(CAIXAS.map((s) => { const el = document.querySelector("#ligacao " + s); const r = el?.getBoundingClientRect(); return [s, r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null]; }));
window.__porString = (modo) => {
  const raiz = document.getElementById("ligacao");
  const p = partesDaLigacao(tela({ modo }), null);
  raiz.hidden = false;
  raiz.innerHTML = p.esqueleto;
  for (const [id, h] of [["ligacao-mascote", p.mascote], ["ligacao-info", p.info], ["ligacao-aviso", p.aviso], ["ligacao-legenda", p.legenda], ["ligacao-card", p.card], ["ligacao-teclado", p.teclado], ["ligacao-controles", p.controles]]) { const a = raiz.querySelector("#" + id); if (a) a.innerHTML = h; }
  return caixas();
};
let atual = null; const ouvintes = new Set(); let raizReact = null;
window.__porReact = (modo) => {
  const raiz = document.getElementById("ligacao");
  raizReact?.unmount();
  raiz.replaceChildren();
  atual = { t: tela({ modo }), card: null, avaliacao: null, recusa: null };
  const noop = () => undefined;
  raizReact = montarLigacaoNoReact(raiz, { instantaneo: () => atual, assinar: (f) => { ouvintes.add(f); return () => ouvintes.delete(f); } },
    new Proxy({}, { get: () => noop }));
  return caixas();
};
/** n tiques do cronômetro (cada um, um instantâneo novo, como o controle faz): a média em ms por tique, com o estilo e o layout. */
window.__tiques = (n) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { atual = { ...atual, t: { ...atual.t, agora: atual.t.agora + 1000 } }; for (const f of ouvintes) f(); document.body.offsetHeight; }
  return (performance.now() - t0) / n;
};
`;
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

descrever("ADR-179: a ligação em React no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-lig-rx-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent", jsx: "automatic", outdir: dir, loader: { ".css": "empty" }, minify: true, define: { "process.env.NODE_ENV": '"production"' } });
    let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
    html = html.replace(/<link rel="stylesheet" href="\/([\w/-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles.find((f) => f.path.endsWith(".js"))!.text}</script>`);
    writeFileSync(join(dir, "p.html"), html);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url: pathToFileURL(join(dir, "p.html")).href });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__porReact")); i++) await esperar(50);
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  it.each(["cheia", "pilula"])("%s: as caixas dos elementos são as mesmas do desenho por string", async (modo) => {
    const porString = await avaliar<Record<string, number[] | null>>(cdp, `window.__porString(${JSON.stringify(modo)})`);
    const porReact = await avaliar<Record<string, number[] | null>>(cdp, `window.__porReact(${JSON.stringify(modo)})`);
    expect(Object.values(porString).filter(Boolean).length).toBeGreaterThan(6);
    expect(porReact).toEqual(porString);
  }, 60_000);

  it("o tique do cronômetro pelo React: abaixo de 2 ms por segundo de ligação (build de produção)", async () => {
    await avaliar(cdp, `window.__porReact("cheia")`);
    await avaliar(cdp, "window.__tiques(30)");
    const ms = await avaliar<number>(cdp, "window.__tiques(200)");
    process.stdout.write(`ligação em React: ${ms.toFixed(3)} ms por tique\n`);
    expect(ms).toBeLessThan(2);
  }, 60_000);
});

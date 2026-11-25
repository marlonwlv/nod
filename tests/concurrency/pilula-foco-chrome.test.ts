import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * QA-165 (r165): o foco não cai no <body> quando a pílula do bot é redesenhada com ele dentro, no Chrome real — o "Parar"
 * que some depois de parar tudo e a linha da tarefa que terminou (vai para as prontas recolhidas) ou saiu. (A pílula que
 * vira a aba vazia já leva o foco ao campo no main.ts, `aoSumir`.)
 */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("QA-165: o CI precisa do Chrome para provar o foco da pílula");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarPilulaNaTela } from "./web/lib/pilula-na-tela.ts";
import { linhaDaTarefa } from "./web/telas/progresso-na-fala.ts";
const f = (id, estado) => ({ trabalhoId: id, titulo: "Tarefa " + id, estado, passo: null });
const corpo = (rodando, prontas) => '<h3 class="pf-secao">Rodando</h3><ul class="pf-lista">' + rodando.map((id) => linhaDaTarefa(f(id, "rodando"), "lista")).join("") + '</ul>'
  + (prontas.length ? '<details class="pf-prontas"><summary>' + prontas.length + ' prontas</summary><ul class="pf-lista">' + prontas.map((id) => linhaDaTarefa(f(id, "pronta"), "lista")).join("") + '</ul></details>' : "")
  + '<button type="button" class="pf-nova-linha" data-act="nova-tarefa">+ Nova tarefa</button>';
const cab = '<span class="pf-cab-titulo"><b>Ada</b></span><button type="button" class="pf-fechar" data-act="pilula" data-recolher="1" aria-expanded="true" aria-controls="pf-painel">fechar</button>';
const pe = (parar) => '<button type="button" class="pf-ver" data-act="pilula-ver-na-conversa">Ver na conversa</button>' + (parar ? '<button type="button" class="pf-parar" data-act="pilula-parar">Parar</button>' : "");
window.__partes = (rodando, prontas, parar) => ({ chave: "a", botao: "<span class='pf-texto'>" + rodando.length + " tarefas</span>", memoria: "", rotulo: "Tarefas da Ada", cab, corpo: corpo(rodando, prontas), pe: pe(parar), telemetria: null });
window.__montar = () => {
  document.body.innerHTML = '<button id="antes">antes</button><div id="palco"><div id="faixa"></div></div><textarea id="campo"></textarea>';
  const p = criarPilulaNaTela(document.getElementById("faixa"), document.getElementById("palco"), { reduzido: () => true, agendar: (fn, ms) => setTimeout(fn, ms), cancelar: (id) => clearTimeout(id) });
  window.__p = p;
  p.desenhar({ tipo: "pilula", partes: window.__partes(["t1", "t2", "t3"], [], true), aberta: true, escondida: false });
};
window.__foco = () => { const a = document.activeElement; return a === document.body || !a ? "body" : (a.dataset.act || a.id || a.tagName) + (a.dataset.id ? ":" + a.dataset.id : ""); };
`;

descrever("QA-165: o foco da pílula do bot no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-pilula-foco-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent", outdir: dir, loader: { ".css": "empty" } });
    writeFileSync(join(dir, "p.html"), `<!doctype html><meta charset="utf-8"><body><script>${js.outputFiles.find((x) => x.path.endsWith(".js"))!.text}</script></body>`);
    url = pathToFileURL(join(dir, "p.html")).href;
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Runtime.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  async function montar(): Promise<void> {
    await cdp.enviar("Page.navigate", { url });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__montar")); i++) await new Promise((r) => setTimeout(r, 50));
    await avaliar(cdp, "window.__montar()");
  }
  const desenhar = (js: string): Promise<string> => avaliar<string>(cdp, `(() => { window.__p.desenhar(${js}); return window.__foco(); })()`);
  const focar = (sel: string): Promise<string> => avaliar<string>(cdp, `(() => { document.querySelector(${JSON.stringify(sel)}).focus(); return window.__foco(); })()`);

  it("parar tudo: o Parar some do pé e o foco fica no painel", async () => {
    await montar();
    expect(await focar(".pf-parar")).toBe("pilula-parar");
    expect(await desenhar(`{ tipo: "pilula", partes: window.__partes(["t1", "t2", "t3"], [], false), aberta: true, escondida: false }`)).toBe("pilula-ver-na-conversa");
  });

  it("a tarefa focada termina (vai para as prontas recolhidas) e o foco não cai no body", async () => {
    await montar();
    expect(await focar('[data-act="abrir-trabalho"][data-id="t2"]')).toBe("abrir-trabalho:t2");
    expect(await desenhar(`{ tipo: "pilula", partes: window.__partes(["t1", "t3"], ["t2"], true), aberta: true, escondida: false }`)).toBe("SUMMARY");
  });

  it("a tarefa focada sai da lista e o foco vai para a vizinha", async () => {
    await montar();
    await focar('[data-act="abrir-trabalho"][data-id="t2"]');
    expect(await desenhar(`{ tipo: "pilula", partes: window.__partes(["t1", "t3"], [], true), aberta: true, escondida: false }`)).toBe("abrir-trabalho:t3");
    // A última da lista sai: o foco vai para o "+ Nova tarefa", que passa a ocupar o lugar dela.
    await focar('[data-act="abrir-trabalho"][data-id="t3"]');
    expect(await desenhar(`{ tipo: "pilula", partes: window.__partes(["t1"], [], true), aberta: true, escondida: false }`)).toBe("nova-tarefa");
  });
});

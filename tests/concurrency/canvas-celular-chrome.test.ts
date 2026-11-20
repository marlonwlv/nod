import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * QA 2026-11-16: os controles novos do Canvas precisam continuar tocáveis num celular real. A prova usa o HTML e o CSS
 * de produção e verifica os quatro pontos cardeais a 22 px do centro, como a auditoria geral de alvos do produto.
 */
const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("Canvas: esta prova precisa do Chrome");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { htmlDaBarra, htmlDoAviso, htmlDosPinos, numerarPinos } from "./web/lib/canvas-html.ts";
const comentario = { id: "c1", telaId: "J1-1", jornada: "J1", tipo: "pino", x: .5, y: .5, texto: "Aumentar o botão", autorTipo: "pessoa", autorNome: null, paiId: null, versao: 1, rodada: 1, confiavel: true, resolvido: false, arquivado: false, criadoEm: 1 };
document.body.innerHTML = '<main class="cv" style="height:100vh">' +
  '<div class="cv-topo">' + htmlDaBarra({ nome: "NOD-512", versao: 3, vendo: null, onde: "J1-1", pct: 1, modo: null, rascunhos: 1, abertos: 1, vivo: false, enviando: false, menu: null, apresentando: false, podeLink: true }) + htmlDoAviso({ chave: "ok", tipo: "ok", texto: "Rodada enviada", fechar: true }) + '</div>' +
  '<div class="cv-palco"><div class="cv-mundo" style="transform:translate(0,0) scale(1);--cv-inv:1;--cv-k:1"><div class="cv-pinos" style="position:absolute;left:120px;top:260px;width:200px;height:200px">' + htmlDosPinos({ tela: "J1-1", comentarios: [comentario], numeros: numerarPinos([comentario]), rascunhos: [], ativo: null, velha: false, novo: null }) + '</div></div></div>' +
  '</main>';
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: fileURLToPath(RAIZ), loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  const css = ["tokens.css", "estilos.css", "interface.css", "canvas.css"].map((f) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`).join("");
  const arq = join(dir, "canvas-celular.html");
  writeFileSync(arq, `<!doctype html><html><head><meta name="viewport" content="width=device-width">${css}</head><body><script>${js.outputFiles[0]!.text}</script></body></html>`);
  return pathToFileURL(arq).href;
}

descrever("Canvas no Chrome real: alvos de toque no celular", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "canvas-celular-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  it("pino, ferramentas e fechar aviso aceitam toque nos quatro lados", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await avaliar(cdp, "document.fonts.ready");
    const falhas = await avaliar<string[]>(cdp, `(() => {
      const seletores = ['.cv-pino', '[data-cv="anterior"]', '[data-cv="comentar"]', '.cv-aviso-x'];
      const falhas = [];
      for (const seletor of seletores) {
        const el = document.querySelector(seletor); if (el.closest('.cv-fer')) el.scrollIntoView({ block: 'nearest', inline: 'center' }); const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        for (const [lado, x, y] of [['norte', cx, cy - 21], ['sul', cx, cy + 21], ['oeste', cx - 21, cy], ['leste', cx + 21, cy]]) {
          const alvo = document.elementFromPoint(x, y);
          if (alvo !== el && !el.contains(alvo)) falhas.push(seletor + ':' + lado + ':' + Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) + ':alvo=' + (alvo?.className || alvo?.tagName || 'nenhum'));
        }
      }
      return falhas;
    })()`);
    expect(falhas).toEqual([]);
    expect(await avaliar<boolean>(cdp, "document.documentElement.scrollWidth === 390")).toBe(true);
  });
});

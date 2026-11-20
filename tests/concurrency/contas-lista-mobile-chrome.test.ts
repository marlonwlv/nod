import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { ContaIa, ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { renderListaDeContas, UI_CONTAS_INICIAL } from "../../web/telas/contas-lista.ts";

/** QA de 2026-11-17: a lista volumosa de contas de IA usa os estilos reais em Chromium a 320 px. */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir os alvos das contas de IA no celular");
const descrever = chrome ? describe : describe.skip;
const maquina: MaquinaDto = {
  id: "11111111-1111-4111-8111-111111111111", nome: "vm-qa", prefixo: "qa", criadaEm: 1,
  ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false,
};

function conta(i: number): ContaIa {
  const n = String(i).padStart(2, "0");
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ia: i % 2 ? "claude-cli" : "codex-cli", impressao: n.repeat(32),
    apelido: `Conta ${n} 👩🏽‍💻`, email: `pessoa${n}@exemplo.com`, organizacao: "Organização internacional com nome longo",
    plano: i % 2 ? "Max" : "Plus", corporativa: i % 3 === 0, posicao: i,
    entraNaTrocaAutomatica: i < 3, noLimiteAte: i === 3 ? Date.now() + 3_600_000 : null,
    maquinas: [{ maquinaId: maquina.id, nome: maquina.nome, estado: "pronta" }],
  };
}

const CONTAS: ContasIaDto = { disponivel: true, modo: "perguntar", contas: Array.from({ length: 100 }, (_, i) => conta(i + 1)) };
const renderTela = (ui = UI_CONTAS_INICIAL) => renderListaDeContas({
  contas: CONTAS, maquinas: [maquina], detalhes: null, agora: Date.now(), noApp: false,
  botsNaMaquina: () => ["Ada"], cartaoDoMac: () => "", ui,
});

descrever("Contas de IA no celular (Chrome real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-contas-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const estilos = [...readFileSync("web/index.html", "utf8").matchAll(/href="\/([^"]+\.css)"/g)].map((m) => `web/${m[1]}`).filter(existsSync);
    const css = estilos.map((p) => readFileSync(p, "utf8")).join("\n");
    const tela = renderTela();
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main id="app" class="espaco-corpo">${tela}</main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém os controles com alvo de 44 px e sem rolagem lateral", async () => {
    const medidas = await avaliar<{ seletor: string; largura: number; altura: number }[]>(cdp, `[...document.querySelectorAll(".cl-alca,.cl-mais-bt")].slice(0,2).map((el) => { const r=el.getBoundingClientRect(); return {seletor:el.className,largura:r.width,altura:r.height} })`);
    const fila = await avaliar<boolean[]>(cdp, `(() => { const el=document.querySelector(".cl-fila"),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2; return [[x,y-21.5],[x+21.5,y],[x,y+21.5],[x-21.5,y]].map(([a,b])=>{const sob=document.elementFromPoint(a,b);return sob===el||el.contains(sob)}) })()`);
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
    expect(medidas.filter((m) => m.largura < 44 || m.altura < 44)).toEqual([]);
    expect(fila).toEqual([true, true, true, true]);
  });

  it("mantém as ações do menu e da confirmação com 44 px", async () => {
    const id = CONTAS.contas[0]!.id;
    await avaliar(cdp, `document.querySelector("#app").innerHTML=${JSON.stringify(renderTela({ ...UI_CONTAS_INICIAL, menu: id }))}`);
    const menu = await avaliar<number[]>(cdp, `[...document.querySelectorAll(".cl-menu button")].map((el)=>el.getBoundingClientRect().height)`);
    await avaliar(cdp, `document.querySelector("#app").innerHTML=${JSON.stringify(renderTela({ ...UI_CONTAS_INICIAL, confirmar: { tipo: "remover", contaId: id, frentes: [] } }))}`);
    const confirmacao = await avaliar<number[]>(cdp, `[...document.querySelectorAll(".cl-dialogo-acoes button")].map((el)=>el.getBoundingClientRect().height)`);
    expect(menu.filter((altura) => altura < 44)).toEqual([]);
    expect(confirmacao.filter((altura) => altura < 44)).toEqual([]);
  });
});

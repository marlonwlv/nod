import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * QA de 2026-11-16: os filtros da Atividade mediam 40 px no celular, embora sejam ações isoladas e o produto use
 * 44 px como alvo mínimo de toque. A prova usa os estilos reais em Chromium com viewport e ponteiro de celular.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir os alvos da Atividade no celular");
const descrever = chrome ? describe : describe.skip;

descrever("Atividade no celular (Chrome real, 390×844)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-atv-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9750 + (process.pid % 150), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/navegacao.css", "web/mobile.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div id="detalhes"><div class="atv"><div class="atv-abas"><button class="atv-aba">Atividade</button><button class="atv-aba">Decisões</button></div><div class="atv-filtros"><button class="atv-filtro">Tudo</button><button class="atv-filtro">Sem aprovação</button><button class="atv-filtro">Frentes</button><button class="atv-filtro">Bloqueios</button><button class="atv-filtro">Máquina e IA</button></div><button class="atv-dia">Dia anterior ›</button></div></div>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém filtros, abas e troca de dia com pelo menos 44 px de altura", async () => {
    const medidas = await avaliar<{ texto: string; altura: number }[]>(cdp, `[...document.querySelectorAll("button")].map((el) => ({ texto: el.textContent.trim(), altura: el.getBoundingClientRect().height }))`);
    expect(medidas).not.toHaveLength(0);
    for (const medida of medidas) expect(medida.altura, medida.texto).toBeGreaterThanOrEqual(44);
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  });
});

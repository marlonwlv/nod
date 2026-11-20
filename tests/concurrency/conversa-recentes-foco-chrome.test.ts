import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * QA-110 (2026-11-19): no celular, o topo da conversa tem um "Recentes" só para o leitor de tela (o atalho do segurar o ‹).
 * Com teclado, o Tab parava nele e o anel de foco ficava num ponto de 1×1 px, recortado pelo .sr-only. Focado pelo
 * teclado, ele tem de aparecer como alvo de verdade, sem estourar a largura.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir o foco do Recentes no celular");
const descrever = chrome ? describe : describe.skip;

descrever("Recentes do topo da conversa no celular (Chrome real, 320×640)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-recentes-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 100), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/navegacao.css", "web/mobile.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><header id="cabecalho" class="cabecalho cabecalho-pilula"><button type="button" class="abrir-bots voltar-bots" data-act="abrir-bots" aria-label="Voltar para Conversas">‹</button><button type="button" class="sr-only abrir-recentes-leitor" data-act="abrir-recentes">Recentes</button><button type="button" class="pilula-bot">Bot</button></header>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("aparece com pelo menos 44 px quando o Tab chega nele", async () => {
    await avaliar(cdp, `document.querySelector(".voltar-bots").focus()`);
    const tab = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", ...tab });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    const m = await avaliar<{ act: string | null; w: number; h: number; direita: number }>(cdp, `(() => { const e = document.activeElement; const r = e.getBoundingClientRect();
      return { act: e.getAttribute("data-act"), w: r.width, h: r.height, direita: r.right }; })()`);
    expect(m.act).toBe("abrir-recentes");
    expect(m.h).toBeGreaterThanOrEqual(44);
    expect(m.w).toBeGreaterThanOrEqual(44);
    expect(m.direita).toBeLessThanOrEqual(320);
  });

  it("segue escondido para quem não está nele", async () => {
    await avaliar(cdp, `document.querySelector(".pilula-bot").focus()`);
    const w = await avaliar<number>(cdp, `document.querySelector(".abrir-recentes-leitor").getBoundingClientRect().width`);
    expect(w).toBeLessThanOrEqual(1);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { htmlDoAvisoDosTermos } from "../../web/telas/aviso-termos.ts";

/**
 * QA de 2026-11-17: o aviso aparece justamente antes de ligar uma troca automática de conta. Cancelar e confirmar são
 * ações sensíveis e precisam manter o alvo mínimo do produto também no menor celular suportado.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir o aviso dos termos no celular");
const descrever = chrome ? describe : describe.skip;

descrever("aviso dos termos no celular (Chrome real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-termos-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9750 + (process.pid % 150), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/mobile.css"].map((p) => readFileSync(p, "utf8")).join("\n");
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><button id="origem">Trocar sozinho</button><dialog class="bot-dialogo" aria-labelledby="aviso-termos-titulo">${htmlDoAvisoDosTermos("codex-cli")}</dialog>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close(); document.querySelector("dialog").showModal(); document.querySelector("[data-nao]").focus()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém as duas decisões alcançáveis por toque, sem transbordo e com Cancelar em foco", async () => {
    const medidas = await avaliar<{ texto: string; largura: number; altura: number }[]>(cdp, `[...document.querySelectorAll("dialog button")].map((el) => { const r = el.getBoundingClientRect(); return { texto: el.textContent.trim(), largura: r.width, altura: r.height } })`);
    expect(medidas).toHaveLength(2);
    for (const medida of medidas) {
      expect(medida.largura, medida.texto).toBeGreaterThanOrEqual(44);
      expect(medida.altura, medida.texto).toBeGreaterThanOrEqual(44);
    }
    expect(await avaliar<string>(cdp, "document.activeElement.textContent.trim()" )).toBe("Cancelar");
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
  });
});

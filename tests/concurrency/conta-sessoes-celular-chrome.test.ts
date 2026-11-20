import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { htmlEtapa } from "../../web/telas/conta-no-chat.ts";

/**
 * QA de 2026-11-17: a lista de sessões é a saída de emergência quando uma pessoa não reconhece outro acesso. O menor
 * celular suportado precisa deixar a confirmação destrutiva tocável mesmo com muitos aparelhos e nomes extensos.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir sessões no celular");
const descrever = chrome ? describe : describe.skip;

descrever("sessões da conta no celular (Chrome real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-sessoes-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });

    const sessoes = Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      origem: "web" as const,
      aparelho: i === 1 ? `Windows · Edge · ${"computador-com-nome-muito-longo-".repeat(4)}` : `Aparelho ${i + 1}`,
      criadaEm: 0,
      ultimoUsoEm: i * 60_000,
      revogadaEm: null,
    }));
    const html = htmlEtapa({ tipo: "sessoes", dados: { atual: "s0", sessoes }, confirmar: true, erro: false }, { ocupado: false, google: false, agora: 7_200_000 });
    const css = ["web/tokens.css", "web/estilos.css", "web/conta.css", "web/mobile.css", "web/celular-base.css"].map((p) => readFileSync(p, "utf8")).join("\n");
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="cc-bloco">${html}</main>`)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém nomes contidos e as duas decisões com alvo de 44 px", async () => {
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
    const medidas = await avaliar<{ texto: string; largura: number; altura: number }[]>(cdp, `[...document.querySelectorAll(".cc-acoes button")].map((el) => { const r = el.getBoundingClientRect(); return { texto: el.textContent.trim(), largura: r.width, altura: r.height } })`);
    expect(medidas).toHaveLength(2);
    for (const medida of medidas) {
      expect(medida.largura, medida.texto).toBeGreaterThanOrEqual(44);
      expect(medida.altura, medida.texto).toBeGreaterThanOrEqual(44);
    }
  });
});

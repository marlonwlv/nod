import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { motivoDoCartao, renderCartaoRevisor } from "../../web/telas/cartao-revisor.ts";
import { renderConfirmaTotal, renderMenuModo } from "../../web/telas/aprovacoes.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir aprovações no celular");
const descrever = chrome ? describe : describe.skip;

descrever("aprovações no celular (Chrome real, 390×844)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-aprov-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 150), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/mobile.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const motivo = `${"a".repeat(158)}😀zz`;
    const card = renderCartaoRevisor({
      decisaoId: "d1",
      pergunta: "Enviar a atualização para a equipe?",
      motivo: motivoDoCartao([{ motivoManual: "revisor_pediu", justificativa: motivo }]),
      detalhe: null,
      sempre: { titulo: "Vale para este tipo de ação" },
    }, "aberto");
    const menu = renderMenuModo("Assistente de operações", "automatico").replace('<p class="modo-rodape">', `${renderConfirmaTotal("Assistente de operações")}<p class="modo-rodape">`);
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main><ul class="lista">${card}</ul><div class="bot-menu modo-menu">${menu}</div></main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém ações tocáveis, texto Unicode inteiro e conteúdo dentro da tela", async () => {
    const medidas = await avaliar<{ texto: string; altura: number }[]>(cdp, `[...document.querySelectorAll("button")].map((el) => ({ texto: el.textContent.trim(), altura: el.getBoundingClientRect().height }))`);
    expect(medidas).not.toHaveLength(0);
    for (const medida of medidas) expect(medida.altura, medida.texto).toBeGreaterThanOrEqual(44);
    expect(await avaliar<string>(cdp, "document.querySelector('.cr-motivo').textContent")).toContain("😀…");
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  });
});

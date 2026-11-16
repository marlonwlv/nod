import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { htmlDialogoComputador, htmlPilula } from "../../web/lib/computador.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o QA do computador precisa de Chromium");

const descrever = chrome ? describe : describe.skip;

descrever("computador do bot no celular (Chrome real, 390×844)", () => {
  let cdp: Cdp;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-computador-celular-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
  });

  afterAll(() => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("fechar, assumir e parar têm alvo de pelo menos 44 px, sem rolagem lateral", async () => {
    const css = ["web/estilos.css", "web/interface.css", "web/computador-do-bot.css"]
      .filter(existsSync)
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const corpo = htmlDialogoComputador("Nina").replace(htmlPilula("Nina", "assistindo", true), htmlPilula("Nina", "assistindo"));
    const pagina = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><dialog class="computador-dialog" open>${corpo}</dialog>`;
    await cdp.enviar("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(pagina)}` });
    await new Promise((r) => setTimeout(r, 150));

    const medir = (sel: string) => avaliar<string>(cdp, `JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { w: r.width, h: r.height }; })())`).then((v) => JSON.parse(v) as { w: number; h: number });
    const fechar = await medir(".computador-fechar");
    const assumir = await medir(".computador-pilula-bt");

    await avaliar(cdp, `document.querySelector(".computador-pilula").outerHTML = ${JSON.stringify(htmlPilula("Nina", "controle"))}`);
    const parar = await medir(".computador-pilula-bt");
    const alvos = { fechar, assumir, parar };
    if (Object.values(alvos).some(({ w, h }) => w < 44 || h < 44)) throw new Error(`alvos menores que 44 px: ${JSON.stringify(alvos)}`);
    const largura = JSON.parse(await avaliar<string>(cdp, `JSON.stringify([document.documentElement.scrollWidth, innerWidth])`)) as [number, number];
    expect(largura[0]).toBeLessThanOrEqual(largura[1]);
  });
});

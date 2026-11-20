import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { SuaVezDto } from "../../src/contracts/api.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { estadoInicial } from "../../web/estado/reducer.ts";
import { renderSuaVez } from "../../web/telas/sua-vez.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir Sua vez no celular");
const descrever = chrome ? describe : describe.skip;

function item(id: string, vencido = false): SuaVezDto["itens"][number] {
  return {
    decisao: {
      tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: "tr",
      tipo: "acesso", estado: vencido ? "vencida" : "pendente", prazoDecisaoEm: "2026-11-18T14:40:00Z",
      prazoExecucaoEm: null, frase: `Permitir uma ação muito longa ${"á😀".repeat(80)}`, desfecho: null,
      vistaEm: null, criadoEm: "2026-11-17T14:40:00Z", fioId: null,
    },
    estadoColuna: vencido ? "vencido" : "pendente", agenteNome: "Ada", aguardandoHaMs: 1_000,
    recusaAutomaticaEmMs: 86_400_000, gemeas: [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
  };
}

descrever("Sua vez no celular (Chrome real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-sua-vez-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/mobile.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const itens = [item("aberta"), ...Array.from({ length: 60 }, (_, n) => item(`vencida-${n}`, true))];
    const corpo = renderSuaVez({ ...estadoInicial, agora: Date.parse("2026-11-17T14:40:00Z"), suaVez: { itens, incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } });
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main>${corpo}</main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém decisões e vencidos utilizáveis por toque sem transbordar", async () => {
    if (process.env.NOD_PRINTS) {
      mkdirSync(process.env.NOD_PRINTS, { recursive: true });
      const { data } = await cdp.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(process.env.NOD_PRINTS, `${process.env.NOD_PRINT_NOME ?? "sua-vez-mobile"}.png`), Buffer.from(data, "base64"));
    }
    const medidas = await avaliar<{ texto: string; largura: number; altura: number }[]>(cdp, `[...document.querySelectorAll(".tela-sua-vez button, .tela-sua-vez summary")].map((el) => { const r = el.getBoundingClientRect(); return { texto: el.textContent.trim(), largura: r.width, altura: r.height }; })`);
    expect(medidas).not.toHaveLength(0);
    for (const medida of medidas) {
      expect(medida.altura, medida.texto).toBeGreaterThanOrEqual(44);
      expect(medida.largura, medida.texto).toBeGreaterThanOrEqual(44);
    }
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
  });
});

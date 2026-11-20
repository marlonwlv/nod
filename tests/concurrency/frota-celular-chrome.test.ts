import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { estadoInicial } from "../../web/estado/reducer.ts";
import { renderInventario } from "../../web/telas/frota.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/** QA de 2026-11-16: os controles da conexão são ações isoladas e precisam do alvo móvel de 44 px. */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o QA da Frota precisa de Chromium");
const descrever = chrome ? describe : describe.skip;
const pronto = (versao: string): Inventario => ({ estado: "pronto", versao, em: 1 });

descrever("Frota no celular (Chrome real, 390×844)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-frota-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9700 + (process.pid % 200), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/navegacao.css", "web/mobile.css"]
      .filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const executor = {
      atual: "catcher" as const,
      recusa: "claude-cli em sombra: nao_autenticado: faça login",
      harnesses: { simulacao: true, padrao: null, legado: "claude-cli" as const, opcoes: [] },
      opcoes: [
        { id: "catcher" as const, custo: "zero" as const, inventario: pronto("catcher") },
        { id: "claude-cli" as const, custo: "real" as const, inventario: { estado: "nao_autenticado" as const, motivo: "faça login", em: 1 } },
        { id: "codex-cli" as const, custo: "real" as const, inventario: { estado: "ausente" as const, motivo: "conecte sua conta", em: 1 } },
      ],
    };
    const corpo = renderInventario({ ...estadoInicial, agora: 2, executor });
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="espaco-conteudo"><section class="espaco-cartao">${corpo}</section></main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close(); document.querySelector(".conexao-avancada").open = true`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém resumo, nova sonda e trocas com pelo menos 44 px", async () => {
    const medidas = await avaliar<{ texto: string; largura: number; altura: number }[]>(cdp, `[...document.querySelectorAll("summary, button")].map((el) => { const r = el.getBoundingClientRect(); return { texto: el.textContent.trim(), largura: r.width, altura: r.height }; })`);
    expect(medidas).not.toHaveLength(0);
    for (const medida of medidas) {
      expect(medida.altura, medida.texto).toBeGreaterThanOrEqual(44);
      expect(medida.largura, medida.texto).toBeGreaterThanOrEqual(44);
    }
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { RotinaDto } from "../../src/contracts/api.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { estadoInicial, type Estado } from "../../web/estado/reducer.ts";
import { htmlRodarMaisUma } from "../../web/lib/executar-rotina.ts";
import { renderRotinas } from "../../web/telas/rotinas.ts";

/** QA de 2026-11-17: executar uma rotina e confirmar outra execução no celular. */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o QA de executar rotina precisa de Chromium");
const descrever = chrome ? describe : describe.skip;

const AGORA = Date.parse("2026-11-17T13:00:00Z");
const rotina = {
  rotina: {
    id: "r1", agenteId: "b1", conversaId: "c1", ownerId: "p", estado: "ativa", cron: "*/20 * * * *",
    fusoIana: "UTC", instrucao: "Revisar os PRs e relatar somente mudanças novas", fonte: "GitHub",
    entregavel: "Resumo nesta conversa", limitesAprovacao: "Ações externas passam por aprovação",
    politicaSemDado: "Não escrever quando nada mudou", exigeAprovacao: true,
  },
  proximaExecucao: AGORA + 20 * 60_000,
  bloqueio: null, espera: null, perguntaPendente: null, esperaDaCota: null, janelasPuladas: 0, ondeRoda: null,
} as unknown as RotinaDto;
const estado = {
  ...estadoInicial,
  agora: AGORA,
  sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "b1", conversaId: "c1", nome: "QA com nome comprido 🧪", cor: "#222222", forma: "shape-circle" }] },
  rotinas: [rotina],
} as unknown as Estado;

descrever("executar rotina no celular (Chromium real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-rotina-executar-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9870 + (process.pid % 100), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/mobile.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const dialogo = `<dialog class="bot-dialogo" aria-labelledby="rodar-mais-uma-titulo">${htmlRodarMaisUma("A execução de hoje 12:40 ainda não terminou. Rodar mais uma agora, sem cancelar a outra?")}</dialog>`;
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${renderRotinas(estado)}${dialogo}</body></html>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close(); document.querySelector("dialog").showModal()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém a ação e as decisões do diálogo tocáveis, com foco seguro e sem transbordo", async () => {
    const medidas = await avaliar<{ testar: number; cancelar: number; confirmar: number; foco: string | null; largura: number }>(cdp, `(() => {
      const altura = (s) => document.querySelector(s).getBoundingClientRect().height;
      document.querySelector("[data-nao]").focus();
      return { testar: altura('[data-act="executar-rotina"]'), cancelar: altura("[data-nao]"), confirmar: altura("[data-sim]"),
        foco: document.activeElement?.getAttribute("data-nao"), largura: document.documentElement.scrollWidth };
    })()`);
    expect.soft(medidas.testar, `Testar agora: ${medidas.testar}px`).toBeGreaterThanOrEqual(44);
    expect.soft(medidas.cancelar, `Cancelar: ${medidas.cancelar}px`).toBeGreaterThanOrEqual(44);
    expect.soft(medidas.confirmar, `Rodar mais uma: ${medidas.confirmar}px`).toBeGreaterThanOrEqual(44);
    expect(medidas.foco).not.toBeNull();
    expect(medidas.largura).toBeLessThanOrEqual(320);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgendaDto, RotinaNaAgenda } from "../../src/contracts/agenda.ts";
import type { RotinaDto } from "../../src/contracts/api.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { estadoInicial, type Estado } from "../../web/estado/reducer.ts";
import { renderAgendaRotinas } from "../../web/telas/agenda-rotinas.ts";

/** QA de 2026-11-17: a volta personalizada existia no desktop, mas sumia da folha da agenda no celular. */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o QA da pausa temporária precisa de Chromium");
const descrever = chrome ? describe : describe.skip;

const AGORA = Date.parse("2026-11-17T12:20:00Z");
const rotina: RotinaNaAgenda = {
  id: "r1", agenteId: "b1", conversaId: "c1", instrucao: "Enviar o resumo diário", resumo: "Todo dia às 09:00",
  fusoIana: "America/Sao_Paulo", estado: "ativa", registroDesde: null, cortado: false, minha: true,
};
const dto: AgendaDto = {
  de: Date.parse("2026-11-09T03:00:00Z"), ate: Date.parse("2026-11-30T03:00:00Z"), agora: AGORA, fuso: "America/Sao_Paulo",
  rotinas: [rotina], itens: [{ tipo: "prevista", rotinaId: "r1", dia: "2026-11-17", instante: Date.parse("2026-11-17T15:00:00Z") }],
};
const estado = {
  ...estadoInicial,
  agora: AGORA,
  sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "b1", conversaId: "c1", nome: "Ada", cor: "#222222", forma: "shape-circle" }] },
  rotinas: [{ rotina: { id: "r1", agenteId: "b1", conversaId: "c1", ownerId: "p", estado: "ativa", instrucao: rotina.instrucao, fusoIana: "America/Sao_Paulo", gatilho: "horario" }, proximaExecucao: Date.parse("2026-11-18T12:00:00Z"), resumo: rotina.resumo, bloqueio: null, espera: null } as unknown as RotinaDto],
  agenda: { dto, erro: false, janela: { de: "2026-11-09", ate: "2026-11-30" }, ui: { aberto: "r1", menu: null, bots: [], soProblema: false, alvo: null, rolarAgora: false, mes: null, busca: null, pausadasAbertas: false, foco: "2026-11-17", bloco: null } },
} as unknown as Estado;

descrever("pausa temporária da agenda no celular (Chromium real, 320×568)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-ag-pausa-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9860 + (process.pid % 100), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/agenda.css", "web/mobile.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style>${renderAgendaRotinas(estado, true)}`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("oferece data e hora personalizada sem transbordo e com alvos de toque", async () => {
    const medidas = await avaliar<{ campo: number; botao: number; largura: number; pagina: number }>(cdp, `(() => {
      const campo = document.querySelector('[data-ate-rotina]');
      const botao = document.querySelector('[data-act="pausar-rotina-escolhida"]');
      return { campo: campo.getBoundingClientRect().height, botao: botao.getBoundingClientRect().height, largura: botao.getBoundingClientRect().right, pagina: document.documentElement.scrollWidth };
    })()`);
    expect(medidas.campo).toBeGreaterThanOrEqual(44);
    expect(medidas.botao).toBeGreaterThanOrEqual(44);
    expect(medidas.largura).toBeLessThanOrEqual(320);
    expect(medidas.pagina).toBeLessThanOrEqual(320);
  });
});

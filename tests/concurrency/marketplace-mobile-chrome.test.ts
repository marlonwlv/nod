import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { estadoInicial, type Estado } from "../../web/estado/reducer.ts";
import { renderConectores } from "../../web/telas/conectores.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("Marketplace móvel: Chromium obrigatório");
const descrever = chrome ? describe : describe.skip;

const conector = (slug: string, falha = false): Conector => ({
  tenantId: "t", id: `c-${slug}`, ownerId: "p", visibility: "privado", nome: slug, slug,
  transporte: "http", comando: null, args: [], url: "https://example.com/mcp", env: {}, declaracao: "toca",
  habilitado: true, catalogo: [{ nome: `${slug}_ler`, descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }],
  sondadoEm: 100, ultimaFalha: falha ? { motivo: "timeout_transporte", em: 200 } : null, criadoEm: 0,
});

descrever("Marketplace no celular (Chrome real)", () => {
  let cdp: Cdp;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "marketplace-mobile-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 100), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  }, 30_000);

  afterAll(() => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // medido em 2026-11-16: 24 s sob carga nesta máquina, incluindo abrir o Chromium e renderizar 100 apps.
  it("mantém filtros e ações principais com 44 px, sem transbordo, sob volume", async () => {
    const agentes = Array.from({ length: 100 }, (_, i): Agente => ({
      id: `a-${i}`, tenantId: "t", ownerId: "p", visibility: "privado", nome: `Bot ${i + 1}`, titulo: "Assistente", descricao: "",
      dono: "pessoa", cor: "c-black", forma: "shape-square", fixado: false, oculto: false, confirmado: true,
      modelo: "auto", duplicadoDe: null, criadoEm: 0,
    }));
    const marketplace = Array.from({ length: 100 }, (_, i) => ({ slug: `app-${i}`, nome: `Aplicativo ${i + 1}`, descricao: "Integração para tarefas e mensagens.", categoria: "Produtividade", logo: null }));
    const estado: Estado = {
      ...estadoInicial,
      agora: 10_000,
      sessao: { tenantId: "t", pessoaId: "p" },
      tela: { tipo: "conectores" },
      frota: { agentes, negacoes: [] } as never,
      marketplace,
      composioConfigurado: true,
      conectores: [conector("app-1"), conector("app-2", true)],
      concessoes: {},
    };
    const css = ["web/base.css", "web/estilos.css", "web/interface.css", "web/mobile.css"].filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><main class="app">${renderConectores(estado)}</main>`;
    await cdp.enviar("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
    await avaliar(cdp, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");

    const medidas = await avaliar<{ largura: number; pequenos: { texto: string; largura: number; altura: number }[] }>(cdp, `(() => {
      const seletores = [".mkt-filtros button", ".mkt-atencao button", ".app-card-actions button"];
      const itens = seletores.flatMap((s) => [...document.querySelectorAll(s)]).filter((el) => el.getBoundingClientRect().width > 0);
      return { largura: document.documentElement.scrollWidth, pequenos: itens.map((el) => { const r = el.getBoundingClientRect(); return { texto: el.textContent.trim(), largura: r.width, altura: r.height }; }).filter((r) => r.largura < 44 || r.altura < 44) };
    })()`);
    expect(medidas.largura).toBeLessThanOrEqual(390);
    expect(medidas.pequenos).toEqual([]);
  }, 60_000);
});

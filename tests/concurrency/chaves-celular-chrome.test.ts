import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { estadoInicial, type Estado } from "../../web/estado/reducer.ts";
import { renderMaquinas } from "../../web/telas/maquinas.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
const descrever = chrome ? describe : describe.skip;

const chave = (id: string, nome: string, revogadaEm: number | null) => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, revogadaEm, papel: "motor" as const });
function estado(chaveEmitida: Estado["chaveEmitida"]): Estado {
  return {
    ...estadoInicial,
    sessao: { tenantId: "t", pessoaId: "p" },
    maquinas: { maquinas: [], padraoId: null },
    chaves: [chave("viva", "PC 👨‍💻 do trabalho", null), chave("velha", "PC antigo", Date.UTC(2026, 10, 17))],
    configUi: { ...estadoInicial.configUi, abertos: ["chave-manual", "revogadas"] },
    chaveEmitida,
  } as Estado;
}

/** QA 2026-11-17: geração, descarte e histórico da chave no celular, com o CSS real completo. */
descrever("chaves no celular (Chromium real)", () => {
  let cdp: Cdp;
  let perfil = "";
  const segredo = `nod.${"x".repeat(180)}`;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-qa-chave-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }, { name: "prefers-color-scheme", value: "dark" }] });
    const css = ["tokens", "estilos", "interface", "navegacao", "ligacao", "onboarding", "computador-do-bot", "conta", "configuracoes", "agentes-lote", "agenda", "busca-celular", "card-proposta", "densidade", "quadro", "tarefa-aberta", "paginas", "canvas", "historico-perfil", "quadro-celular", "quadro-min", "mobile", "celular-base", "tab-bar-celular"].map((p) => `web/${p}.css`).filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const html = renderMaquinas(estado({ chave: segredo, dados: chave("nova", "PC 👨‍💻 do trabalho", null) }));
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main id="espaco">${html}</main>`)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém controles tocáveis, segredo inteiro e sem rolagem lateral", async () => {
    const prova = await avaliar<{ largura: number; alvos: { texto: string; altura: number }[]; segredo: string; revogada: boolean }>(cdp, `({
      largura: document.documentElement.scrollWidth,
      alvos: [...document.querySelectorAll(".chave-emitida button")].map((el) => ({ texto: el.textContent || "", altura: el.getBoundingClientRect().height })),
      segredo: document.querySelector(".chave-crua")?.textContent || "",
      revogada: document.body.textContent.includes("PC antigo") && document.body.textContent.includes("Revogada em")
    })`);
    expect(prova.largura).toBeLessThanOrEqual(320);
    expect(prova.segredo).toBe(segredo);
    expect(prova.revogada).toBe(true);
    expect(prova.alvos).not.toHaveLength(0);
    for (const alvo of prova.alvos) expect(alvo.altura, alvo.texto).toBeGreaterThanOrEqual(44);
  });

  it("retira o segredo do DOM depois de fechar", async () => {
    const html = renderMaquinas(estado(null));
    await avaliar(cdp, `document.querySelector("#espaco").innerHTML = ${JSON.stringify(html)}`);
    expect(await avaliar<boolean>(cdp, `document.body.textContent.includes(${JSON.stringify(segredo)})`)).toBe(false);
  });
});

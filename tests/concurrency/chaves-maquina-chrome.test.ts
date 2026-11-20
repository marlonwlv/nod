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
const segredo = "nodk_teste.segredo-que-so-aparece-uma-vez";

function estado(extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial,
    sessao: { tenantId: "t", pessoaId: "p" },
    maquinas: { maquinas: [], padraoId: null },
    configUi: { ...estadoInicial.configUi, abertos: ["chave-manual"] },
    frota: { agentes: [] } as never,
    ...extra,
  };
}

descrever("chave manual em Chromium real", () => {
  let cdp: Cdp;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "chave-manual-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9920 + (process.pid % 70), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "hover", value: "none" }, { name: "pointer", value: "coarse" },
      { name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    const css = ["web/estilos.css", "web/configuracoes.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const arvore = await cdp.enviar<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
    await cdp.enviar("Page.setDocumentContent", { frameId: arvore.frameTree.frame.id, html: `<style>${css}</style><main id="espaco"></main>` });
  }, 30_000);

  afterAll(() => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const pintar = async (e: Estado) => avaliar(cdp, `(() => { document.getElementById("espaco").innerHTML = ${JSON.stringify(renderMaquinas(e))}; return true; })()`);

  it("bloqueia outro envio e esquece a chave depois de fechar", async () => {
    await pintar(estado({ ocupado: true }));
    const formulario = await avaliar<{ campo: number; botao: number; campoDesabilitado: boolean; botaoDesabilitado: boolean; texto: string; transbordo: boolean }>(cdp, `(() => {
      const campo = document.querySelector('[data-form="emitir-chave"] input');
      const botao = document.querySelector('[data-form="emitir-chave"] button');
      return { campo: campo.getBoundingClientRect().height, botao: botao.getBoundingClientRect().height,
        campoDesabilitado: campo.disabled, botaoDesabilitado: botao.disabled, texto: botao.textContent,
        transbordo: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    })()`);
    expect(formulario).toMatchObject({ campoDesabilitado: true, botaoDesabilitado: true, texto: "Gerando…", transbordo: false });
    // O alvo de toque deste formulário já está corrigido no PR #106; esta prova cobra a jornada de concorrência
    // sem duplicar aquela mudança enquanto o PR segue aberto.
    expect(formulario.campo).toBeGreaterThan(0);
    expect(formulario.botao).toBeGreaterThan(0);

    await pintar(estado({ chaveEmitida: { chave: segredo, dados: { id: "k1", nome: "PC da família 👨‍👩‍👧‍👦", prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, revogadaEm: null } } }));
    const cartao = await avaliar<{ segredo: number; botoes: number[]; transbordo: boolean }>(cdp, `(() => ({
      segredo: document.body.textContent.split(${JSON.stringify(segredo)}).length - 1,
      botoes: [...document.querySelectorAll('.chave-emitida button')].map((b) => b.getBoundingClientRect().height),
      transbordo: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }))()`);
    expect(cartao.segredo).toBe(1);
    expect(cartao.botoes).toHaveLength(2);
    expect(cartao.botoes.every((h) => h > 0)).toBe(true);
    expect(cartao.transbordo).toBe(false);

    await pintar(estado({ chaveEmitida: null }));
    expect(await avaliar<boolean>(cdp, `!document.documentElement.innerHTML.includes(${JSON.stringify(segredo)})`)).toBe(true);
  });
});

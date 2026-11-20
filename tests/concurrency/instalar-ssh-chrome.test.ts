import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { InstalarSsh } from "../../web/estado/reducer.ts";
import { renderInstalarSsh } from "../../web/telas/instalar-ssh.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o QA da instalação por SSH precisa de Chromium");
const descrever = chrome ? describe : describe.skip;

descrever("instalação por SSH no navegador real", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-ssh-qa-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9820 + (process.pid % 100), perfil));
    await cdp.enviar("Page.enable");
  });

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém formulário, segredos e ações usáveis em 320 px", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "hover", value: "none" },
      { name: "pointer", value: "coarse" },
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    const css = ["web/tokens.css", "web/estilos.css", "web/navegacao.css", "web/mobile.css"]
      .filter(existsSync)
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const estado: InstalarSsh = {
      fase: "form", endereco: "servidor-com-nome-bem-longo.exemplo.com:65535", usuario: "administrador", metodo: "senha",
      chave: null, temFrase: false, instaladoras: [{ id: "origem", nome: "Máquina instaladora com nome longo", plataforma: "linux" }],
      origemId: "origem", trocarOrigem: false, substituir: null, pedido: null, campoErro: null, erro: null, pedeSudo: false,
      mostrarSudo: false, manual: null, segundoPlano: false, enviando: false, tentadas: [],
    };
    const corpo = renderInstalarSsh({ agora: Date.now(), instalarSsh: estado });
    const pagina = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main id="espaco">${corpo}</main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(pagina)}); document.close()`);

    const resultado = await avaliar<{ scroll: number; largura: number; segredoNoHtml: boolean; alturas: number[]; dialogo: boolean; campos: number }>(cdp, `(() => ({
      scroll: document.documentElement.scrollWidth,
      largura: innerWidth,
      segredoNoHtml: document.documentElement.innerHTML.includes("senha-secreta"),
      alturas: [...document.querySelectorAll(".cl-dialogo-acoes button")].map((el) => el.getBoundingClientRect().height),
      dialogo: document.querySelector('[role="dialog"][aria-modal="true"]') !== null,
      campos: document.querySelectorAll("input").length,
    }))()`);
    expect(resultado.scroll).toBeLessThanOrEqual(resultado.largura);
    expect(resultado.segredoNoHtml).toBe(false);
    expect(resultado.dialogo).toBe(true);
    expect(resultado.campos).toBeGreaterThanOrEqual(3);
    expect(resultado.alturas.length).toBeGreaterThanOrEqual(2);
    for (const altura of resultado.alturas) expect(altura).toBeGreaterThanOrEqual(44);
  });
});

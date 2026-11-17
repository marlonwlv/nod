import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { htmlEntrarPrimeiro } from "../../web/telas/entrar-primeiro.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir a primeira entrada no celular");
const descrever = chrome ? describe : describe.skip;

descrever("primeira entrada no celular (Chrome real, 390×844)", () => {
  let cdp: Cdp;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-entrada-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9700 + (process.pid % 200), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/conta.css"].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
    const form = `<form class="cc-cartao cc-form" data-form="entrada-conta"><h3 class="cc-titulo">Entrar com e-mail</h3><label class="cc-campo">E-mail<input type="email"></label><label class="cc-campo">Senha<span class="cc-senha"><input type="password"><button type="button" class="cc-mostrar">Mostrar</button></span></label><div class="cc-acoes"><button class="bt pri" type="submit">Entrar</button></div></form>`;
    const corpo = htmlEntrarPrimeiro({ google: true, codigoPorEmail: true, equipe: "/api/sessao/google", formEmailSenha: form, ocupado: false, erro: null });
    const pagina = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style>${corpo}`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(pagina)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém o CTA visível e todos os alvos com pelo menos 44×44 px", async () => {
    const resultado = await avaliar<{ cta: { top: number; bottom: number }; alvos: { nome: string; largura: number; altura: number }[] }>(cdp, `(() => {
      const c = document.querySelector('[data-intencao="sem-conta"]').getBoundingClientRect();
      return { cta: { top: c.top, bottom: c.bottom }, alvos: [...document.querySelectorAll('.entrar-primeiro button, .entrar-primeiro a, .entrar-primeiro input')].map((el) => { const r = el.getBoundingClientRect(); return { nome: el.textContent?.trim() || el.getAttribute('type') || el.tagName, largura: r.width, altura: r.height }; }) };
    })()`);
    expect(resultado.cta.top).toBeGreaterThanOrEqual(0);
    expect(resultado.cta.bottom).toBeLessThanOrEqual(844);
    expect(resultado.alvos).not.toHaveLength(0);
    for (const alvo of resultado.alvos) {
      expect(alvo.largura, `${alvo.nome}: largura`).toBeGreaterThanOrEqual(44);
      expect(alvo.altura, `${alvo.nome}: altura`).toBeGreaterThanOrEqual(44);
    }
  });
});

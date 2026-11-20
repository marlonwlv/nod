import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { marcaDoRecomeco } from "../../web/lib/recomeco.ts";

const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
const descrever = chrome ? describe : describe.skip;

descrever("QA autocompact: recomeço no Chrome real", () => {
  let cdp: Cdp;
  let perfil: string;
  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-autocompact-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9900 + (process.pid % 80), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    const css = ["web/tokens.css", "web/estilos.css", "web/interface.css", "web/mobile.css"].map((p) => readFileSync(p, "utf8")).join("\n");
    const r = marcaDoRecomeco("m1", { tipo: "marca", motivo: "autocompactacao", nomeDoBot: "Bot com nome bem longo 👩🏽‍💻" });
    const linha = `<article class="message"><div class="msg-linha"><div><div class="msg-top"><b>Bot com nome bem longo 👩🏽‍💻</b><time>21:37</time>${r.marca}</div>${r.explicacao}</div></div></article>`;
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nbody{box-sizing:border-box;margin:0;padding:24px}</style><main>${linha.repeat(100)}</main><script>document.addEventListener('click',e=>{const b=e.target.closest('.p312-marca');if(!b)return;const x=document.getElementById(b.getAttribute('aria-controls'));const abre=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(abre));x.hidden=!abre})</script>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  it("mantém toque, teclado, reflow a 200% e redução de movimento", async () => {
    const alvo = await avaliar<{ pontos: boolean[]; hits: string[]; retangulo: number[]; coarse: boolean; animacao: string; scroll: number }>(cdp, `(()=>{const b=document.querySelector('.p312-marca');const r=b.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;const pts=[[cx,cy-21],[cx,cy+21],[cx-21,cy],[cx+21,cy]];return{pontos:pts.map(([x,y])=>document.elementFromPoint(x,y)?.closest('.p312-marca')===b),hits:pts.map(([x,y])=>document.elementFromPoint(x,y)?.outerHTML?.slice(0,80)||''),retangulo:[r.left,r.top,r.width,r.height],coarse:matchMedia('(pointer: coarse)').matches,animacao:getComputedStyle(document.querySelector('.p312-explica')).animationName,scroll:document.documentElement.scrollWidth}})()`);
    expect(alvo.pontos, JSON.stringify(alvo)).toEqual([true, true, true, true]);
    expect(alvo.animacao).toBe("none");
    expect(alvo.scroll).toBeLessThanOrEqual(320);
    await avaliar(cdp, `document.querySelector('.p312-marca').focus()`);
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    expect(await avaliar<boolean>(cdp, `!document.getElementById('recomeco-explica-m1').hidden`)).toBe(true);
    await cdp.enviar("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const zoom = await avaliar<{ largura: number; scroll: number; visivel: boolean }>(cdp, `(()=>{const b=document.querySelector('.p312-marca').getBoundingClientRect();return{largura:visualViewport.width,scroll:document.documentElement.scrollWidth,visivel:b.left<visualViewport.offsetLeft+visualViewport.width&&b.right>visualViewport.offsetLeft}})()`);
    expect(zoom.largura).toBeLessThanOrEqual(161);
    expect(zoom.scroll).toBeLessThanOrEqual(320);
    expect(zoom.visivel).toBe(true);
  });
});

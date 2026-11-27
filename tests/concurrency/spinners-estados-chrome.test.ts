import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import { htmlDoMenuDasOutras, iconeDaAba } from "../../web/telas/abas-de-tarefa.ts";
import { ANEL_FILA, ANEL_RODANDO, PONTO_PRECISA } from "../../web/telas/icones-da-tarefa.ts";
import { htmlProgresso, type FrenteNaFala } from "../../web/telas/progresso-na-fala.ts";
import { linhaDoAgora } from "../../web/telas/tarefa-detalhada.ts";
import { ICONE_DO_GRUPO } from "../../web/telas/tela-tarefas.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * XUM-7 (print do dono, 2026-11-26): ao abrir "N outras ⌄" na fileira de abas, o anel das tarefas rodando ficava parado
 * (um arco estático): o CSS que gira o anel existia por escopo (pílula, abas, cartão, tela Tarefas) e faltava no menu. Com
 * os estilos reais no Chrome: o anel de quem roda gira (getAnimations e o transform mudando) em todo lugar, inclusive no
 * menu e fora de qualquer escopo conhecido; quem espera tem o anel tracejado, que não gira; e com prefers-reduced-motion
 * o anel não gira e vira o círculo inteiro com o miolo (marca estática), não um arco parado.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("XUM-7: o CI precisa do Chromium para provar que os spinners giram");
const descrever = chrome ? describe : describe.skip;

const trabalho = (id: string, titulo: string, estado: TrabalhoDto["estado"]): TrabalhoDto => ({ id, titulo, estado } as TrabalhoDto);
const OUTRAS = [
  trabalho("a250", "Corrigir ADA-250", "rodando"),
  trabalho("a254", "Corrigir ADA-254", "rodando"),
  trabalho("a253", "Fechar ALTOs ADA-253", "na_fila"),
  trabalho("a251", "Responder ADA-251", "precisa_de_voce"),
  trabalho("a252", "Lançar ADA-252", "terminado"),
  trabalho("a255", "Migrar ADA-255", "falhou"),
  // Rodando, mas a máquina está sem contato: espera, não gira.
  { ...trabalho("a256", "Publicar ADA-256", "rodando"), maquina: { nome: "Mac", semContatoDesde: 1 } } as TrabalhoDto,
];
const frente = (id: string, estado: FrenteNaFala["estado"]): FrenteNaFala => ({ trabalhoId: id, titulo: `Tarefa ${id}`, estado, passo: null, tempo: null, terminouEm: null });

/** Cada lugar que mostra o estado de uma tarefa, com o HTML real de quem o desenha. */
const LUGARES: Record<string, string> = {
  // O menu "N outras" como o Base UI monta (popup .bot-menu.rx-menu) e como o <dialog> nativo (só .bot-menu).
  menuReact: `<div class="bot-menu rx-menu" role="menu">${htmlDoMenuDasOutras(OUTRAS, 1)}</div>`,
  menuNativo: `<dialog class="bot-menu" open style="position: static">${htmlDoMenuDasOutras(OUTRAS)}</dialog>`,
  abas: `<nav class="abas-tarefa"><div class="at-aba"><button class="at-ir">${iconeDaAba(OUTRAS[0]).html}<span class="at-titulo">A</span></button></div><div class="at-aba"><button class="at-ir">${iconeDaAba(OUTRAS[2]).html}<span class="at-titulo">B</span></button></div></nav>`,
  pilula: `<div class="pilula-frentes"><button class="pf-botao">${ANEL_RODANDO}<span class="pf-texto">2 tarefas</span></button></div>`,
  cartao: htmlProgresso([frente("1", "rodando"), frente("2", "esperando"), frente("3", "pronta")], { chave: "c", agenteId: "a" }),
  agora: `<div class="tk-timeline">${linhaDoAgora("Rodando um comando", null)}</div>`,
  telaTarefas: `<section class="tela-tarefas"><span class="tf-ic">${ICONE_DO_GRUPO.trabalhando}</span><span class="tf-ic">${ICONE_DO_GRUPO.esperando}</span></section>`,
  // Um lugar novo, sem regra própria: o anel tem de girar do mesmo jeito (a regra é global).
  solto: `<div class="lugar-novo">${ANEL_RODANDO}${ANEL_FILA}${PONTO_PRECISA}</div>`,
};

type Anel = { lugar: string; animacoes: number; rodando: boolean; giro: boolean; arco: string; miolo: string; trilho: string; tinta: string };
type Espera = { lugar: string; animacoes: number; tracejado: string };

const MEDIR = `(async () => {
  const angulo = (el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI); };
  const aneis = [...document.querySelectorAll("[data-lugar] .pf-anel")];
  const antes = aneis.map(angulo);
  await new Promise((ok) => setTimeout(ok, 300));
  const tinta = getComputedStyle(document.documentElement).getPropertyValue("--chat-tinta").trim();
  const rgb = (c) => { const d = document.createElement("i"); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
  return {
    aneis: aneis.map((el, i) => ({
      lugar: el.closest("[data-lugar]").dataset.lugar,
      animacoes: el.getAnimations().length,
      rodando: el.getAnimations().some((a) => a.playState === "running"),
      giro: angulo(el) !== antes[i],
      arco: getComputedStyle(el.querySelector(".pf-anel-arco")).display,
      miolo: getComputedStyle(el.querySelector(".pf-anel-miolo")).display,
      trilho: getComputedStyle(el.querySelector(".pf-anel-trilho")).stroke,
      tinta: rgb(tinta),
    })),
    esperas: [...document.querySelectorAll("[data-lugar] .pf-espera")].map((el) => ({
      lugar: el.closest("[data-lugar]").dataset.lugar,
      animacoes: el.getAnimations().length,
      tracejado: getComputedStyle(el).strokeDasharray,
    })),
  };
})()`;

descrever("XUM-7: spinners e ícones de estado (Chrome real)", () => {
  let cdp: Cdp;
  let perfil: string;
  let css: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-spinners-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9600 + (process.pid % 100), perfil));
    await cdp.enviar("Page.enable");
    // O CSS do index.html e o que o React importa à parte (o marketplace, onde mora o .rx-mk-giro).
    const estilos = [...readFileSync("web/index.html", "utf8").matchAll(/href="\/([^"]+\.css)"/g)].map((m) => `web/${m[1]}`).filter(existsSync);
    css = [...estilos, "web/react/marketplace/marketplace.css"].map((p) => readFileSync(p, "utf8")).join("\n");
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  async function medir(reduzir: boolean): Promise<{ aneis: Anel[]; esperas: Espera[] }> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduzir ? "reduce" : "no-preference" }] });
    const corpo = Object.entries(LUGARES).map(([k, h]) => `<div data-lugar="${k}">${h}</div>`).join("");
    const pagina = `<!doctype html><meta charset="utf-8"><style>${css}</style><main class="stage">${corpo}</main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(pagina)}); document.close()`);
    return avaliar(cdp, MEDIR);
  }

  it("o anel de quem roda gira em todo lugar, inclusive no menu \"N outras\" (React e nativo) e num lugar sem regra própria", async () => {
    const { aneis } = await medir(false);
    const lugares = new Set(aneis.map((a) => a.lugar));
    for (const l of Object.keys(LUGARES)) expect(lugares.has(l), l).toBe(true);
    for (const a of aneis) {
      expect(a.animacoes, a.lugar).toBe(1);
      expect(a.rodando, a.lugar).toBe(true);
      expect(a.giro, `${a.lugar}: o transform muda com o tempo`).toBe(true);
      expect(a.arco, a.lugar).not.toBe("none");
      expect(a.miolo, a.lugar).toBe("none");
    }
    // No menu, as duas que rodam de fato têm o anel; a da fila e a que espera a máquina, não.
    expect(aneis.filter((a) => a.lugar === "menuReact")).toHaveLength(2);
  });

  it("quem espera (na fila, esperando, carregando) tem o anel tracejado, que não gira, em todo lugar", async () => {
    const { esperas } = await medir(false);
    for (const l of ["menuReact", "menuNativo", "abas", "cartao", "telaTarefas", "solto"]) expect(esperas.some((e) => e.lugar === l), l).toBe(true);
    for (const e of esperas) {
      expect(e.animacoes, e.lugar).toBe(0);
      expect(e.tracejado, e.lugar).not.toBe("none");
    }
  });

  it("no menu \"N outras\" cada item diz o estado em texto e a que falhou é o disco vermelho, não o quadrado cinza da parada", async () => {
    await medir(false);
    const r = await avaliar<{ textos: string[]; falhou: string; parada: string | null }>(cdp, `(() => {
      const m = document.querySelector('[data-lugar="menuReact"]');
      const cor = (el) => el ? getComputedStyle(el).color : null;
      return {
        textos: [...m.querySelectorAll(".at-item")].map((b) => b.textContent.trim()),
        falhou: cor(m.querySelector('[data-estado="falhou"] .at-falhou')),
        parada: cor(m.querySelector(".at-parada")),
      };
    })()`);
    expect(r.textos).toEqual(["Corrigir ADA-250, trabalhando", "Corrigir ADA-254, trabalhando", "Fechar ALTOs ADA-253, na fila", "Responder ADA-251, precisa de você", "Lançar ADA-252, terminou", "Migrar ADA-255, falhou", "Publicar ADA-256, esperando"]);
    expect(r.falhou).not.toBe(r.parada);
    expect(r.falhou).toMatch(/^rgb\(/);
  });

  it("os spinners de borda giram; com movimento reduzido viram o círculo inteiro e apagado (não um arco parado)", async () => {
    const classes = ["giro", "giro-conversa", "nv-giro", "nv-favicon-giro", "nvc-giro", "qc-giro", "lote-gira", "ob-gira", "rx-mk-giro"];
    const html = classes.map((c) => `<span class="${c}" style="display:inline-block;width:14px;height:14px;color:rgb(10, 20, 30)"></span>`).join("")
      + '<div class="pensar-acao" data-estado="rodando"><span class="pensar-ic" style="color:rgb(10, 20, 30)"></span></div>'
      + '<div class="ta-run" data-estado="rodando" data-esperando="0" id="run-vivo"><div class="ta-run-av"></div></div>'
      + '<div class="ta-run" data-estado="rodando" data-esperando="1" id="run-espera"><div class="ta-run-av"></div></div>';
    const ler = (reduzir: boolean) => (async () => {
      await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduzir ? "reduce" : "no-preference" }] });
      await avaliar(cdp, `document.open(); document.write(${JSON.stringify(`<!doctype html><meta charset="utf-8"><style>${css}</style><main>${html}</main>`)}); document.close()`);
      return avaliar<{ c: string; anim: number; cores: string[]; opac: string }[]>(cdp, `[...document.querySelectorAll("main > span, .pensar-ic")].map((el) => {
        const cs = getComputedStyle(el);
        return { c: el.className, anim: el.getAnimations().length, cores: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor], opac: cs.opacity };
      }).concat(["run-vivo", "run-espera"].map((id) => ({ c: id, anim: document.getElementById(id).getAnimations({ subtree: true }).length, cores: [], opac: "" })))`);
    })();
    const vivos = await ler(false);
    for (const v of vivos) expect(v.anim, v.c).toBe(v.c === "run-espera" ? 0 : 1);
    const parados = await ler(true);
    for (const v of parados) {
      expect(v.anim, v.c).toBe(0);
      if (v.c.startsWith("run-")) continue;
      expect(new Set(v.cores).size, `${v.c}: as quatro bordas iguais`).toBe(1);
      expect(v.cores[0], v.c).toBe("rgb(10, 20, 30)");
      expect(Number(v.opac), v.c).toBeLessThan(1);
    }
  });

  it("com prefers-reduced-motion o anel não gira e vira uma marca estática clara (círculo inteiro e miolo), não um arco parado", async () => {
    const { aneis } = await medir(true);
    expect(aneis.length).toBeGreaterThan(0);
    for (const a of aneis) {
      expect(a.animacoes, a.lugar).toBe(0);
      expect(a.giro, a.lugar).toBe(false);
      expect(a.arco, a.lugar).toBe("none");
      expect(a.miolo, a.lugar).not.toBe("none");
      expect(a.trilho, `${a.lugar}: o círculo fica na cor da tinta, não no cinza do trilho`).toBe(a.tinta);
    }
  });
});

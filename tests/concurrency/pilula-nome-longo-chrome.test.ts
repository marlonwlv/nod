import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { estadoInicial, type Estado } from "../../web/estado/reducer.ts";
import { renderCabecalhoConversa } from "../../web/telas/conversa.ts";
import { renderFileiraDeAbas } from "../../web/telas/abas-de-tarefa.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * XUM-3 (print do dono, 2026-11-25): um "Nome · Título" longo saía pela borda
 * direita da pílula do bot na fileira de abas. Com os estilos reais no Chrome: o texto fica dentro da pílula em qualquer
 * largura, o título trunca primeiro (com "…") e o nome continua inteiro, a pílula não passa de uma largura razoável (as
 * abas continuam à vista), o title leva o nome completo e o nome curto não muda.
 */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("XUM-3: o CI precisa do Chromium para provar o texto dentro da pílula do bot");
const descrever = chrome ? describe : describe.skip;

const C = "c1";
const LONGO = { nome: "Bartolomeu", titulo: "Engenheiro de ponta a ponta do time de produto (teste de fluxo)" };
const CURTO = { nome: "Ada", titulo: "PM" };

function estadoCom(bot: { nome: string; titulo: string }): Estado {
  return {
    ...estadoInicial,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
    frota: { agentes: [{ id: "a", nome: bot.nome, titulo: bot.titulo, conversaId: C, cor: "c-orange", forma: "shape-circle", ownerId: "p", harness: "auto", modelo: "auto", esforco: null }] } as never,
  };
}

/** Duas abas de frente como as do print, no markup de htmlDaAba (abas-de-tarefa.ts). */
const ABAS = ["Voltar do quadro para a conversa mantém o scroll", "Seletor de IA no composer não abre o menu"]
  .map((t, i) => `<div class="at-aba" data-aba="t${i}"><button type="button" class="at-ir"><span class="at-titulo">${t}</span></button><span class="at-acoes"><button type="button" class="at-fechar">×</button></span></div>`).join("");

/**
 * O cabeçalho no modo abas da conversa (a pílula começa a fileira), numa tarefa (a mesma fileira, num cabeçalho sem
 * `.cabecalho-pilula`: foi onde o vídeo pegou o nome cortado) e no modo pílula (a pílula sozinha, no centro).
 */
function cabecalho(bot: { nome: string; titulo: string }, modo: "abas" | "tarefa" | "pilula"): string {
  const estado = estadoCom(bot);
  if (modo === "pilula") return `<header class="cabecalho cabecalho-pilula" id="cabecalho">${renderCabecalhoConversa(estado, "a", { painel: false })}</header>`;
  const fileira = renderFileiraDeAbas(estado, {
    agenteId: "a", ativa: null, abas: [], renomeando: null, novaTarefa: { texto: "⌘T", aria: "Meta+T" },
    pilula: { html: renderCabecalhoConversa(estado, "a", modo === "tarefa" ? { painel: false, irParaConversa: true } : { painel: false }), conversaAtiva: modo === "abas" },
  }).replace('<span class="at-traco" aria-hidden="true"></span>', `<span class="at-traco" aria-hidden="true"></span>${ABAS}`);
  const classes = modo === "tarefa" ? "cabecalho cabecalho-task cabecalho-abas" : "cabecalho cabecalho-pilula cabecalho-abas";
  return `<header class="${classes}" id="cabecalho"><div class="tk-topo tk-topo-abas">${fileira}</div></header>`;
}

type Medida = {
  pilula: { esq: number; dir: number; largura: number };
  textoDir: number;
  nome: { dir: number; cortado: boolean; visivel: boolean };
  titulo: { cortado: boolean; reticencias: string; visivel: boolean } | null;
  title: string;
  abas: { dir: number; largura: number }[];
  fileiraDir: number;
  rolagemLateral: number;
};

const MEDIR = `(() => {
  const p = document.querySelector("#cabecalho .pilula-bot"), r = p.getBoundingClientRect();
  const txt = p.querySelector(".pilula-txt"), nome = p.querySelector(".pilula-nome"), tit = p.querySelector(".pilula-titulo");
  const visivel = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  // O que sobra à direita de qualquer pedaço de texto da pílula (o maior right entre o .pilula-txt e os filhos visíveis,
  // recortado pelo .pilula-txt quando ele esconde o que passa).
  const caixa = (el) => el.getBoundingClientRect();
  const corte = getComputedStyle(txt).overflow === "hidden" || getComputedStyle(txt).overflowX === "hidden";
  const rt = caixa(txt);
  const filhos = [nome, tit].filter(visivel).map((el) => caixa(el).right);
  const textoDir = corte ? rt.right : Math.max(rt.right, ...filhos, ...[nome, tit].filter(visivel).map((el) => caixa(el).left + el.scrollWidth));
  const nav = document.querySelector(".abas-tarefa");
  return {
    pilula: { esq: r.left, dir: r.right, largura: r.width },
    textoDir,
    nome: { dir: caixa(nome).right, cortado: nome.scrollWidth > nome.clientWidth + 1, visivel: visivel(nome) },
    titulo: tit ? { cortado: tit.scrollWidth > tit.clientWidth + 1, reticencias: getComputedStyle(tit).textOverflow, visivel: visivel(tit) } : null,
    title: p.getAttribute("title") || "",
    abas: [...document.querySelectorAll(".at-aba")].map((a) => ({ dir: a.getBoundingClientRect().right, largura: a.getBoundingClientRect().width })),
    fileiraDir: nav ? nav.getBoundingClientRect().right : innerWidth,
    rolagemLateral: document.documentElement.scrollWidth - innerWidth,
  };
})()`;

descrever("XUM-3: o nome do bot fica dentro da pílula (Chrome real)", () => {
  let cdp: Cdp;
  let perfil: string;
  let css: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-pilula-longa-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9500 + (process.pid % 100), perfil));
    await cdp.enviar("Page.enable");
    const estilos = [...readFileSync("web/index.html", "utf8").matchAll(/href="\/([^"]+\.css)"/g)].map((m) => `web/${m[1]}`).filter(existsSync);
    css = estilos.map((p) => readFileSync(p, "utf8")).join("\n");
  }, 30_000);

  afterAll(async () => {
    cdp?.fechar();
    await new Promise((ok) => setTimeout(ok, 100));
    if (perfil) rmSync(perfil, { recursive: true, force: true });
  });

  async function medir(html: string, largura: number, celular = false): Promise<Medida> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: celular ? 844 : 800, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: celular ? [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] : [{ name: "hover", value: "hover" }, { name: "pointer", value: "fine" }] });
    const pagina = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><main class="stage" style="width: 100vw">${html}</main>`;
    await avaliar(cdp, `document.open(); document.write(${JSON.stringify(pagina)}); document.close()`);
    return avaliar<Medida>(cdp, MEDIR);
  }

  for (const largura of [1440, 1024, 760]) {
    it(`na fileira de abas a ${largura} px: o texto longo fica dentro, o título trunca com "…" e as abas seguem à vista`, async () => {
      const m = await medir(cabecalho(LONGO, "abas"), largura);
      expect(m.textoDir).toBeLessThanOrEqual(m.pilula.dir);
      expect(m.nome.visivel && !m.nome.cortado).toBe(true);
      expect(m.titulo).toMatchObject({ cortado: true, reticencias: "ellipsis" });
      expect(m.pilula.largura).toBeLessThanOrEqual(320);
      for (const aba of m.abas) { expect(aba.largura).toBeGreaterThan(60); expect(aba.dir).toBeLessThanOrEqual(m.fileiraDir + 0.5); }
      expect(m.rolagemLateral).toBeLessThanOrEqual(0);
      expect(m.title).toContain(`${LONGO.nome} · ${LONGO.titulo}`);
    });

    it(`na fileira de uma tarefa a ${largura} px: o nome continua inteiro e o título trunca`, async () => {
      const m = await medir(cabecalho(LONGO, "tarefa"), largura);
      expect(m.textoDir).toBeLessThanOrEqual(m.pilula.dir);
      expect(m.nome.visivel && !m.nome.cortado).toBe(true);
      expect(m.titulo).toMatchObject({ cortado: true, reticencias: "ellipsis" });
      expect(m.pilula.largura).toBeLessThanOrEqual(320);
    });

    it(`no modo pílula a ${largura} px: o texto longo fica dentro e o nome inteiro`, async () => {
      const m = await medir(cabecalho(LONGO, "pilula"), largura);
      expect(m.textoDir).toBeLessThanOrEqual(m.pilula.dir);
      expect(m.nome.visivel && !m.nome.cortado).toBe(true);
      expect(m.titulo).toMatchObject({ cortado: true, reticencias: "ellipsis" });
      expect(m.rolagemLateral).toBeLessThanOrEqual(0);
    });
  }

  it("no celular (390 px) o texto fica dentro da pílula, nas abas e no modo pílula", async () => {
    for (const modo of ["abas", "tarefa", "pilula"] as const) {
      const m = await medir(cabecalho(LONGO, modo), 390, true);
      expect(m.textoDir, modo).toBeLessThanOrEqual(m.pilula.dir);
      expect(m.nome.visivel, modo).toBe(true);
      expect(m.rolagemLateral, modo).toBeLessThanOrEqual(0);
    }
  });

  it("nome e título longos demais: o nome também trunca, sem sair da pílula", async () => {
    const m = await medir(cabecalho({ nome: "Engenheiro-de-ponta-a-ponta-com-nome-enorme-demais", titulo: LONGO.titulo }, "abas"), 1024);
    expect(m.textoDir).toBeLessThanOrEqual(m.pilula.dir);
    expect(m.nome.cortado).toBe(true);
    expect(m.pilula.largura).toBeLessThanOrEqual(320);
  });

  it("nome curto continua inteiro, sem corte, nos dois modos", async () => {
    for (const modo of ["abas", "tarefa", "pilula"] as const) {
      const m = await medir(cabecalho(CURTO, modo), 1024);
      expect(m.nome.cortado, modo).toBe(false);
      expect(m.titulo?.cortado, modo).toBe(false);
      expect(m.textoDir, modo).toBeLessThanOrEqual(m.pilula.dir);
      expect(m.title, modo).toContain("Ada · PM");
    }
  });
});

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROTULO_COPIADO } from "../../../web/lib/copiar.ts";
import { CHECK_CODIGO_MS } from "../../../web/lib/texto-formatado.ts";

/**
 * NOD-45: o Copiar do card do bloco de código (`"copiar-codigo"` no ACOES do main.ts). O main.ts não é importável no
 * teste (sobe a app inteira), então, como os outros testes de main.ts, o teste lê o fonte: aqui ele tira o handler do
 * ACOES e o roda com um botão de mentira, sem criar seam no código de produção.
 * QA da NOD-45 (Teodora, 16/10): sem este teste, trocar o <code> pelo card, os textos dos estados, o 1,5 s ou o
 * clearTimeout (a correção do 6d98c71f) não quebrava nada.
 * NOD-8 (definido em 2026-10-22): "✓ Copiado" por 2 s; revisto em 2026-11-12 (COP-14): 1,5 s, com a classe `copiado`
 * trocando o ícone por um check no balão do bot.
 */
const fonte = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
const inicio = fonte.indexOf('"copiar-codigo": async (el) => {');
const fim = fonte.indexOf('\n  "fechar-espaco"', inicio);
const corpo = fonte.slice(inicio + '"copiar-codigo": '.length, fim).trim().replace(/,$/, "");
const js = `${stripTypeScriptTypes(`const handler = (${corpo});`)}\nreturn handler;`;

type Handler = (el: unknown) => Promise<void>;
const criar = (writeText: (t: string) => Promise<void>): Handler =>
  new Function("navigator", "window", "timersCopiarCodigo", "clearTimeout", "ROTULO_COPIADO", "CHECK_CODIGO_MS", js)(
    { clipboard: { writeText } },
    globalThis,
    new WeakMap(),
    (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ROTULO_COPIADO,
    CHECK_CODIGO_MS,
  ) as Handler;

function botao(codigo: string) {
  const estado = { textContent: "Copiar" };
  const attrs: Record<string, string> = { "aria-label": "Copiar código" };
  const code = { textContent: codigo };
  const card = { querySelector: (s: string) => (s === "code" ? code : null), textContent: `ts Copiar ${codigo}` };
  const classes = new Set<string>();
  const el = {
    classList: { toggle: (c: string, ligar: boolean) => { if (ligar) classes.add(c); else classes.delete(c); } },
    querySelector: (s: string) => (s === ".md-codigo-estado" ? estado : null),
    closest: (s: string) => (s === ".md-codigo" ? card : null),
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
  };
  return { el, estado, attrs, classes };
}

describe("Copiar do bloco de código (main.ts, NOD-45)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("o handler existe no ACOES", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
  });

  it("copia o textContent do <code> do próprio card, mostra ✓ Copiado (com o check) e volta ao Copiar em 1,5 s", async () => {
    const copiados: string[] = [];
    const { el, estado, attrs, classes } = botao('const a = "<b>"\n');
    await criar(async (t) => { copiados.push(t); })(el);
    expect(copiados).toEqual(['const a = "<b>"\n']);
    expect(estado.textContent).toBe("✓ Copiado");
    expect(attrs["aria-label"]).toBe("Código copiado");
    expect(classes.has("copiado")).toBe(true);
    vi.advanceTimersByTime(1499);
    expect(estado.textContent).toBe("✓ Copiado");
    vi.advanceTimersByTime(1);
    expect(estado.textContent).toBe("Copiar");
    expect(classes.has("copiado")).toBe(false);
    expect(attrs["aria-label"]).toBe("Copiar código");
  });

  it("área de transferência recusa: Não copiou, e volta ao Copiar", async () => {
    const { el, estado, attrs } = botao("x");
    await criar(async () => { throw new Error("negado"); })(el);
    expect(estado.textContent).toBe("Não copiou");
    expect(attrs["aria-label"]).toBe("Não copiou o código");
    vi.advanceTimersByTime(1500);
    expect(estado.textContent).toBe("Copiar");
    expect(attrs["aria-label"]).toBe("Copiar código");
  });

  it("dois cliques seguidos: o timer do primeiro não volta ao Copiar no meio do segundo aviso", async () => {
    const h = criar(async () => {});
    const { el, estado, attrs } = botao("x");
    await h(el);
    vi.advanceTimersByTime(1000);
    await h(el);
    vi.advanceTimersByTime(1100);
    expect(estado.textContent).toBe("✓ Copiado");
    vi.advanceTimersByTime(300);
    expect(estado.textContent).toBe("✓ Copiado");
    expect(attrs["aria-label"]).toBe("Código copiado");
    vi.advanceTimersByTime(100);
    expect(estado.textContent).toBe("Copiar");
    expect(attrs["aria-label"]).toBe("Copiar código");
  });
});

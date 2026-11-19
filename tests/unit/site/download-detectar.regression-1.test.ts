import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-001 — a cola que aplica a detecção nos botões (href, rótulo, classe dl-*, arquitetura
// assíncrona do Mac) não tinha teste; só as funções puras entre dl:inicio e dl:fim eram cobertas.
// Found by /qa on 2026-11-14 (NOD-322, mutantes na cola sobreviviam à suíte do site).
//
// O script roda como está (o bloco inteiro do <script> do download), com navigator e document falsos montados a
// partir dos próprios <a data-dl> do index.html.
const html = readFileSync(join(import.meta.dirname, "../../../site/index.html"), "utf8");
const script = /\/\* dl:inicio \*\/[\s\S]*?(?=<\/script>)/.exec(html)?.[0] ?? "";

type Botao = { tipo: string; href: string; texto: string | null };
type Nav = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform: string; mobile: boolean; getHighEntropyValues?: (h: string[]) => Promise<Record<string, string>> };
};

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

/** Chrome: getHighEntropyValues só devolve as dicas pedidas. */
const uad = (platform: string, arquitetura: string | Error) => ({
  platform,
  mobile: false,
  getHighEntropyValues: (dicas: string[]) =>
    arquitetura instanceof Error
      ? Promise.reject(arquitetura)
      : Promise.resolve<Record<string, string>>(dicas.includes("architecture") ? { architecture: arquitetura } : {}),
});

async function rodar(nav: Nav, gpu = "") {
  const classes = new Set<string>();
  const botoes = [...html.matchAll(/<a\b[^>]*data-dl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => {
    const href = /href="([^"]*)"/.exec(m[0])![1]!;
    const dlT = /<span class="dl-t">([^<]*)<\/span>/.exec(m[2]!);
    const b: Botao = { tipo: m[1]!, href, texto: dlT ? dlT[1]! : null };
    return b;
  });
  const elementos = botoes.map((b) => ({
    set href(v: string) {
      b.href = v;
    },
    querySelector: (s: string) =>
      s === ".dl-t" && b.texto !== null
        ? {
            set textContent(v: string) {
              b.texto = v;
            },
          }
        : null,
  }));
  const document = {
    documentElement: { classList: { add: (c: string) => classes.add(c) } },
    querySelectorAll: (s: string) => (s === "[data-dl]" ? elementos : []),
    createElement: () => ({
      getContext: () => ({
        getExtension: (n: string) => (n === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
        getParameter: (p: number) => (p === 0x9246 ? gpu : null),
      }),
    }),
  };
  new Function("navigator", "document", script)(nav, document);
  await new Promise((r) => setTimeout(r, 0));
  return { classes: [...classes], botoes };
}

const rotulos = (botoes: Botao[]) => botoes.filter((b) => b.tipo === "rotulo");

describe("ISSUE-001: a cola do download aplica a detecção nos botões da página", () => {
  it("o bloco existe e a página tem os botões (header + 2 principais)", async () => {
    expect(script).toContain("querySelectorAll('[data-dl]')");
    const { botoes } = await rodar({ userAgent: UA.linux });
    expect(botoes.map((b) => b.tipo)).toEqual(["destino", "rotulo", "rotulo"]);
  });

  it("Windows: todos os botões vão para /download/windows e os principais dizem 'Baixar para Windows'", async () => {
    const { classes, botoes } = await rodar({ userAgent: UA.win, platform: "Win32", userAgentData: uad("Windows", "x86") });
    expect(classes).toEqual(["dl-windows"]);
    for (const b of botoes) expect(b.href).toBe("/download/windows");
    for (const b of rotulos(botoes)) expect(b.texto).toBe("Baixar para Windows");
  });

  it("Mac Intel no Chrome (userAgentData architecture=x86): /download/mac-intel, 'Baixar para macOS'", async () => {
    const { classes, botoes } = await rodar({ userAgent: UA.macChrome, platform: "MacIntel", maxTouchPoints: 0, userAgentData: uad("macOS", "x86") });
    expect(classes).toEqual(["dl-mac"]);
    for (const b of botoes) expect(b.href).toBe("/download/mac-intel");
    for (const b of rotulos(botoes)) expect(b.texto).toBe("Baixar para macOS");
  });

  it("Apple Silicon no Chrome (architecture=arm), mesmo com GPU ambígua: /download/mac", async () => {
    const { botoes } = await rodar({ userAgent: UA.macChrome, platform: "MacIntel", maxTouchPoints: 0, userAgentData: uad("macOS", "arm") }, "Intel");
    for (const b of botoes) expect(b.href).toBe("/download/mac");
  });

  it("Mac sem userAgentData (Safari) com GPU Intel: /download/mac-intel; com GPU mascarada: /download/mac", async () => {
    const intel = await rodar({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 }, "Intel(R) Iris(TM) Plus Graphics 655");
    for (const b of intel.botoes) expect(b.href).toBe("/download/mac-intel");
    const mascarado = await rodar({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 }, "Apple GPU");
    for (const b of mascarado.botoes) expect(b.href).toBe("/download/mac");
    for (const b of rotulos(mascarado.botoes)) expect(b.texto).toBe("Baixar para macOS");
  });

  it("Mac com getHighEntropyValues recusado cai na GPU: Intel → /download/mac-intel", async () => {
    const { botoes } = await rodar(
      { userAgent: UA.macChrome, platform: "MacIntel", maxTouchPoints: 0, userAgentData: uad("macOS", new Error("negado")) },
      "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)",
    );
    for (const b of botoes) expect(b.href).toBe("/download/mac-intel");
  });

  it("Linux: classe dl-nenhum (que o CSS usa para esconder o botão principal) e hrefs intocados", async () => {
    const { classes, botoes } = await rodar({ userAgent: UA.linux, platform: "Linux x86_64", userAgentData: uad("Linux", "x86") });
    expect(classes).toEqual(["dl-nenhum"]);
    expect(html).toContain('.dl-nenhum [data-dl="rotulo"]{display:none}');
    for (const b of botoes) expect(b.href).toBe("/download/mac");
  });
});

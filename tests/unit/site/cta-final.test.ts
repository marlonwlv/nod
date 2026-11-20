import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { URL_DO_EXE_WINDOWS } from "../../../src/adapters/http/servidor.ts";

/**
 * NOD-322: contrato final dos CTAs do nodbot.ai antes de liberar a indexação. Discord oficial, downloads por
 * sistema/arquitetura no bucket público nodbot-downloads, vídeo não bloqueante (NOD-333) e o runbook da cópia
 * manual para os nomes estáveis amarrado ao _redirects.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const ler = (arquivo: string) => readFileSync(join(RAIZ, arquivo), "utf8");
const html = ler("site/index.html");
const headers = ler("site/_headers");
const redirects = new Map(
  ler("site/_redirects")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/))
    .map(([origem, destino, status]) => [origem!, { destino: destino!, status: status ?? "302" }]),
);
const DISCORD = "https://discord.gg/nb9K82eKc9";
const BUCKET = "https://storage.googleapis.com/nodbot-downloads/";

describe("NOD-322: CTAs reais e indexação liberada", () => {
  it("o _headers não manda X-Robots-Tag em nenhuma regra (a home pode ser indexada)", () => {
    expect(headers).not.toMatch(/x-robots-tag/i);
    expect(html).not.toMatch(/<meta[^>]+name=["']robots["']/i);
  });

  it("nenhum link pendente sobrou: sem href=\"#\", sem data-pend e sem o handler do toast 'Link em breve'", () => {
    expect(html).not.toMatch(/href="#"/);
    expect(html).not.toMatch(/data-pend/);
    expect(html).not.toMatch(/Link em breve/);
  });

  it("todo 'Entrar na comunidade' abre o Discord oficial em nova aba com noopener", () => {
    const links = [...html.matchAll(/<a\b([^>]*)>(?:(?!<\/a>)[\s\S])*?Entrar na comunidade<\/a>/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const atributos of links) {
      expect(atributos).toContain(`href="${DISCORD}"`);
      expect(atributos).toContain('target="_blank"');
      expect(atributos).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/);
    }
    // Nenhum outro convite do Discord na página.
    const convites = new Set([...html.matchAll(/href="(https:\/\/(?:discord\.gg|discord\.com\/invite)\/[^"]*)"/g)].map((m) => m[1]));
    expect([...convites]).toEqual([DISCORD]);
  });

  it("os aliases de download vão (302) para a pasta de uma só versão no bucket nodbot-downloads, e o servidor junto", () => {
    // Desde 2026-11-19: a retenção de 365 dias do bucket (2026-11-13) não deixa sobrescrever os nomes estáveis da raiz,
    // então a versão aceita entra pelo _redirects (docs/release-desktop.md).
    const mac = /^v(\d+\.\d+\.\d+(?:-rc\.\d+)?)\/nod-\1-mac-arm64\.dmg$/.exec(redirects.get("/download/mac")!.destino.slice(BUCKET.length));
    expect(mac, "/download/mac").not.toBeNull();
    const v = mac![1]!;
    expect(redirects.get("/download/mac")!.status).toBe("302");
    expect(redirects.get("/download/mac-intel")).toEqual({ destino: `${BUCKET}v${v}/nod-${v}-mac-x64.dmg`, status: "302" });
    expect(redirects.get("/download/windows")).toEqual({ destino: `${BUCKET}v${v}/nod-${v}-win-x64.exe`, status: "302" });
    expect(URL_DO_EXE_WINDOWS).toBe(redirects.get("/download/windows")!.destino);
  });

  it("sem JS, o CTA principal já diz 'Baixar para macOS' e baixa o .dmg do Apple Silicon", () => {
    const principais = [...html.matchAll(/<a\b[^>]*data-dl="rotulo"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
    expect(principais.length).toBeGreaterThanOrEqual(2);
    for (const a of principais) {
      expect(a).toContain('href="/download/mac"');
      expect(a).toMatch(/<span class="dl-t">Baixar para macOS<\/span>/);
    }
  });

  it("o vídeo de 'O time no dia a dia' não bloqueia: sem <video> nem arquivo de vídeo, marcado para a NOD-333", () => {
    expect(html).toContain('id="vplay"');
    expect(html).not.toMatch(/<video\b/i);
    expect(html).not.toMatch(/\.(mp4|webm|mov)\b/i);
    const secao = /<section[^>]*>(?:(?!<\/section>)[\s\S])*id="vbox"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(secao).toContain("NOD-333");
  });

  it("o runbook da release cita os três aliases, a pasta da versão e diz que a troca é manual", () => {
    const runbook = ler("docs/release-desktop.md");
    for (const alias of ["/download/mac", "/download/mac-intel", "/download/windows"]) expect(runbook, alias).toContain(alias);
    for (const arquivo of ["mac-arm64.dmg", "mac-x64.dmg", "win-x64.exe"]) expect(runbook, arquivo).toContain(`nod-$V-${arquivo}`);
    expect(runbook).toContain("URL_DO_EXE_WINDOWS");
    expect(runbook).toMatch(/manual/i);
    expect(runbook).toMatch(/shasum -a 256 -c/);
  });
});

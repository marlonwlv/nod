import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("os aliases de download vão (302) para os nomes estáveis exatos no bucket nodbot-downloads", () => {
    expect(redirects.get("/download/mac")).toEqual({ destino: `${BUCKET}nod-mac-arm64.dmg`, status: "302" });
    expect(redirects.get("/download/mac-intel")).toEqual({ destino: `${BUCKET}nod-mac-x64.dmg`, status: "302" });
    expect(redirects.get("/download/windows")).toEqual({ destino: `${BUCKET}nod-windows-x64.exe`, status: "302" });
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

  it("o runbook da release cita os nomes estáveis exatamente como o _redirects e diz que a cópia é manual", () => {
    const runbook = ler("docs/release-desktop.md");
    for (const alias of ["/download/mac", "/download/mac-intel", "/download/windows"]) {
      const destino = redirects.get(alias)!.destino;
      const nome = destino.slice(BUCKET.length);
      expect(runbook, nome).toContain(`gs://nodbot-downloads/${nome}`);
      expect(runbook, alias).toContain(alias);
    }
    expect(runbook).toMatch(/manual/i);
    expect(runbook).toMatch(/sha256sum -c/);
  });
});

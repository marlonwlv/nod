import { mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cunharCookie } from "../../../src/adapters/http/sessao.ts";
import { criarServidor } from "../../../src/adapters/http/servidor.ts";
import type { Escopo } from "../../../src/shared/types.ts";

/** ADR-194: a tela /backoffice é decidida no servidor — login com volta, 404 fora da equipe, o app para a equipe. */
const SEGREDO = "segredo-exclusivo-do-teste-backoffice-2026";
const T = "00000000-0000-4000-8000-000000000001";
const DONO: Escopo = { tenantId: T, pessoaId: "00000000-0000-4000-8000-0000000000aa" };
const FORA: Escopo = { tenantId: T, pessoaId: "00000000-0000-4000-8000-0000000000bb" };
const cookie = (e: Escopo) => ({ cookie: `nod_sessao=${cunharCookie(e, SEGREDO)}` });

async function subir(backoffice: boolean): Promise<{ base: string; fechar: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "nod-backoffice-"));
  writeFileSync(join(dir, "index.html"), "<main>casca-do-app</main>");
  writeFileSync(join(dir, "backoffice.html"), "<main>casca-do-backoffice</main>");
  const servidor: Server = criarServidor({
    staticDir: dir,
    segredoSessao: SEGREDO,
    sessao: { modo: "stub", pessoas: async () => [] },
    ...(backoffice ? { backoffice: { papel: async (e: Escopo) => (e.pessoaId === DONO.pessoaId ? "dono" : null) } } : {}),
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === "string") throw new Error("servidor sem porta");
  return {
    base: `http://127.0.0.1:${endereco.port}`,
    fechar: async () => {
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}

describe("tela /backoffice (ADR-194)", () => {
  let s: Awaited<ReturnType<typeof subir>>;
  let desligado: Awaited<ReturnType<typeof subir>>;
  beforeAll(async () => {
    s = await subir(true);
    desligado = await subir(false);
  });
  afterAll(async () => {
    await Promise.all([s.fechar(), desligado.fechar()]);
  });
  const ir = (url: string, headers: Record<string, string> = {}, base = s.base) => fetch(base + url, { redirect: "manual", headers });

  it("sem sessão manda para o login e guarda o caminho de volta", async () => {
    const casos: [string, string][] = [
      ["/backoffice", "/backoffice/uso"],
      ["/backoffice/", "/backoffice/uso"],
      ["/backoffice/problemas", "/backoffice/problemas"],
      [`/backoffice/pessoas/${T}/${DONO.pessoaId}?dias=7`, `/backoffice/pessoas/${T}/${DONO.pessoaId}?dias=7`],
      ["/backoffice/uso?x=https://mal.example", "/backoffice/uso"],
    ];
    for (const [url, volta] of casos) {
      const r = await ir(url);
      expect(r.status, url).toBe(302);
      const destino = new URL(r.headers.get("location") ?? "", "http://x");
      expect(destino.pathname).toBe("/");
      expect(destino.searchParams.get("volta"), url).toBe(volta);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("logado e fora da equipe recebe 404, sem a casca do backoffice", async () => {
    for (const url of ["/backoffice", "/backoffice/uso", `/backoffice/pessoas/${T}/${DONO.pessoaId}`]) {
      const r = await ir(url, cookie(FORA));
      expect(r.status, url).toBe(404);
      expect(await r.text()).not.toContain("casca-do-backoffice");
    }
  });

  it("da equipe: /backoffice vai para /backoffice/uso e as seções recebem o app do backoffice", async () => {
    const raiz = await ir("/backoffice", cookie(DONO));
    expect(raiz.status).toBe(302);
    expect(raiz.headers.get("location")).toBe("/backoffice/uso");
    for (const url of ["/backoffice/uso", "/backoffice/problemas", "/backoffice/pessoas", `/backoffice/pessoas/${T}/${DONO.pessoaId}`]) {
      const r = await ir(url, cookie(DONO));
      expect(r.status, url).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(await r.text()).toContain("casca-do-backoffice");
    }
  });

  it("/admin.html e /backoffice.html redirecionam para /backoffice", async () => {
    for (const url of ["/admin.html", "/backoffice.html"]) {
      const r = await ir(url, cookie(DONO));
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("/backoffice");
    }
  });

  it("outras rotas do app continuam com a casca de sempre", async () => {
    const r = await ir("/backofficex", cookie(DONO));
    expect(await r.text()).toContain("casca-do-app");
  });

  it("a API do backoffice: 401 sem sessão, 404 fora da equipe e com o backoffice desligado", async () => {
    const sem = await ir("/api/backoffice/uso");
    expect(sem.status).toBe(401);
    expect(await sem.text()).not.toContain("pessoas");
    expect((await ir("/api/backoffice/uso", cookie(FORA))).status).toBe(404);
    expect((await ir("/api/backoffice/eu", cookie(FORA))).status).toBe(404);
    expect((await ir("/api/backoffice/uso", cookie(DONO), desligado.base)).status).toBe(404);
    expect((await ir("/backoffice/uso", cookie(DONO), desligado.base)).status).toBe(404);
    // As rotas do backoffice nunca respondem sob o prefixo do tenant (o admin de workspace é outra coisa).
    expect((await ir(`/api/t/${T}/backoffice/uso`, cookie(DONO))).status).toBe(404);
  });
});

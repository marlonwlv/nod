import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aplicarShellVisual, prepararShellVisual, recuperarShellVisual, selecaoDoShellVisual, validarManifestoShellVisual, verificarShellVisual } from "../../../infra/computador/shell-visual.mjs";

const temporarios: string[] = [];
afterEach(async () => { const { rm } = await import("node:fs/promises"); await Promise.all(temporarios.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function pasta() { const p = await mkdtemp(path.join(tmpdir(), "nod-shell-")); temporarios.push(p); return p; }

async function bundle(raiz: string, versao: string, sufixo = versao) {
  const conteudos: Record<string, string> = {
    "tema/openbox.xml": `<openbox>${sufixo}</openbox>`,
    "tema/tint2rc": `panel=${sufixo}`,
    "tema/wallpaper.png": `PNG:${sufixo}`,
    "apps/browser.desktop": `Browser:${sufixo}`,
    "apps/files.desktop": `Files:${sufixo}`,
    "apps/terminal.desktop": `Terminal:${sufixo}`,
  };
  for (const [nome, conteudo] of Object.entries(conteudos)) { await mkdir(path.dirname(path.join(raiz, nome)), { recursive: true }); await writeFile(path.join(raiz, nome), conteudo); }
  const manifesto = {
    schema: 1 as const, versao, fonte: "paper" as const, breakpoints: [{ largura: 1280, altura: 800 }, { largura: 1440, altura: 900 }],
    arquivos: Object.entries(conteudos).map(([caminho, conteudo]) => ({ caminho, sha256: sha(conteudo) })),
    papeis: { openbox: "tema/openbox.xml", tint2: "tema/tint2rc", wallpaper: "tema/wallpaper.png" },
    apps: { browser: "apps/browser.desktop", files: "apps/files.desktop", terminal: "apps/terminal.desktop" },
  };
  await writeFile(path.join(raiz, "manifesto.json"), JSON.stringify(manifesto));
  return manifesto;
}

describe("shell visual compartilhado", () => {
  it("fica desligado sem flag e não toca no estado", async () => {
    const origem = await pasta(); const estado = path.join(await pasta(), "estado");
    expect(selecaoDoShellVisual({})).toBeNull();
    expect(await prepararShellVisual({ env: {}, origem, estado })).toEqual({ habilitado: false, versao: null, raiz: null, alterou: false });
    await expect(readFile(path.join(estado, "atual"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aplica o mesmo bundle no Docker e no Orgo e a segunda passagem é idempotente", async () => {
    const origem = await pasta(); await bundle(origem, "paper-v1");
    const docker = path.join(await pasta(), "docker"); const orgo = path.join(await pasta(), "orgo");
    const a = await aplicarShellVisual({ origem, estado: docker, versao: "paper-v1", agora: 10 });
    const b = await aplicarShellVisual({ origem, estado: orgo, versao: "paper-v1", agora: 10 });
    expect(a.alterou).toBe(true); expect(b.alterou).toBe(true);
    expect((await verificarShellVisual({ estado: docker }))?.manifesto).toEqual((await verificarShellVisual({ estado: orgo }))?.manifesto);
    expect((await aplicarShellVisual({ origem, estado: docker, versao: "paper-v1", agora: 11 })).alterou).toBe(false);
  });

  it("preserva a versão ativa se o checksum novo divergir", async () => {
    const raiz = await pasta(); const estado = path.join(await pasta(), "estado"); const v1 = path.join(raiz, "v1"); const v2 = path.join(raiz, "v2");
    await mkdir(v1); await mkdir(v2); await bundle(v1, "paper-v1"); await bundle(v2, "paper-v2");
    await aplicarShellVisual({ origem: v1, estado, versao: "paper-v1" });
    await writeFile(path.join(v2, "tema/wallpaper.png"), "adulterado");
    await expect(aplicarShellVisual({ origem: v2, estado, versao: "paper-v2" })).rejects.toMatchObject({ code: "shell_checksum_invalido" });
    expect((await verificarShellVisual({ estado }))?.versao).toBe("paper-v1");
  });

  it("troca versões atomicamente e recupera a anterior", async () => {
    const raiz = await pasta(); const estado = path.join(await pasta(), "estado"); const v1 = path.join(raiz, "v1"); const v2 = path.join(raiz, "v2");
    await mkdir(v1); await mkdir(v2); await bundle(v1, "paper-v1"); await bundle(v2, "paper-v2");
    await aplicarShellVisual({ origem: v1, estado, versao: "paper-v1" });
    await aplicarShellVisual({ origem: v2, estado, versao: "paper-v2" });
    expect((await verificarShellVisual({ estado }))?.versao).toBe("paper-v2");
    expect((await recuperarShellVisual({ estado })).versao).toBe("paper-v1");
    expect((await verificarShellVisual({ estado }))?.versao).toBe("paper-v1");
    expect((await recuperarShellVisual({ estado })).versao).toBe("paper-v2");
  });

  it("fecha paths absolutos, traversal, symlinks e apps incompletos", async () => {
    const origem = await pasta(); const manifesto = await bundle(origem, "paper-v1");
    expect(() => validarManifestoShellVisual({ ...manifesto, arquivos: [{ caminho: "../fora", sha256: "a".repeat(64) }] })).toThrow("shell_arquivos_invalidos");
    expect(() => validarManifestoShellVisual({ ...manifesto, apps: { browser: manifesto.apps.browser } })).toThrow("shell_apps_invalidos");
    const alvo = path.join(origem, "alvo"); await writeFile(alvo, "x"); await symlink(alvo, path.join(origem, "link"));
    const comLink = { ...manifesto, arquivos: [...manifesto.arquivos, { caminho: "link", sha256: sha("x") }] };
    await writeFile(path.join(origem, "manifesto.json"), JSON.stringify(comLink));
    await expect(aplicarShellVisual({ origem, estado: path.join(await pasta(), "estado"), versao: "paper-v1" })).rejects.toMatchObject({ code: "shell_arquivo_invalido" });
  });

  it("remove trava órfã mas não atropela atualização viva", async () => {
    const origem = await pasta(); await bundle(origem, "paper-v1"); const estado = path.join(await pasta(), "estado"); const trava = path.join(estado, ".aplicando");
    await mkdir(trava, { recursive: true });
    await expect(aplicarShellVisual({ origem, estado, versao: "paper-v1", agora: 1_000 })).rejects.toMatchObject({ code: "shell_em_atualizacao" });
    await utimes(trava, new Date(0), new Date(0));
    expect((await aplicarShellVisual({ origem, estado, versao: "paper-v1", agora: 5 * 60_000 + 1 })).alterou).toBe(true);
  });
});

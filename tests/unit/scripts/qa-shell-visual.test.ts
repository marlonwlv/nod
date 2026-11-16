import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { dimensoesPng, gerarRelatorioLadoALado } from "../../../scripts/qa-shell-visual/relatorio.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), "nod-qa-shell-")); dirs.push(p); return p; }
function png(largura: number, altura: number) { const b = Buffer.alloc(24); Buffer.from("89504e470d0a1a0a", "hex").copy(b); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(largura, 16); b.writeUInt32BE(altura, 20); return b; }

it("gera o QA visual lado a lado para todos os breakpoints", async () => {
  const raiz = await dir(); const docker = path.join(raiz, "docker"); const orgo = path.join(raiz, "orgo"); const saida = path.join(raiz, "saida"); await mkdir(docker); await mkdir(orgo);
  const arquivos = ["openbox", "tint2", "wallpaper", "browser", "files", "terminal"].map((nome) => ({ caminho: nome, sha256: createHash("sha256").update(nome).digest("hex") }));
  const manifesto = { schema: 1, versao: "paper-v1", fonte: "paper", breakpoints: [{ largura: 1280, altura: 800 }], arquivos, papeis: { openbox: "openbox", tint2: "tint2", wallpaper: "wallpaper" }, apps: { browser: "browser", files: "files", terminal: "terminal" } };
  const mf = path.join(raiz, "manifesto.json"); await writeFile(mf, JSON.stringify(manifesto));
  await writeFile(path.join(docker, "1280x800.png"), png(1280, 800)); await writeFile(path.join(orgo, "1280x800.png"), png(1280, 800));
  expect(await gerarRelatorioLadoALado({ manifesto: mf, docker, orgo, saida })).toMatchObject({ versao: "paper-v1", capturas: [{ breakpoint: "1280x800" }] });
  expect(await readFile(path.join(saida, "index.html"), "utf8")).toContain("Docker");
  expect(dimensoesPng(await readFile(path.join(saida, "orgo-1280x800.png")))).toEqual({ largura: 1280, altura: 800 });
});

it("recusa screenshot no breakpoint errado", async () => {
  const raiz = await dir(); const docker = path.join(raiz, "docker"); const orgo = path.join(raiz, "orgo"); await mkdir(docker); await mkdir(orgo);
  const arquivos = ["openbox", "tint2", "wallpaper", "browser", "files", "terminal"].map((nome) => ({ caminho: nome, sha256: createHash("sha256").update(nome).digest("hex") }));
  const manifesto = { schema: 1, versao: "paper-v1", fonte: "paper", breakpoints: [{ largura: 1280, altura: 800 }], arquivos, papeis: { openbox: "openbox", tint2: "tint2", wallpaper: "wallpaper" }, apps: { browser: "browser", files: "files", terminal: "terminal" } };
  const mf = path.join(raiz, "manifesto.json"); await writeFile(mf, JSON.stringify(manifesto));
  await writeFile(path.join(docker, "1280x800.png"), png(800, 600)); await writeFile(path.join(orgo, "1280x800.png"), png(1280, 800));
  await expect(gerarRelatorioLadoALado({ manifesto: mf, docker, orgo, saida: path.join(raiz, "saida") })).rejects.toThrow("screenshot_dimensao_invalida:docker:1280x800.png");
});

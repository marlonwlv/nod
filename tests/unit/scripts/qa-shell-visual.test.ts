import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { dimensoesPng, gerarRelatorioLadoALado } from "../../../scripts/qa-shell-visual/relatorio.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), "nod-qa-shell-")); dirs.push(p); return p; }
function crc32(b: Buffer) { let crc = 0xffffffff; for (const byte of b) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(tipo: string, dados: Buffer) { const t = Buffer.from(tipo); const b = Buffer.alloc(dados.length + 12); b.writeUInt32BE(dados.length); t.copy(b, 4); dados.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([t, dados])), b.length - 4); return b; }
function png(largura: number, altura: number, valor = 0) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largura); ihdr.writeUInt32BE(altura, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) linhas.fill(valor, y * (largura * 3 + 1) + 1, (y + 1) * (largura * 3 + 1));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(linhas)), chunk("IEND", Buffer.alloc(0))]);
}

it("gera o QA visual lado a lado para todos os breakpoints", async () => {
  const raiz = await dir(); const docker = path.join(raiz, "docker"); const orgo = path.join(raiz, "orgo"); const saida = path.join(raiz, "saida"); await mkdir(docker); await mkdir(orgo);
  const arquivos = ["home", "openbox", "tint2", "wallpaper", "browser", "files", "terminal"].map((nome) => ({ caminho: nome, sha256: createHash("sha256").update(nome).digest("hex") }));
  const manifesto = { schema: 1, versao: "paper-v1", fonte: "paper", breakpoints: [{ largura: 1280, altura: 800 }], arquivos, papeis: { home: "home", openbox: "openbox", tint2: "tint2", wallpaper: "wallpaper" }, apps: { browser: "browser", files: "files", terminal: "terminal" } };
  const mf = path.join(raiz, "manifesto.json"); await writeFile(mf, JSON.stringify(manifesto));
  await writeFile(path.join(docker, "1280x800.png"), png(1280, 800)); await writeFile(path.join(orgo, "1280x800.png"), png(1280, 800));
  expect(await gerarRelatorioLadoALado({ manifesto: mf, docker, orgo, saida })).toMatchObject({ versao: "paper-v1", capturas: [{ breakpoint: "1280x800" }] });
  expect(await readFile(path.join(saida, "index.html"), "utf8")).toContain("Docker");
  expect(dimensoesPng(await readFile(path.join(saida, "orgo-1280x800.png")))).toEqual({ largura: 1280, altura: 800 });
});

it("recusa screenshot no breakpoint errado", async () => {
  const raiz = await dir(); const docker = path.join(raiz, "docker"); const orgo = path.join(raiz, "orgo"); await mkdir(docker); await mkdir(orgo);
  const arquivos = ["home", "openbox", "tint2", "wallpaper", "browser", "files", "terminal"].map((nome) => ({ caminho: nome, sha256: createHash("sha256").update(nome).digest("hex") }));
  const manifesto = { schema: 1, versao: "paper-v1", fonte: "paper", breakpoints: [{ largura: 1280, altura: 800 }], arquivos, papeis: { home: "home", openbox: "openbox", tint2: "tint2", wallpaper: "wallpaper" }, apps: { browser: "browser", files: "files", terminal: "terminal" } };
  const mf = path.join(raiz, "manifesto.json"); await writeFile(mf, JSON.stringify(manifesto));
  await writeFile(path.join(docker, "1280x800.png"), png(800, 600)); await writeFile(path.join(orgo, "1280x800.png"), png(1280, 800));
  await expect(gerarRelatorioLadoALado({ manifesto: mf, docker, orgo, saida: path.join(raiz, "saida") })).rejects.toThrow("screenshot_dimensao_invalida:docker:1280x800.png");
});

it("recusa provedores com pixels diferentes no mesmo breakpoint", async () => {
  const raiz = await dir(); const docker = path.join(raiz, "docker"); const orgo = path.join(raiz, "orgo"); await mkdir(docker); await mkdir(orgo);
  const arquivos = ["home", "openbox", "tint2", "wallpaper", "browser", "files", "terminal"].map((nome) => ({ caminho: nome, sha256: createHash("sha256").update(nome).digest("hex") }));
  const manifesto = { schema: 1, versao: "paper-v1", fonte: "paper", breakpoints: [{ largura: 1280, altura: 800 }], arquivos, papeis: { home: "home", openbox: "openbox", tint2: "tint2", wallpaper: "wallpaper" }, apps: { browser: "browser", files: "files", terminal: "terminal" } };
  const mf = path.join(raiz, "manifesto.json"); await writeFile(mf, JSON.stringify(manifesto));
  const a = png(1280, 800); const c = png(1280, 800, 1);
  await writeFile(path.join(docker, "1280x800.png"), a); await writeFile(path.join(orgo, "1280x800.png"), c);
  await expect(gerarRelatorioLadoALado({ manifesto: mf, docker, orgo, saida: path.join(raiz, "saida") })).rejects.toThrow("screenshot_divergente:1280x800.png");
});

it("recusa arquivo truncado que só imita o cabeçalho PNG", () => {
  const falso = Buffer.alloc(24); Buffer.from("89504e470d0a1a0a", "hex").copy(falso); falso.write("IHDR", 12, "ascii"); falso.writeUInt32BE(1280, 16); falso.writeUInt32BE(800, 20);
  expect(() => dimensoesPng(falso)).toThrow("screenshot_png_invalido");
});

it("recusa PNG corrompido mesmo quando as dimensões continuam legíveis", () => {
  const corrompido = png(1280, 800); const indice = corrompido.length - 5; corrompido[indice] = (corrompido[indice] ?? 0) ^ 1;
  expect(() => dimensoesPng(corrompido)).toThrow("screenshot_png_invalido");
});

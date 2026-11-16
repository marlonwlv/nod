import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { validarManifestoShellVisual } from "../../infra/computador/shell-visual.mjs";

function crc32(b: Buffer): number { let crc = 0xffffffff; for (const byte of b) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }

export function dimensoesPng(dados: Buffer): { largura: number; altura: number } {
  if (dados.length < 45 || dados.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("screenshot_png_invalido");
  let offset = 8; let largura = 0; let altura = 0; let ihdr = false; let idat = false; let iend = false;
  while (offset + 12 <= dados.length) {
    const tamanho = dados.readUInt32BE(offset); const fim = offset + 12 + tamanho;
    if (fim > dados.length) throw new Error("screenshot_png_invalido");
    const tipo = dados.subarray(offset + 4, offset + 8).toString("ascii");
    if (crc32(dados.subarray(offset + 4, fim - 4)) !== dados.readUInt32BE(fim - 4)) throw new Error("screenshot_png_invalido");
    if (!ihdr && tipo !== "IHDR") throw new Error("screenshot_png_invalido");
    if (tipo === "IHDR") {
      if (ihdr || tamanho !== 13) throw new Error("screenshot_png_invalido");
      largura = dados.readUInt32BE(offset + 8); altura = dados.readUInt32BE(offset + 12); ihdr = largura > 0 && altura > 0;
    } else if (tipo === "IDAT") idat = true;
    else if (tipo === "IEND") { if (tamanho !== 0 || fim !== dados.length) throw new Error("screenshot_png_invalido"); iend = true; }
    offset = fim;
    if (iend) break;
  }
  if (!ihdr || !idat || !iend) throw new Error("screenshot_png_invalido");
  return { largura, altura };
}

function pixelsPng(dados: Buffer): Buffer {
  const { largura, altura } = dimensoesPng(dados); let offset = 8; let canais = 0; const idat: Buffer[] = [];
  while (offset + 12 <= dados.length) {
    const tamanho = dados.readUInt32BE(offset); const tipo = dados.subarray(offset + 4, offset + 8).toString("ascii"); const conteudo = dados.subarray(offset + 8, offset + 8 + tamanho);
    if (tipo === "IHDR") { const profundidade = conteudo[8]; const cor = conteudo[9]; const compressao = conteudo[10]; const filtro = conteudo[11]; const entrelacado = conteudo[12]; canais = cor === 2 ? 3 : cor === 6 ? 4 : 0; if (profundidade !== 8 || !canais || compressao !== 0 || filtro !== 0 || entrelacado !== 0) throw new Error("screenshot_png_nao_suportado"); }
    if (tipo === "IDAT") idat.push(conteudo);
    offset += tamanho + 12;
  }
  const bruto = inflateSync(Buffer.concat(idat)); const passo = largura * canais; if (bruto.length !== (passo + 1) * altura) throw new Error("screenshot_png_invalido");
  const pixels = Buffer.alloc(passo * altura); let entrada = 0;
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[entrada++];
    if (filtro === undefined || filtro > 4) throw new Error("screenshot_png_invalido");
    for (let x = 0; x < passo; x++) {
      const valor = bruto[entrada++] ?? 0; const indice = y * passo + x; const esquerda = x >= canais ? (pixels[indice - canais] ?? 0) : 0; const acima = y ? (pixels[indice - passo] ?? 0) : 0; const diagonal = y && x >= canais ? (pixels[indice - passo - canais] ?? 0) : 0;
      pixels[indice] = (valor + (filtro === 1 ? esquerda : filtro === 2 ? acima : filtro === 3 ? Math.floor((esquerda + acima) / 2) : filtro === 4 ? paeth(esquerda, acima, diagonal) : 0)) & 255;
    }
  }
  return pixels;
}

const escapar = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

export async function gerarRelatorioLadoALado(o: { manifesto: string; docker: string; orgo: string; saida: string }) {
  const manifesto = validarManifestoShellVisual(JSON.parse(await readFile(o.manifesto, "utf8")));
  await mkdir(o.saida, { recursive: true });
  const capturas: Array<{ breakpoint: string; docker: string; orgo: string }> = [];
  for (const b of manifesto.breakpoints) {
    const nome = `${b.largura}x${b.altura}.png`;
    const fontes = { docker: path.join(o.docker, nome), orgo: path.join(o.orgo, nome) };
    const imagens: Record<string, Buffer> = {};
    for (const [provedor, fonte] of Object.entries(fontes)) {
      const dados = await readFile(fonte); imagens[provedor] = dados;
      const dimensoes = dimensoesPng(dados);
      if (dimensoes.largura !== b.largura || dimensoes.altura !== b.altura) throw new Error(`screenshot_dimensao_invalida:${provedor}:${nome}`);
      await copyFile(fonte, path.join(o.saida, `${provedor}-${nome}`));
    }
    const docker = imagens.docker; const orgo = imagens.orgo;
    if (!docker || !orgo) throw new Error(`screenshot_ausente:${nome}`);
    if (createHash("sha256").update(pixelsPng(docker)).digest("hex") !== createHash("sha256").update(pixelsPng(orgo)).digest("hex")) throw new Error(`screenshot_divergente:${nome}`);
    capturas.push({ breakpoint: nome.slice(0, -4), docker: `docker-${nome}`, orgo: `orgo-${nome}` });
  }
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>QA shell visual ${escapar(manifesto.versao)}</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:24px}main{display:grid;gap:32px}.par{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{display:block;width:100%;height:auto;border:1px solid #444}figcaption{padding:8px 0}</style><h1>Shell visual ${escapar(manifesto.versao)}</h1><main>${capturas.map((c) => `<section><h2>${c.breakpoint}</h2><div class="par"><figure><figcaption>Docker</figcaption><img src="${c.docker}"></figure><figure><figcaption>Orgo</figcaption><img src="${c.orgo}"></figure></div></section>`).join("")}</main></html>\n`;
  await writeFile(path.join(o.saida, "index.html"), html);
  const resultado = { versao: manifesto.versao, fonte: manifesto.fonte, capturas };
  await writeFile(path.join(o.saida, "qa.json"), `${JSON.stringify(resultado, null, 2)}\n`);
  return resultado;
}

function valor(args: string[], nome: string): string { const i = args.indexOf(nome); const v = i >= 0 ? args[i + 1] : null; if (!v) throw new Error(`falta ${nome}`); return path.resolve(v); }
export async function main(args = process.argv.slice(2)) { const r = await gerarRelatorioLadoALado({ manifesto: valor(args, "--manifesto"), docker: valor(args, "--docker"), orgo: valor(args, "--orgo"), saida: valor(args, "--saida") }); process.stdout.write(`${JSON.stringify(r)}\n`); }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });

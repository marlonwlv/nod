import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validarManifestoShellVisual } from "../../infra/computador/shell-visual.mjs";

export function dimensoesPng(dados: Buffer): { largura: number; altura: number } {
  if (dados.length < 24 || dados.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || dados.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("screenshot_png_invalido");
  return { largura: dados.readUInt32BE(16), altura: dados.readUInt32BE(20) };
}

const escapar = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

export async function gerarRelatorioLadoALado(o: { manifesto: string; docker: string; orgo: string; saida: string }) {
  const manifesto = validarManifestoShellVisual(JSON.parse(await readFile(o.manifesto, "utf8")));
  await mkdir(o.saida, { recursive: true });
  const capturas: Array<{ breakpoint: string; docker: string; orgo: string }> = [];
  for (const b of manifesto.breakpoints) {
    const nome = `${b.largura}x${b.altura}.png`;
    const fontes = { docker: path.join(o.docker, nome), orgo: path.join(o.orgo, nome) };
    for (const [provedor, fonte] of Object.entries(fontes)) {
      const dimensoes = dimensoesPng(await readFile(fonte));
      if (dimensoes.largura !== b.largura || dimensoes.altura !== b.altura) throw new Error(`screenshot_dimensao_invalida:${provedor}:${nome}`);
      await copyFile(fonte, path.join(o.saida, `${provedor}-${nome}`));
    }
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

// 2026-11-28: monta a prova do painel no Electron (main.ts, preload.ts, pagina.html), roda e confere as metas do
// objetivo: a primeira imagem em menos de 1 s, nenhuma tecla perdida, o clique até a imagem nova em menos de 150 ms
// (mediana de 10), o login pelo painel chegando ao site e a rotina do bot na área logada depois da pausa.
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
// Dentro do repositório (node_modules/.cache): o bundle acha o agent-browser e o Chrome pelo node_modules de sempre.
const saida = join(aqui, "../../../node_modules/.cache/nod-prova-painel");
mkdirSync(saida, { recursive: true });
// A API do esbuild (não a linha de comando: no Windows o shell partia o banner em vários arquivos de entrada).
const { build } = await import("esbuild");
// NOD_PROVA_SITE=real: o SauceDemo de verdade (main-real.ts), em vez do site de teste local.
const real = process.env.NOD_PROVA_SITE === "real";
const comum = { bundle: true, platform: "node", external: ["electron", "bufferutil", "utf-8-validate"], logLevel: "error" };
await build({ ...comum, entryPoints: [join(aqui, real ? "main-real.ts" : "main.ts")], format: "esm", outfile: join(saida, "main.mjs"), banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
await build({ ...comum, entryPoints: [join(aqui, "preload.ts")], format: "cjs", outfile: join(saida, "preload.cjs") });
copyFileSync(join(aqui, "pagina.html"), join(saida, "pagina.html"));
copyFileSync(join(aqui, "pagina-real.html"), join(saida, "pagina-real.html"));
const electron = process.env.NOD_ELECTRON ?? createRequire(import.meta.url)("electron");
const filho = spawn(electron, [join(saida, "main.mjs")], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
let texto = "";
filho.stdout.on("data", (d) => { texto += d.toString(); });
filho.on("exit", (codigo) => {
  const linha = texto.split("\n").find((l) => l.startsWith("RESULTADO "));
  if (!linha) { process.stderr.write(`sem resultado (código ${codigo})\n${texto.slice(-2000)}\n`); process.exit(1); }
  const r = JSON.parse(linha.slice("RESULTADO ".length));
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  const metas = real ? [
    ["o painel abre com a primeira imagem em menos de 1 s", r.abrirMs < 1000],
    ["nenhuma tecla perdida (todas confirmadas, o usuário inteiro no campo)", r.falhas === 0 && r.teclas >= 13 && r.usuario === "standard_user"],
    ["do clique à imagem nova em menos de 150 ms (mediana)", r.cliqueQuadroMediana < 150],
    ["entrou na área logada do site real pelo painel", r.logadoPeloPainel === true],
    ["a rotina do bot usou o login feito no painel (6 produtos, o mais barato primeiro)", r.rotina?.url === "/inventory.html" && r.rotina?.produtos === 6 && /\$7\.99$/.test(r.rotina?.maisBarato ?? "")],
  ] : [
    ["o painel abre com a primeira imagem em menos de 1 s", r.abrirMs < 1000],
    ["nenhuma tecla perdida (todas confirmadas)", r.falhas === 0 && r.teclas >= 20],
    ["do clique à imagem nova em menos de 150 ms (mediana)", r.cliqueQuadroMediana < 150],
    ["o site recebeu CPF, senha com acento e colada e o código", r.recebidos?.cpf === "123.456.789-09" && r.recebidos?.senha === "Senhã@2026 çé" && r.recebidos?.codigo === "481516"],
    ["entrou na área logada pelo painel", r.logadoPeloPainel === true],
    ["a rotina do bot usou o login feito no painel", r.rotina?.ola === "Olá, José" && r.rotina?.perfis?.length === 2],
  ];
  for (const [nome, ok] of metas) process.stdout.write(`${ok ? "ok  " : "FALHOU"} ${nome}\n`);
  process.exit(metas.every(([, ok]) => ok) ? 0 : 1);
});

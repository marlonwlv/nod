// ADR-190 (decisão 5, definido em 2026-11-20): o binário nativo do agent-browser vai no app do Mac, FORA do asar, em
// Contents/Resources/agent-browser/agent-browser (extraResources do electron-builder.yml, `from: dist/agent-browser/${arch}`):
// o app o roda como processo (spawn), e um executável dentro do asar não roda. A versão é a mesma fixa do package.json
// (o motor do servidor usa a mesma). O electron-builder assina tudo o que é Mach-O dentro do .app, então o binário sai
// assinado e notarizado com o resto.
//
// Para cada arquitetura do release (arm64 e x64): o pacote da plataforma já instalado em node_modules (a da máquina que
// compila) ou, se faltar, o `npm pack @agent-browser/cli-darwin-<arch>@<versão>` (a outra arquitetura). Sem rede, a
// arquitetura que falta fica sem o binário e o app dela diz "atualize o app" ao bot — o build não cai.
//
// Uso: node scripts/desktop/agent-browser-binario.mjs [arm64] [x64]   (sem argumentos, as duas)
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const versao = JSON.parse(readFileSync("node_modules/agent-browser/package.json", "utf8")).version;
const pedidas = process.argv.slice(2).filter((a) => a === "arm64" || a === "x64");
const archs = pedidas.length ? pedidas : ["arm64", "x64"];

for (const arch of archs) {
  const pacote = `@agent-browser/cli-darwin-${arch}`;
  const destino = join("dist", "agent-browser", arch);
  mkdirSync(destino, { recursive: true });
  let origem = join("node_modules", pacote, "bin", "agent-browser");
  let temporario = null;
  if (!existsSync(origem)) {
    temporario = mkdtempSync(join(tmpdir(), "nod-agent-browser-"));
    const r = spawnSync("npm", ["pack", `${pacote}@${versao}`, "--silent", "--pack-destination", temporario], { encoding: "utf8" });
    const tgz = r.status === 0 ? r.stdout.trim().split("\n").at(-1) : "";
    const x = tgz ? spawnSync("tar", ["-xzf", join(temporario, tgz), "-C", temporario], { encoding: "utf8" }) : null;
    origem = join(temporario, "package", "bin", "agent-browser");
    if (!x || x.status !== 0 || !existsSync(origem)) {
      process.stderr.write(`agent-browser ${versao} para darwin-${arch} não veio (sem rede?): o app dessa arquitetura sai sem o navegador do bot.\n`);
      rmSync(temporario, { recursive: true, force: true });
      continue;
    }
  }
  copyFileSync(origem, join(destino, "agent-browser"));
  chmodSync(join(destino, "agent-browser"), 0o755);
  if (temporario) rmSync(temporario, { recursive: true, force: true });
  process.stdout.write(`agent-browser ${versao} darwin-${arch} → ${destino}/agent-browser\n`);
}

// ADR-197 (item 2, definido em 2026-11-26): o cua-driver vai no app do Mac, FORA do asar, em
// Contents/Resources/cua-driver/cua-driver (extraResources do electron-builder.yml, `from: dist/cua-driver`): o app o
// roda como processo filho (o macOS atribui Acessibilidade e Gravação de Tela ao nod) e um executável dentro do asar
// não roda. O pacote é o oficial da trycua, universal (arm64 + x64), na versão fixa de src/contracts/seu-computador.ts,
// com o sha256 conferido antes de extrair. O electron-builder assina tudo o que é Mach-O dentro do .app, então o binário
// sai reassinado com a conta do nod e notarizado com o resto (como o OpenMausBot faz).
//
// Sem rede, o app sai sem o binário e baixa o mesmo pacote (com o mesmo hash) na primeira vez que um bot usar o Mac —
// o build não cai.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const contrato = readFileSync("src/contracts/seu-computador.ts", "utf8");
const versao = /CUA_DRIVER_VERSAO = "([^"]+)"/.exec(contrato)?.[1];
const pacote = /"darwin-universal": \{ arquivo: "([^"]+)", sha256: "([0-9a-f]{64})" \}/.exec(contrato);
const base = /CUA_DRIVER_URL_BASE = "([^"]+)"/.exec(contrato)?.[1];
if (!versao || !pacote || !base) throw new Error("cua-driver: versão, pacote ou URL fora de src/contracts/seu-computador.ts");
const [, arquivo, sha] = pacote;
const destino = join("dist", "cua-driver");
const exe = join(destino, "cua-driver");
const marca = join(destino, "versao");

if (existsSync(exe) && existsSync(marca) && readFileSync(marca, "utf8").trim() === versao) {
  process.stdout.write(`cua-driver ${versao} já em ${exe}\n`);
} else {
  const temporario = mkdtempSync(join(tmpdir(), "nod-cua-driver-"));
  try {
    const r = await globalThis.fetch(base + arquivo, { redirect: "follow", signal: globalThis.AbortSignal.timeout(180_000) }).catch(() => null);
    if (!r?.ok) throw new Error(`download ${r?.status ?? "sem rede"}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== sha) throw new Error(`sha256 diferente do fixado (${hash})`);
    const tgz = join(temporario, arquivo);
    writeFileSync(tgz, bytes);
    const x = spawnSync("tar", ["-xzf", tgz, "-C", temporario, "cua-driver"], { encoding: "utf8" });
    if (x.status !== 0 || !existsSync(join(temporario, "cua-driver"))) throw new Error(`tar: ${x.stderr}`);
    rmSync(destino, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });
    copyFileSync(join(temporario, "cua-driver"), exe);
    chmodSync(exe, 0o755);
    writeFileSync(marca, `${versao}\n`);
    process.stdout.write(`cua-driver ${versao} (universal) → ${exe}\n`);
  } catch (e) {
    process.stderr.write(`cua-driver ${versao} não veio (${e instanceof Error ? e.message : e}): o app baixa na primeira vez que um bot usar o Mac.\n`);
    mkdirSync(destino, { recursive: true });
  } finally {
    rmSync(temporario, { recursive: true, force: true });
  }
}

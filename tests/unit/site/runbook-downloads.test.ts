import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * NOD-322: o passo a passo de docs/release-desktop.md roda de verdade, contra um gcloud falso (o bucket é uma pasta) e
 * com os SHA256-*.txt gerados pelo mesmo comando do .github/workflows/desktop-release.yml. Assim o runbook não pode
 * divergir dos nomes da pasta v<versão>/ nem do formato dos hashes, e uma conferência que falha para tudo antes de
 * trocar os nomes estáveis.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const runbook = readFileSync(join(RAIZ, "docs/release-desktop.md"), "utf8");
const workflow = readFileSync(join(RAIZ, ".github/workflows/desktop-release.yml"), "utf8");
const passoAPasso = runbook.split("## Passo a passo")[1] ?? "";
const bloco = /```sh\n([\s\S]*?)```/.exec(passoAPasso)?.[1] ?? "";
const V = /^\s*V=(\S+)$/m.exec(bloco)?.[1] ?? "";
const comandoSha = /- name: SHA-256 do DMG e do ZIP\n\s+run: (.+)\n/.exec(workflow)?.[1] ?? "";
const ESTAVEIS = ["nod-mac-arm64.dmg", "nod-mac-x64.dmg", "nod-windows-x64.exe"];

// gcloud storage cp falso: gs://<bucket>/<caminho> vira $GCS/<bucket>/<caminho>; os metadados (--cache-control etc.)
// ficam em <objeto>.meta, e cópia gs→gs sem flag leva os da origem, como no GCS.
const GCLOUD = `#!/usr/bin/env bash
set -euo pipefail
[ "$1 $2" = "storage cp" ] || { echo "gcloud falso: só storage cp" >&2; exit 2; }
shift 2
flags=(); pos=(); noclobber=0
for a in "$@"; do
  case "$a" in --no-clobber|-n) noclobber=1 ;; --*) flags+=("$a") ;; -*) echo "flag desconhecida $a" >&2; exit 2 ;; *) pos+=("$a") ;; esac
done
mapa() { case "$1" in gs://*) echo "$GCS/\${1#gs://}" ;; *) echo "$1" ;; esac; }
dst="\${pos[-1]}"; unset 'pos[-1]'
for s in "\${pos[@]}"; do
  shopt -s nullglob; fontes=( $(mapa "$s") ); shopt -u nullglob
  [ "\${#fontes[@]}" -gt 0 ] || { echo "ERROR: No URLs matched: $s" >&2; exit 1; }
  for f in "\${fontes[@]}"; do
    [ -f "$f" ] || { echo "ERROR: não existe $f" >&2; exit 1; }
    alvo=$(mapa "$dst"); case "$dst" in */|.) alvo="$alvo/$(basename "$f")" ;; esac
    if [ "$noclobber" = 1 ] && [ -e "$alvo" ]; then echo "Skipping existing destination item: $dst"; continue; fi
    mkdir -p "$(dirname "$alvo")"; cp "$f" "$alvo"
    case "$dst" in gs://*)
      if [ "\${#flags[@]}" -gt 0 ]; then printf '%s\\n' "\${flags[@]}" > "$alvo.meta"
      elif [ -f "$f.meta" ]; then cp "$f.meta" "$alvo.meta"; else : > "$alvo.meta"; fi ;;
    esac
  done
done
`;

let dir: string;
let gcs: string;
let bin: string;
const bucket = (p: string) => join(gcs, "nodbot-downloads", p);
const ler = (p: string) => readFileSync(bucket(p), "utf8");

function rodarWorkflowSha(release: string, arch: string) {
  const r = spawnSync("bash", ["-euo", "pipefail", "-c", comandoSha], { cwd: release, env: { ...process.env, ARCH: arch } });
  expect(r.status, r.stderr.toString()).toBe(0);
}

function publicarVersao() {
  // O que o job `downloads` sobe em gs://nodbot-downloads/v<versão>/, com os nomes do electron-builder.yml.
  const job = join(dir, "job");
  const release = join(job, "release");
  mkdirSync(release, { recursive: true });
  for (const arch of ["arm64", "x64"]) {
    writeFileSync(join(release, `nod-${V}-mac-${arch}.dmg`), `dmg ${arch} ${V}`);
    writeFileSync(join(release, `nod-${V}-mac-${arch}.zip`), `zip ${arch} ${V}`);
    rodarWorkflowSha(job, arch);
  }
  // Windows: o mesmo conteúdo que o passo PowerShell (Set-Content com CRLF; o .sha256 com -NoNewline).
  const exe = `exe ${V}`;
  writeFileSync(join(release, `nod-${V}-win-x64.exe`), exe);
  writeFileSync(join(release, "nod-windows-x64.exe"), exe);
  const h = spawnSync("sha256sum", [join(release, "nod-windows-x64.exe")]).stdout.toString().split(" ")[0];
  writeFileSync(join(release, "SHA256-win-x64.txt"), `${h}  nod-${V}-win-x64.exe\r\n`);
  writeFileSync(join(release, "nod-windows-x64.exe.sha256"), `${h}  nod-windows-x64.exe`);
  const pasta = bucket(`v${V}`);
  mkdirSync(pasta, { recursive: true });
  spawnSync("bash", ["-c", `cp release/* "${pasta}/"`], { cwd: job });
}

function rodarRunbook() {
  return spawnSync("bash", ["-c", bloco], {
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GCS: gcs, TMPDIR: dir },
    encoding: "utf8",
  });
}

describe("NOD-322: o runbook dos downloads estáveis roda contra o formato do desktop-release.yml", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "runbook-"));
    gcs = join(dir, "gcs");
    bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gcloud"), GCLOUD);
    chmodSync(join(bin, "gcloud"), 0o755);
    mkdirSync(bucket(""), { recursive: true });
    for (const f of ESTAVEIS) {
      writeFileSync(bucket(f), `antigo ${f}`);
      writeFileSync(bucket(`${f}.meta`), "--cache-control=no-store\n");
    }
    publicarVersao();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("acha o bloco do runbook, a versão e o comando de hash do workflow", () => {
    expect(V).toMatch(/^\d+\.\d+\.\d+(-rc\.\d+)?$/);
    expect(comandoSha).toContain("shasum -a 256 release/");
    expect(bloco).toContain("sha256sum -c");
  });

  it("caminho feliz: troca os três nomes estáveis pelos da versão, sem cache, e guarda os antigos", () => {
    const r = rodarRunbook();
    expect(r.status, r.stderr).toBe(0);
    expect(ler("nod-mac-arm64.dmg")).toBe(`dmg arm64 ${V}`);
    expect(ler("nod-mac-x64.dmg")).toBe(`dmg x64 ${V}`);
    expect(ler("nod-windows-x64.exe")).toBe(`exe ${V}`);
    for (const f of ESTAVEIS) {
      // Os objetos de hoje têm cache-control: no-store; um cp sem a flag volta ao padrão público de 1 h do GCS.
      expect(ler(`${f}.meta`), f).toContain("--cache-control=no-store");
      expect(readFileSync(bucket(`anterior/antes-de-v${V}/${f}`), "utf8")).toBe(`antigo ${f}`);
    }
  });

  // Regression: ISSUE-002 — tirar a conferência do .exe do runbook não quebrava nenhum teste (só o DMG x64 era adulterado).
  // Found by /qa on 2026-11-14 (mutante no docs/release-desktop.md).
  it.each(["nod-$V-mac-arm64.dmg", "nod-$V-mac-x64.dmg", "nod-windows-x64.exe"])("hash que não bate (%s) para tudo antes de tocar na raiz do bucket", (nome) => {
    writeFileSync(bucket(`v${V}/${nome.replace("$V", V)}`), "adulterado");
    const r = rodarRunbook();
    expect(r.status).not.toBe(0);
    for (const f of ESTAVEIS) expect(ler(f), f).toBe(`antigo ${f}`);
  });

  it("rodar de novo (ex.: depois de uma falha no meio) não apaga o backup da versão anterior", () => {
    expect(rodarRunbook().status).toBe(0);
    const r = rodarRunbook();
    expect(r.status, r.stderr).toBe(0);
    for (const f of ESTAVEIS) {
      expect(readFileSync(bucket(`anterior/antes-de-v${V}/${f}`), "utf8"), f).toBe(`antigo ${f}`);
    }
    expect(existsSync(bucket("anterior/nod-mac-arm64.dmg"))).toBe(false);
  });
});

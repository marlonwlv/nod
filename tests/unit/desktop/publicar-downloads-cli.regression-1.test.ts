import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Contrato saudável codificado por /qa em 2026-11-19: CLI real, bytes reais, só serviços externos falsos.
// Value: protects=validar as duas arquiteturas antes de escrever; fails_when=guarda SHA removida;
// why_new=helpers isolados não percorrem main/download/hash/GCS; seam=none.
const falsoGh = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2), caso = process.env.CASO;
const nomes = ['arm64', 'x64'].map(a => 'nod-2.0.0-mac-' + a + '.dmg');
const emitir = x => process.stdout.write(JSON.stringify(x));
if (args[0] === 'release') {
  const dir = args[args.indexOf('--dir') + 1];
  for (const [i, nome] of nomes.entries()) {
    const bytes = Buffer.from('DMG sintético ' + i);
    writeFileSync(join(dir, nome), bytes);
    const hash = caso === 'hash-' + i ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(dir, 'SHA256-' + ['arm64', 'x64'][i] + '.txt'), hash + '  release/' + nome + '\\n');
  }
} else if (args[1].includes('releases/tags/')) {
  emitir({ draft: caso === 'draft', published_at: '2026-11-19', tag_name: 'v2.0.0', assets: [...nomes, 'SHA256-arm64.txt', 'SHA256-x64.txt'].filter(n => caso !== 'asset' || n !== nomes[1]).map(name => ({name})) });
} else if (args[1].includes('git/ref/')) emitir({object: {type:'commit', sha:'a'.repeat(40)}});
else if (args[1].includes('/runs?')) emitir({workflow_runs: caso === 'run' ? [] : [{id:1, head_sha:caso === 'sha' ? 'b'.repeat(40) : 'a'.repeat(40), head_branch:'v2.0.0', conclusion:'success', event:'push', head_repository:{full_name:'marlonwlv/nod'}}]});
else if (args[1].includes('/jobs?')) emitir({jobs:['draft', 'mac (arm64, arm64, macos-15)', 'mac (x64, amd64, macos-15-intel)'].map(name => ({name, conclusion:caso === 'job' && name.startsWith('mac (x64') ? 'failure' : 'success'}))});
else throw new Error('gh inesperado: ' + args);
`;
const rede = `import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const objetos = new Map(), sessoes = new Map();
const json = x => Response.json(x);
const persistir = () => writeFileSync(process.env.ESTADO, JSON.stringify([...objetos.entries()].map(([nome, o]) => ({nome, ...o.meta, bytes:o.bytes.toString('base64')}))));
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input)), metodo = init.method || 'GET';
  appendFileSync(process.env.CHAMADAS, metodo + ' ' + u.pathname + '\\n');
  if (u.hostname === 'nodbot.ai') return new Response(null, {status:302, headers:{location:'https://storage.googleapis.com/downloads-exemplo/nod-mac-' + (u.pathname.endsWith('mac-intel') ? 'x64' : 'arm64') + '.dmg'}});
  if (u.hostname !== 'storage.googleapis.com') throw new Error('rede não permitida');
  if (metodo === 'HEAD') {
    const o = objetos.get(u.pathname.split('/').at(-1));
    return new Response(null, {status:o ? 200 : 404, headers:{'content-length':String(o?.bytes.length || 0)}});
  }
  if (u.pathname.startsWith('/upload/')) {
    const meta = JSON.parse(init.body), id = String(sessoes.size + 1); sessoes.set(id, meta);
    return new Response(null, {headers:{location:'https://storage.googleapis.com/session/' + id}});
  }
  if (u.pathname.startsWith('/session/')) {
    const meta = sessoes.get(u.pathname.split('/').at(-1)), chunks = [];
    for await (const chunk of init.body) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (meta.md5Hash !== createHash('md5').update(bytes).digest('base64')) throw new Error('MD5 incorreto');
    const o = {meta:{...meta, generation:String(objetos.size + 1), metageneration:'1', size:String(bytes.length)}, bytes};
    objetos.set(meta.name, o); persistir(); return json(o.meta);
  }
  const path = u.pathname.split('/o/')[1], nome = decodeURIComponent(path.split('/rewriteTo/')[0]);
  if (metodo === 'POST') {
    const destino = decodeURIComponent(u.pathname.split('/o/').at(-1)), fonte = objetos.get(nome), meta = JSON.parse(init.body);
    const o = {bytes:fonte.bytes, meta:{...fonte.meta, ...meta}}; objetos.set(destino,o); persistir();
    return json({done:true, resource:o.meta});
  }
  const o = objetos.get(nome);
  return o ? u.searchParams.get('alt') === 'media' ? new Response(o.bytes) : json(o.meta) : new Response(null, {status:404});
};
`;
async function executar(caso: string, mutante = false) {
  const dir = await mkdtemp(join(tmpdir(), "nod-publicar-cli-"));
  try {
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    await writeFile(join(dir, "gh"), falsoGh); await chmod(join(dir, "gh"), 0o700);
    await writeFile(join(dir, "gcloud"), "#!/bin/sh\necho token-sintetico\n"); await chmod(join(dir, "gcloud"), 0o700);
    await writeFile(join(dir, "rede.mjs"), rede);
    await writeFile(join(dir, "chamadas"), ""); await writeFile(join(dir, "estado"), "[]");
    let entry = resolve("scripts/desktop/publicar-downloads.mjs");
    if (mutante) {
      await mkdir(join(dir, "scripts/desktop"), { recursive: true }); await mkdir(join(dir, "src/domain"), { recursive: true });
      await copyFile(entry, join(dir, "scripts/desktop/publicar-downloads.mjs"));
      await copyFile("src/domain/versao-app.ts", join(dir, "src/domain/versao-app.ts"));
      const core = await readFile("scripts/desktop/publicar-downloads-core.ts", "utf8");
      await writeFile(join(dir, "scripts/desktop/publicar-downloads-core.ts"), core.replace('exigir(h.sha256 === esperado, "sha256_divergente: nenhum objeto foi escrito");', 'exigir(true, "guarda removida pelo mutante");'));
      entry = join(dir, "scripts/desktop/publicar-downloads.mjs");
    }
    const r = spawnSync(process.execPath, ["--import", join(dir, "rede.mjs"), entry], {
      encoding: "utf8", timeout: 15_000,
      env: { PATH: `${dir}:${process.env.PATH}`, TAG: caso === "desktop" ? "desktop-v2.0.0" : "v2.0.0", GITHUB_REPOSITORY: "marlonwlv/nod", GITHUB_REF: "refs/heads/main", BUCKET: "downloads-exemplo", CASO: caso, ESTADO: join(dir, "estado"), CHAMADAS: join(dir, "chamadas") },
    });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout, chamadas: await readFile(join(dir, "chamadas"), "utf8"), objetos: JSON.parse(await readFile(join(dir, "estado"), "utf8")) as {nome: string; cacheControl: string; metadata: {versao?: string}; md5Hash: string; bytes: string}[] };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
// Processo completo <1s local; teto cobre subprocesso de 15s mais setup/cleanup sob carga (AGENTS.md).
describe("CLI publicação de downloads", () => {
  it("publica bytes dos dois DMGs e manifesto antes de conferir os links públicos", async () => {
    const r = await executar("ok");
    expect(r.stderr).toBe(""); expect(r.status).toBe(0); expect(r.stdout).toContain("estáveis conferidos"); expect(r.objetos).toHaveLength(5);
    for (const arch of ["arm64", "x64"]) {
      const estavel = r.objetos.find(o => o.nome === `nod-mac-${arch}.dmg`)!;
      const versao = r.objetos.find(o => o.nome === `v2.0.0/nod-2.0.0-mac-${arch}.dmg`)!;
      expect(estavel.bytes).toBe(versao.bytes); expect(estavel.md5Hash).toBe(versao.md5Hash);
      expect(estavel.metadata.versao).toBe("2.0.0"); expect(estavel.cacheControl).toBe("public, max-age=300"); expect(versao.cacheControl).toBe("public, max-age=31536000");
    }
  }, 20_000);
  it.each([["hash-0", "sha256_divergente"], ["hash-1", "sha256_divergente"], ["draft", "release_nao_publicada"], ["asset", "assets_incompletos"], ["run", "run_assinado_ausente"], ["sha", "run_assinado_ausente"], ["job", "run_assinado_ausente"]])("%s recusa antes de qualquer escrita", async (caso, erro) => {
    const r = await executar(caso!);
    expect(r.status).toBe(1); expect(r.stderr).toContain(erro); expect(r.objetos).toEqual([]); expect(r.chamadas).not.toMatch(/POST|PUT|PATCH|DELETE/);
  }, 20_000);
  it("ignora desktop-v sem acessar rede", async () => {
    const r = await executar("desktop"); expect(r.status).toBe(0); expect(r.chamadas).toBe(""); expect(r.objetos).toEqual([]);
  }, 20_000);
  it("mata o mutante que remove a comparação dos hashes dos DMGs", async () => {
    const r = await executar("hash-1", true);
    // A mesma entrada que rejeitamos acima passa e grava com a guarda removida.
    expect(r.status).toBe(0); expect(r.objetos).toHaveLength(5); expect(r.chamadas).toContain("POST");
  }, 20_000);
});

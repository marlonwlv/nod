import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compararVersoesDoApp, versaoDoAppValida } from "../../src/domain/versao-app.ts";

export const ARCHS = ["arm64", "x64"] as const;
const REPO = "marlonwlv/nod";
export const CACHE_VERSAO = "public, max-age=31536000";
export const CACHE_ESTAVEL = "public, max-age=300";
const exigir = (ok: unknown, motivo: string): void => { if (!ok) throw new Error(motivo); };
export function versaoDaTag(tag: string): string {
  exigir(tag.startsWith("v") && versaoDoAppValida(tag.slice(1)), "tag_invalida: use vX.Y.Z[-rc.N]");
  return tag.slice(1);
}
export function decidirPublicacao({ tag, atuais, permitirVoltar = false }: {
  tag: string; atuais: (string | null)[]; permitirVoltar?: boolean;
}): { ignorada: boolean; promover: boolean } {
  if (tag.startsWith("desktop-v")) return { ignorada: true, promover: false };
  const v = versaoDaTag(tag);
  exigir(typeof permitirVoltar === "boolean", "rollback_invalido");
  exigir(atuais.length === 2, "esperava_duas_arquiteturas");
  for (const atual of atuais) exigir(atual === null || versaoDoAppValida(atual), "versao_estavel_desconhecida: adote o objeto manualmente após conferir seu hash");
  return { ignorada: false, promover: permitirVoltar || atuais.every((a) => a === null || compararVersoesDoApp(v, a)! >= 0) };
}
export function checksumDoDmg(texto: string, nome: string): string {
  const linhas = texto.trim().split(/\r?\n/);
  const hashes: string[] = [];
  for (const linha of linhas) {
    const m = /^([a-fA-F0-9]{64}) [ *](?:release\/)?([^/\\\s]+)$/.exec(linha);
    exigir(m, "checksum_formato_invalido");
    if (m![2] === nome) hashes.push(m![1]!.toLowerCase());
    else exigir(m![2] === nome.replace(/\.dmg$/, ".zip"), "checksum_arquivo_inesperado");
  }
  exigir(hashes.length === 1, "checksum_dmg_ausente_ou_duplicado");
  return hashes[0]!;
}
export type Objeto = { generation: string; metageneration: string; md5Hash: string; size: string; cacheControl?: string; metadata?: Record<string, string> };
export type Arquivo = { nome: string; local: string; sha256: string; md5: string; tamanho: number };
export interface Armazem {
  ler(nome: string): Promise<Objeto | null>;
  hash(nome: string, generation: string): Promise<string>;
  criar(arquivo: Arquivo): Promise<Objeto>;
  copiar(origem: string, objeto: Objeto, destino: string, atual: Objeto | null, versao: string): Promise<Objeto>;
}
export async function hashes(stream: AsyncIterable<Uint8Array>): Promise<{ sha256: string; md5: string; tamanho: number }> {
  const sha = createHash("sha256"), md5 = createHash("md5"); let tamanho = 0;
  for await (const chunk of stream) { sha.update(chunk); md5.update(chunk); tamanho += chunk.length; }
  return { sha256: sha.digest("hex"), md5: md5.digest("base64"), tamanho };
}
export async function publicar(tag: string, arquivos: Arquivo[], store: Armazem, permitirVoltar = false): Promise<boolean> {
  const v = versaoDaTag(tag);
  const nomes = ARCHS.map((a) => `${tag}/nod-${v}-mac-${a}.dmg`);
  exigir(arquivos.length === 3 && [...nomes, `${tag}/SHA256SUMS.txt`].every((n) => arquivos.filter((a) => a.nome === n).length === 1), "arquivos_incompletos");
  // Todo conflito é descoberto antes da primeira escrita, inclusive na segunda arquitetura e no manifesto.
  exigir(nomes.every((n, i) => arquivos[i]?.nome === n), "ordem_arquiteturas_invalida");
  const existentes = await Promise.all(arquivos.map((a) => store.ler(a.nome)));
  for (const [i, a] of arquivos.entries()) {
    const o = existentes[i];
    if (o) {
      exigir(await store.hash(a.nome, o.generation) === a.sha256, "versionado_divergente: não sobrescrever");
      exigir(o.cacheControl === CACHE_VERSAO, "cache_versionado_invalido: corrigir metadados antes de repetir");
    }
  }
  const destinos = ARCHS.map((a) => `nod-mac-${a}.dmg`);
  const atuais = await Promise.all(destinos.map((n) => store.ler(n)));
  const decisao = decidirPublicacao({ tag, atuais: atuais.map((a) => a ? (a.metadata?.versao ?? "") : null), permitirVoltar });
  // Na mesma versão, uma divergência de bytes não pode ser silenciosamente substituída.
  for (const [i, atual] of atuais.entries()) {
    if (atual?.metadata?.versao === v) exigir(await store.hash(destinos[i]!, atual.generation) === arquivos[i]!.sha256, "estavel_mesma_versao_divergente");
  }
  const fontes: Objeto[] = [];
  for (const [i, a] of arquivos.entries()) fontes.push(existentes[i] ?? await store.criar(a));
  if (!decisao.promover) return false;
  for (const [i, destino] of destinos.entries()) {
    const atual = atuais[i]!, fonte = fontes[i]!;
    const resultado = atual?.metadata?.versao === v && atual.md5Hash === fonte.md5Hash && atual.cacheControl === CACHE_ESTAVEL
      ? atual : await store.copiar(nomes[i]!, fonte, destino, atual, v);
    exigir(resultado.md5Hash === fonte.md5Hash && resultado.size === fonte.size && resultado.metadata?.versao === v && resultado.cacheControl === CACHE_ESTAVEL, "copia_nao_conferiu");
  }
  return true;
}

export function criarGcs(bucket: string, token: () => string, fetchImpl: typeof fetch = fetch): Armazem {
  exigir(/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket), "bucket_invalido");
  const base = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/`;
  async function request(url: string, init: RequestInit = {}, falta = false): Promise<Response | null> {
    const r = await fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(120_000), redirect: "error" });
    if (falta && r.status === 404) return null;
    exigir(r.ok, `gcs_http_${r.status}: confira acesso ou concorrência e repita a execução`);
    return r;
  }
  return {
    async ler(nome) { const r = await request(base + encodeURIComponent(nome), {}, true); return r ? await r.json() as Objeto : null; },
    async hash(nome, generation) {
      const r = await request(`${base}${encodeURIComponent(nome)}?alt=media&generation=${generation}`);
      exigir(r?.body, "objeto_sem_corpo");
      return (await hashes(r!.body!)).sha256;
    },
    async criar(a) {
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=resumable&ifGenerationMatch=0`;
      const inicio = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: a.nome, cacheControl: CACHE_VERSAO, md5Hash: a.md5, metadata: { sha256: a.sha256 } }) });
      const location = inicio!.headers.get("location");
      exigir(location && new URL(location).origin === "https://storage.googleapis.com", "upload_location_invalida");
      // O token de sessão fica só em memória; nunca chega ao log.
      const init = { method: "PUT", headers: { "Content-Length": String(a.tamanho) }, body: createReadStream(a.local), duplex: "half" };
      const r = await request(location!, init as RequestInit);
      const o = await r!.json() as Objeto;
      exigir(o.md5Hash === a.md5 && Number(o.size) === a.tamanho && o.cacheControl === CACHE_VERSAO, "upload_nao_conferiu");
      return o;
    },
    async copiar(origem, fonte, destino, atual, versao) {
      const params = new URLSearchParams({ ifSourceGenerationMatch: fonte.generation, ifGenerationMatch: atual?.generation ?? "0" });
      if (atual) params.set("ifMetagenerationMatch", atual.metageneration);
      const url = `${base}${encodeURIComponent(origem)}/rewriteTo/b/${bucket}/o/${encodeURIComponent(destino)}`;
      for (let i = 0; i < 100; i++) {
        const r = await request(`${url}?${params}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cacheControl: CACHE_ESTAVEL, metadata: { versao } }) });
        const resultado = await r!.json() as { done: boolean; resource: Objeto; rewriteToken?: string };
        if (resultado.done) return resultado.resource as Objeto;
        exigir(typeof resultado.rewriteToken === "string", "rewrite_sem_token");
        params.set("rewriteToken", resultado.rewriteToken!);
      }
      throw new Error("rewrite_incompleto: repita a execução");
    },
  };
}
const comando = (bin: string, args: string[]): string => execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
const api = (path: string): unknown => JSON.parse(comando("gh", ["api", `repos/${REPO}/${path}`]));
type Run = { id: number; head_sha: string; head_branch: string; conclusion: string; event: string; head_repository: { full_name: string } };
type Job = { name: string; conclusion: string };
export function runAceito(run: Run, jobs: Job[], tag: string, sha: string): boolean {
  return run.conclusion === "success" && run.head_sha === sha && run.head_branch === tag && run.head_repository.full_name === REPO && ["push", "workflow_dispatch"].includes(run.event)
    && jobs.some((j) => j.name === "draft" && j.conclusion === "success")
    && ARCHS.every((a) => jobs.some((j) => j.name.startsWith(`mac (${a},`) && j.conclusion === "success"));
}
export async function conferirLinks(bucket: string, arquivos?: Arquivo[], fetchImpl: typeof fetch = fetch): Promise<void> {
  for (const [i, arch] of ARCHS.entries()) {
    const url = `https://storage.googleapis.com/${bucket}/nod-mac-${arch}.dmg`;
    const site = await fetchImpl(`https://nodbot.ai/download/${i === 0 ? "mac" : "mac-intel"}`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(30_000) });
    exigir(site.status === 302 && site.headers.get("location") === url, "redirect_divergente: conferir bucket configurado e site");
    if (arquivos) {
      const r = await fetchImpl(`${url}?verificar=${arquivos[i]!.sha256}`, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(30_000) });
      exigir(r.status === 200 && Number(r.headers.get("content-length")) === arquivos[i]!.tamanho, "download_publico_nao_conferiu");
    }
  }
}
export type Release = { draft: boolean; tag_name: string; published_at: string | null; assets: { name: string }[] };
export function validarRelease(release: Release, tag: string): string[] {
  const v = versaoDaTag(tag);
  exigir(!release.draft && release.published_at && release.tag_name === tag, "release_nao_publicada");
  const assets = [...ARCHS.map((a) => `nod-${v}-mac-${a}.dmg`), ...ARCHS.map((a) => `SHA256-${a}.txt`)];
  exigir(assets.every((n) => release.assets.filter((a) => a.name === n).length === 1), "assets_incompletos");
  return assets;
}
export async function main(): Promise<void> {
  const tag = process.env.TAG ?? "";
  if (tag.startsWith("desktop-v")) { process.stdout.write("ignorada: desktop-v\n"); return; }
  const v = versaoDaTag(tag);
  exigir(process.env.GITHUB_REPOSITORY === REPO && process.env.GITHUB_REF === "refs/heads/main", "origem_invalida");
  const voltar = process.env.PERMITIR_VOLTAR ?? "false";
  exigir(["true", "false"].includes(voltar), "rollback_invalido");
  const bucket = process.env.BUCKET ?? "";
  const store = criarGcs(bucket, () => comando("gcloud", ["auth", "print-access-token"]).trim());
  await conferirLinks(bucket);
  const assets = validarRelease(api(`releases/tags/${tag}`) as Release, tag);
  const dmgs = ARCHS.map((a) => `nod-${v}-mac-${a}.dmg`);
  let ref = (api(`git/ref/tags/${tag}`) as { object: { type: string; sha: string } }).object;
  for (let i = 0; ref.type === "tag" && i < 10; i++) ref = (api(`git/tags/${ref.sha}`) as { object: typeof ref }).object;
  exigir(ref.type === "commit" && /^[a-f0-9]{40}$/.test(ref.sha), "tag_sem_commit");
  let aprovado = false;
  for (let page = 1; page <= 10 && !aprovado; page++) {
    const { workflow_runs: runs } = api(`actions/workflows/desktop-release.yml/runs?head_sha=${ref.sha}&status=success&per_page=100&page=${page}`) as { workflow_runs: Run[] };
    for (const run of runs) {
      const { jobs } = api(`actions/runs/${run.id}/jobs?per_page=100`) as { jobs: Job[] };
      if (runAceito(run, jobs, tag, ref.sha)) { aprovado = true; break; }
    }
    if (runs.length < 100) break;
  }
  exigir(aprovado, "run_assinado_ausente: requer desktop-release verde no SHA/tag com draft e dois Macs");
  const dir = await mkdtemp(join(tmpdir(), "nod-downloads-"));
  try {
    comando("gh", ["release", "download", tag, "--repo", REPO, "--dir", dir, ...assets.flatMap((n) => ["--pattern", n])]);
    const arquivos: Arquivo[] = [];
    for (const [i, nome] of dmgs.entries()) {
      const local = join(dir, nome), h = await hashes(createReadStream(local));
      const esperado = checksumDoDmg(await readFile(join(dir, `SHA256-${ARCHS[i]}.txt`), "utf8"), nome);
      exigir(h.sha256 === esperado, "sha256_divergente: nenhum objeto foi escrito");
      arquivos.push({ nome: `${tag}/${nome}`, local, ...h });
    }
    const local = join(dir, "SHA256SUMS.txt");
    await writeFile(local, arquivos.map((a, i) => `${a.sha256}  ${dmgs[i]}\n`).join(""));
    arquivos.push({ nome: `${tag}/SHA256SUMS.txt`, local, ...await hashes(createReadStream(local)) });
    const promoveu = await publicar(tag, arquivos, store, voltar === "true");
    if (promoveu) await conferirLinks(bucket, arquivos);
    process.stdout.write(promoveu ? "publicado: versionados e estáveis conferidos\n" : "publicado: só versionados, sem downgrade\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

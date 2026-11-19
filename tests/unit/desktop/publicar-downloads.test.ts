import { describe, expect, it, vi } from "vitest";
import { CACHE_ESTAVEL, CACHE_VERSAO, checksumDoDmg, criarGcs, decidirPublicacao, publicar, runAceito, conferirLinks, validarRelease } from "../../../scripts/desktop/publicar-downloads.mjs";
import type { Armazem, Arquivo, Objeto } from "../../../scripts/desktop/publicar-downloads.mjs";
import { readFileSync } from "node:fs";
const h = "a".repeat(64);
const arquivos: Arquivo[] = ["nod-2.0.0-mac-arm64.dmg", "nod-2.0.0-mac-x64.dmg", "SHA256SUMS.txt"].map((n, i) => ({ nome: `v2.0.0/${n}`, local: n, sha256: h + i, md5: `md5-${i}`, tamanho: 10 }));
function fixture() {
  const objetos = new Map<string, Objeto>(), bytes = new Map<string, string>();
  let generation = 0;
  const criar = (a: Arquivo, cacheControl = CACHE_VERSAO, versao?: string) => {
    const o: Objeto = { generation: String(++generation), metageneration: "1", md5Hash: a.md5, size: String(a.tamanho), cacheControl, metadata: versao ? { versao } : {} };
    objetos.set(a.nome, o); bytes.set(a.nome, a.sha256); return o;
  };
  const store: Armazem = {
    ler: vi.fn(async (n) => objetos.get(n) ?? null), hash: vi.fn(async (n) => bytes.get(n)!),
    criar: vi.fn(async (a) => criar(a)), copiar: vi.fn(async (n, _o, destino, _atual, versao) => criar({ ...arquivos.find((a) => a.nome === n)!, nome: destino }, CACHE_ESTAVEL, versao)),
  };
  return { store, objetos, bytes, criar };
}
describe("decisão de publicação", () => {
  it("ignora builds locais", () => expect(decidirPublicacao({ tag: "desktop-v2", atuais: [] })).toEqual({ ignorada: true, promover: false }));
  it.each(["v01.0.0", "v2", "v1.0.0-beta.1", "v1.0.0;echo", "v9007199254740992.0.0"])("recusa %s", (tag) => expect(() => decidirPublicacao({ tag, atuais: [null, null] })).toThrow("tag_invalida"));
  it.each([
    ["v2.0.0", "1.0.0", false, true], ["v1.0.0", "2.0.0", false, false],
    ["v1.0.0", "2.0.0", true, true], ["v2.0.0-rc.1", "2.0.0", false, false],
    ["v2.0.0", "2.0.0-rc.9", false, true], ["v2.0.0", "2.0.0", false, true],
  ] as const)("%s sobre %s rollback=%s → %s", (tag, atual, permitirVoltar, promover) => expect(decidirPublicacao({ tag, atuais: [atual, atual], permitirVoltar }).promover).toBe(promover));
  it("não rebaixa nenhuma das arquiteturas em estado parcial", () => expect(decidirPublicacao({ tag: "v2.0.0", atuais: ["3.0.0", "1.0.0"] }).promover).toBe(false));
  it("falha fechado sem versão do objeto legado", () => expect(() => decidirPublicacao({ tag: "v2.0.0", atuais: ["", null] })).toThrow("versao_estavel_desconhecida"));
});
describe("checksum", () => {
  it("aceita o formato DMG + ZIP do desktop-release", () => expect(checksumDoDmg(`${h}  release/nod-2-mac-arm64.dmg\n${h}  release/nod-2-mac-arm64.zip\n`, "nod-2-mac-arm64.dmg")).toBe(h));
  it.each([`${h}  ../x.dmg`, `${h}  x.zip`, `${h}  x.dmg\n${h}  x.dmg`, "errado  x.dmg"])("recusa manifesto inválido", (s) => expect(() => checksumDoDmg(s, "x.dmg")).toThrow());
});
describe("publicação com armazenamento", () => {
  it("cria imutáveis antes dos estáveis e repetir é idempotente", async () => {
    const { store } = fixture();
    expect(await publicar("v2.0.0", arquivos, store)).toBe(true);
    expect(store.criar).toHaveBeenCalledTimes(3); expect(store.copiar).toHaveBeenCalledTimes(2);
    expect(vi.mocked(store.criar).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(store.copiar).mock.invocationCallOrder[0]!);
    await publicar("v2.0.0", arquivos, store);
    expect(store.criar).toHaveBeenCalledTimes(3); expect(store.copiar).toHaveBeenCalledTimes(2);
  });
  it.each([0, 1, 2])("conflito no versionado %s impede toda escrita", async (i) => {
    const f = fixture(); f.criar({ ...arquivos[i]!, sha256: "outro" });
    await expect(publicar("v2.0.0", arquivos, f.store)).rejects.toThrow("versionado_divergente");
    expect(f.store.criar).not.toHaveBeenCalled(); expect(f.store.copiar).not.toHaveBeenCalled();
  });
  it("versão menor cria só versionados, rollback explícito promove", async () => {
    const f = fixture(); f.criar({ ...arquivos[0]!, nome: "nod-mac-arm64.dmg" }, CACHE_ESTAVEL, "3.0.0");
    expect(await publicar("v2.0.0", arquivos, f.store)).toBe(false); expect(f.store.copiar).not.toHaveBeenCalled();
    expect(await publicar("v2.0.0", arquivos, f.store, true)).toBe(true);
  });
  it("não escreve se versão do estável é desconhecida", async () => {
    const f = fixture(); f.criar({ ...arquivos[0]!, nome: "nod-mac-arm64.dmg" });
    await expect(publicar("v2.0.0", arquivos, f.store)).rejects.toThrow("versao_estavel_desconhecida"); expect(f.store.criar).not.toHaveBeenCalled();
  });
  it("falha entre arquiteturas é recuperável sem recópia da primeira", async () => {
    const f = fixture(), copiar = f.store.copiar;
    f.store.copiar = vi.fn(copiar).mockImplementationOnce(copiar).mockRejectedValueOnce(new Error("rede"));
    await expect(publicar("v2.0.0", arquivos, f.store)).rejects.toThrow("rede");
    await publicar("v2.0.0", arquivos, f.store); expect(f.store.copiar).toHaveBeenCalledTimes(3);
  });
  it("erro de leitura não vira ausência", async () => {
    const f = fixture(); f.store.ler = vi.fn().mockRejectedValue(new Error("403"));
    await expect(publicar("v2.0.0", arquivos, f.store)).rejects.toThrow("403"); expect(f.store.criar).not.toHaveBeenCalled();
  });
});
describe("proveniência", () => {
  const run = { id: 1, head_sha: h, head_branch: "v2.0.0", event: "push", conclusion: "success", head_repository: { full_name: "marlonwlv/nod" } };
  const jobs = ["draft", "mac (arm64, arm64, macos-15)", "mac (x64, amd64, macos-15-intel)"].map((name) => ({ name, conclusion: "success" }));
  it("aceita push e dispatch publicado", () => { for (const event of ["push", "workflow_dispatch"]) expect(runAceito({ ...run, event }, jobs, "v2.0.0", h)).toBe(true); });
  it("recusa seco, SHA errado, fork, tag errada e falha", () => {
    expect(runAceito(run, jobs.map((j) => j.name === "draft" ? { ...j, conclusion: "skipped" } : j), "v2.0.0", h)).toBe(false);
    for (const alteracao of [{ head_sha: "outro" }, { head_branch: "main" }, { conclusion: "failure" }, { head_repository: { full_name: "fork/nod" } }]) expect(runAceito({ ...run, ...alteracao }, jobs, "v2.0.0", h)).toBe(false);
  });
});
describe("adapter GCS e HTTP", () => {
  it("só 404 significa ausente", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 403 }));
    const gcs = criarGcs("downloads-exemplo", () => "token", f);
    expect(await gcs.ler("x")).toBeNull(); await expect(gcs.ler("x")).rejects.toThrow("gcs_http_403");
  });
  it("rewrite aplica CAS nas duas pontas e continua token", async () => {
    const o: Objeto = { generation: "7", metageneration: "2", md5Hash: "md5", size: "10" };
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ done: false, rewriteToken: "abc" })).mockResolvedValueOnce(Response.json({ done: true, resource: o }));
    await criarGcs("downloads-exemplo", () => "token", f).copiar("v2/x", o, "x", { ...o, generation: "4" }, "2.0.0");
    const u = new URL(String(f.mock.calls[1]![0]));
    expect(u.searchParams.get("ifSourceGenerationMatch")).toBe("7"); expect(u.searchParams.get("ifGenerationMatch")).toBe("4"); expect(u.searchParams.get("ifMetagenerationMatch")).toBe("2"); expect(u.searchParams.get("rewriteToken")).toBe("abc");
  });
  it("412 não é sucesso", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 412 }));
    await expect(criarGcs("downloads-exemplo", () => "token", f).copiar("x", { generation: "1", metageneration: "1", size: "1", md5Hash: "a" }, "y", null, "1.0.0")).rejects.toThrow("gcs_http_412");
  });
  it("redirect para outro bucket falha", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://example.org" } }));
    await expect(conferirLinks("downloads-exemplo", undefined, f)).rejects.toThrow("redirect_divergente");
  });
});
it("workflow separa release sem credencial e main com OIDC, gate e fila global", () => {
  const y = readFileSync(".github/workflows/publicar-downloads.yml", "utf8");
  const [encaminhar, publicador] = y.split("  publicar:");
  expect(encaminhar).toContain("github.event_name == 'release'"); expect(encaminhar).not.toContain("id-token: write"); expect(encaminhar).not.toContain("secrets.");
  for (const guarda of ["github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'", "vars.NOD_PUBLICAR_DOWNLOADS == '1'", "environment: producao", "id-token: write", "runs-on: ubuntu-latest"]) expect(publicador).toContain(guarda);
  expect(y).toContain("cancel-in-progress: false"); expect(y).toContain("group: publicar-downloads"); expect(y).not.toContain("pull_request");
  for (const u of y.matchAll(/uses: (.+)/g)) expect(u[1]).toMatch(/@[a-f0-9]{40}$/);
});

describe("release publicada", () => {
  const release = { draft: false, published_at: "2026-11-19", tag_name: "v2.0.0", assets: ["nod-2.0.0-mac-arm64.dmg", "nod-2.0.0-mac-x64.dmg", "SHA256-arm64.txt", "SHA256-x64.txt"].map((name) => ({ name })) };
  it("exige os quatro assets sem proibir ZIPs adicionais", () => expect(validarRelease({ ...release, assets: [...release.assets, { name: "extra.zip" }] }, "v2.0.0")).toHaveLength(4));
  it.each([0, 1, 2, 3])("falta do asset %s reprova", (i) => expect(() => validarRelease({ ...release, assets: release.assets.filter((_, j) => j !== i) }, "v2.0.0")).toThrow("assets_incompletos"));
  it("draft e release sem publicação reprovam", () => {
    expect(() => validarRelease({ ...release, draft: true }, "v2.0.0")).toThrow("release_nao_publicada");
    expect(() => validarRelease({ ...release, published_at: null }, "v2.0.0")).toThrow("release_nao_publicada");
  });
});

it("provisionamento limita objectAdmin ao bucket e não cria chave nem altera provider", () => {
  const s = readFileSync("infra/gcp/provisionar-downloads.sh", "utf8");
  expect(s).toContain('storage buckets add-iam-policy-binding "gs://$BUCKET_DOWNLOADS"');
  expect(s).not.toMatch(/projects add-iam-policy-binding|keys create|providers (create|update)/);
  expect(s).toContain("assertion.repository_id"); expect(s).toContain("refs/heads/main"); expect(s).toContain("assertion.environment");
  expect(s).toContain('[[ "$BUCKET_PROJETO" == "$NUMERO" ]]');
  expect(s.indexOf('[[ "$BUCKET_PROJETO"')).toBeLessThan(s.indexOf("storage buckets add-iam-policy-binding"));
});

it("downloads é opt-in no provisionamento e chaves antigas barram antes de grants", () => {
  const principal = readFileSync("infra/gcp/provisionar.sh", "utf8");
  expect(principal).toMatch(/if \[\[ "\$\{PROVISIONAR_DOWNLOADS:-0\}" == 1 \]\]; then\n[^]*?source \.\/provisionar-downloads.sh\nfi/);
  const dedicado = readFileSync("infra/gcp/provisionar-downloads.sh", "utf8");
  expect(dedicado.indexOf('[[ -z "$CHAVES" ]]')).toBeLessThan(dedicado.indexOf("storage buckets add-iam-policy-binding"));
});

it("uma chave antiga reprova sem conceder acesso ao bucket (gcloud simulado)", async () => {
  const { mkdtemp, writeFile, chmod, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "nod-downloads-iam-"));
  try {
    const gh = join(dir, "gh"), gc = join(dir, "gcloud"), log = join(dir, "calls");
    await writeFile(gh, "#!/bin/sh\necho 123\n");
    await writeFile(gc, `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *"providers describe"*) echo "assertion.repository_id == '123' && assertion.ref == 'refs/heads/main' && assertion.environment == 'producao'";;
  *"buckets describe"*) echo 456;;
  *"keys list"*) echo chave-antiga;;
esac
`);
    await chmod(gh, 0o700); await chmod(gc, 0o700);
    const r = spawnSync("bash", ["infra/gcp/provisionar-downloads.sh"], { encoding: "utf8", timeout: 5000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GCLOUD: gc, CALLS: log, PROJETO: "exemplo", NUMERO: "456", GITHUB_REPO: "marlonwlv/nod", BUCKET_DOWNLOADS: "downloads-exemplo" } });
    expect(r.status).toBe(1); expect(r.stderr).toContain("chave gerenciada");
    expect(await readFile(log, "utf8")).not.toContain("add-iam-policy-binding");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 15_000);

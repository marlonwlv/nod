import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUA_DRIVER_PACOTES, CUA_DRIVER_URL_BASE, CUA_DRIVER_VERSAO } from "../../contracts/seu-computador.ts";
import type { PlataformaPessoa } from "../../domain/seu-computador.ts";
import { programaDoSistema } from "../executor/plataforma.ts";

/**
 * Onde está o cua-driver desta máquina (ADR-197, item 2). No app do Mac ele vem dentro do .app (Resources/cua-driver,
 * assinado e notarizado com o resto); no Windows (e no Mac antigo, sem o binário no pacote) o motor/app baixa o pacote
 * oficial da versão fixa do GitHub da trycua, confere o sha256 e extrai numa pasta do nod. Nunca roda o instalador
 * oficial (no Windows ele cria uma tarefa de logon elevada).
 */

const executar = (bin: string, args: readonly string[], prazoMs: number) => new Promise<void>((resolver, rejeitar) => {
  execFile(bin, [...args], { timeout: prazoMs, windowsHide: true }, (e) => (e ? rejeitar(e) : resolver()));
});

/** O nome do executável dentro do pacote. */
export const nomeDoExecutavel = (plataforma: PlataformaPessoa) => (plataforma === "win32" ? "cua-driver.exe" : "cua-driver");

/** O binário que veio no app do Mac (`process.resourcesPath/cua-driver/cua-driver`), se existir. */
export function binarioNoApp(resources: string | undefined, existe: (p: string) => boolean = existsSync): string | null {
  if (!resources) return null;
  const p = join(resources, "cua-driver", "cua-driver");
  return existe(p) ? p : null;
}

/**
 * Baixa (se faltar) e roda `--version` uma vez, em segundo plano, ao ligar o motor: no Windows a 1ª execução de um .exe
 * novo passa pela varredura do antivírus (11–16 s na CI), e assim a primeira ação do bot não paga isso.
 */
export function aquecerDriver(obter: () => Promise<string | null>): void {
  void obter().then((exe) => (exe ? executar(exe, ["--version"], 60_000) : undefined)).catch(() => undefined);
}

export type OpcoesBaixar = {
  plataforma: PlataformaPessoa;
  /** Pasta do nod onde o pacote fica (`<pasta>/cua-driver-<versão>/`). */
  pasta: string;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
};

/**
 * O binário baixado (uma vez): `<pasta>/cua-driver-<versão>/cua-driver[.exe]`. Pacote com hash diferente do fixado não
 * é extraído. Concorrência: duas chamadas juntas dividem o mesmo download.
 */
export function baixadorDoDriver(o: OpcoesBaixar): () => Promise<string | null> {
  let emCurso: Promise<string | null> | null = null;
  const destino = join(o.pasta, `cua-driver-${CUA_DRIVER_VERSAO}`);
  const exe = join(destino, nomeDoExecutavel(o.plataforma));
  return () => {
    if (existsSync(exe)) return Promise.resolve(exe);
    emCurso ??= baixar().catch(() => null).finally(() => { emCurso = null; });
    return emCurso;
  };

  async function baixar(): Promise<string | null> {
    const pacote = o.plataforma === "win32" ? CUA_DRIVER_PACOTES["windows-x64"] : CUA_DRIVER_PACOTES["darwin-universal"];
    const r = await (o.fetchImpl ?? fetch)(CUA_DRIVER_URL_BASE + pacote.arquivo, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
    if (!r.ok) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== pacote.sha256) return null;
    mkdirSync(o.pasta, { recursive: true });
    const temp = `${destino}.parcial`;
    rmSync(temp, { recursive: true, force: true });
    mkdirSync(temp, { recursive: true });
    const arquivo = join(temp, pacote.arquivo);
    writeFileSync(arquivo, bytes);
    // bsdtar extrai .tar.gz e .zip (o tar.exe vem no Windows 10+).
    const tar = o.plataforma === "win32" ? programaDoSistema("tar", o.env ?? process.env) : "/usr/bin/tar";
    await executar(tar, ["-xf", arquivo, "-C", temp], 120_000);
    rmSync(arquivo, { force: true });
    if (!existsSync(join(temp, nomeDoExecutavel(o.plataforma)))) { rmSync(temp, { recursive: true, force: true }); return null; }
    if (o.plataforma !== "win32") chmodSync(join(temp, "cua-driver"), 0o755);
    rmSync(destino, { recursive: true, force: true });
    renameSync(temp, destino);
    return exe;
  }
}

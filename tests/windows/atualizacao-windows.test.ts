import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { comandoSolto, dispararSolto, MARCA_ATUALIZANDO } from "../../motor/atualizacao-no-windows.ts";

/**
 * #358 (QA da rc.13 no Windows): o disparo da troca do motor no Windows de verdade. O bug: com `spawn(..., { detached:
 * true })` o PowerShell externo nascia sem console e o `Start-Process` dele não subia o interno — a marca e o log nunca
 * apareciam, e os testes unitários (que só conferiam o texto do comando) passavam. Aqui o script roda de verdade e grava
 * um arquivo, inclusive depois que o processo que disparou morre (o motor é derrubado pelo `taskkill /T` do script, ou
 * sai logo depois de pedir, no `sairPorVersao`). Fora do Windows o arquivo inteiro pula.
 */
vi.setConfig({ testTimeout: 90_000 });
const noWindows = process.platform === "win32";
const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
const pasta = mkdtempSync(join(tmpdir(), "nod-troca-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
const aspas = (t: string) => `'${t.replace(/'/g, "''")}'`;
const esperarAte = async (cond: () => boolean, ms = 45_000) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 100));
  return cond();
};
const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const MODULO = pathToFileURL(join(import.meta.dirname, "../../motor/atualizacao-no-windows.ts")).href;

/** Um "motor" de mentira: dispara pelo dispararSolto real e, conforme o modo, fica vivo (até o script o derrubar) ou sai. */
function motorDeMentira(script: string, modo: "fica" | "sai", env: NodeJS.ProcessEnv = process.env) {
  const arquivo = join(pasta, `motor-${modo}-${Date.now()}.mjs`);
  writeFileSync(arquivo, [
    `import { comandoSolto, dispararSolto } from ${JSON.stringify(MODULO)};`,
    `const script = ${JSON.stringify(script)}.replaceAll("__PID__", String(process.pid));`,
    `const d = await dispararSolto(comandoSolto(script, ${JSON.stringify(SYSTEM_ROOT)}));`,
    "process.stdout.write(JSON.stringify(d) + '\\n');",
    modo === "sai" ? "process.exit(2);" : "setInterval(() => {}, 1000);",
  ].join("\n"));
  const p = spawn(process.execPath, [arquivo], { env, stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  let saida = "";
  p.stdout.on("data", (b: Buffer) => { saida += b.toString(); });
  return { p, saida: () => saida };
}

describe.runIf(noWindows)("a troca do motor no Windows de verdade (#358)", () => {
  it("o PowerShell solto roda o script interno (o detached não roda)", async () => {
    const alvo = join(pasta, "direto.txt");
    const d = await dispararSolto(comandoSolto(`Set-Content -LiteralPath ${aspas(alvo)} -Value 'ok'`, SYSTEM_ROOT));
    expect(d).toEqual({ ok: true });
    expect(await esperarAte(() => existsSync(alvo))).toBe(true);
    expect(readFileSync(alvo, "utf8").trim()).toBe("ok");
  });

  it("o script sobrevive ao taskkill /T do motor que o disparou (o PararMotor da instalação)", async () => {
    const alvo = join(pasta, "depois-do-taskkill.txt");
    const script = `Start-Sleep 2; taskkill /PID __PID__ /T /F | Out-Null; Start-Sleep 2; Set-Content -LiteralPath ${aspas(alvo)} -Value 'trocou'`;
    const m = motorDeMentira(script, "fica");
    expect(await esperarAte(() => m.saida().includes('{"ok":true}'), 30_000)).toBe(true);
    expect(await esperarAte(() => existsSync(alvo))).toBe(true);
    expect(vivo(m.p.pid!)).toBe(false);
  });

  it("o script sobrevive ao motor que sai logo depois de pedir (sairPorVersao)", async () => {
    const alvo = join(pasta, "depois-da-saida.txt");
    const m = motorDeMentira(`Start-Sleep 3; Set-Content -LiteralPath ${aspas(alvo)} -Value 'trocou'`, "sai");
    const codigo = await new Promise<number | null>((r) => m.p.once("exit", r));
    expect(codigo).toBe(2);
    expect(m.saida()).toContain('{"ok":true}');
    expect(existsSync(alvo)).toBe(false);
    expect(await esperarAte(() => existsSync(alvo))).toBe(true);
  });

  describe("o script da troca inteiro (marca, irm /windows | iex, log) contra um servidor em loopback", () => {
    let servidor: Server;
    let url = "";
    const nod = join(pasta, "nod");
    beforeAll(async () => {
      // O /windows de mentira: espera um pouco (a marca tem de estar lá) e grava `trocou` na pasta do nod.
      servidor = createServer((req, res) => {
        if (req.url !== "/windows") { res.writeHead(404).end(); return; }
        res.writeHead(200, { "content-type": "text/plain" }).end("Write-Output 'instalando'; Start-Sleep 3; Set-Content -LiteralPath (Join-Path $env:NOD_PASTA 'trocou') -Value 'ok'\n");
      });
      await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

    it("o motor que sai depois de pedir: a marca aparece, o log é gravado, o script roda e a marca some no fim", async () => {
      const { scriptDaAtualizacao } = await import("../../motor/atualizacao-no-windows.ts");
      const m = motorDeMentira(scriptDaAtualizacao(url), "sai", { ...process.env, NOD_PASTA: nod });
      expect(await new Promise<number | null>((r) => m.p.once("exit", r))).toBe(2);
      const marca = join(nod, MARCA_ATUALIZANDO);
      expect(await esperarAte(() => existsSync(marca))).toBe(true);
      expect(await esperarAte(() => existsSync(join(nod, "trocou")) && !existsSync(marca))).toBe(true);
      // O log é UTF-16 (o `*>` do Windows PowerShell 5.1).
      const log = readFileSync(join(nod, "atualizacao-motor.log"));
      expect(log.toString("utf16le").includes("instalando") || log.toString("utf8").includes("instalando")).toBe(true);
    });
  });
});

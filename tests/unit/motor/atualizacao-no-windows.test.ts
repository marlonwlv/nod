import { createHash } from "node:crypto";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_PARADO, appDeveAtualizar, arquivoDaMarca, atualizandoAgora, CARENCIA_DO_APP_MS, codificar, comandoDeAtualizarSolto, manifestoDoWindows,
  marcaValida, motorDoWindowsDiferente, scriptDaAtualizacao, VALIDADE_DA_MARCA_MS,
} from "../../../motor/atualizacao-no-windows.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const MIN = 60_000;

describe("o motor do Windows se atualiza sozinho (2026-11-25)", () => {
  it("o script roda a instalação do servidor com log, grava a marca e a apaga no fim; caminho do usuário nunca entra no texto", () => {
    const s = scriptDaAtualizacao("https://app.nodbot.ai");
    expect(s).toContain("irm 'https://app.nodbot.ai/windows' | iex");
    expect(s).toContain("atualizacao-motor.log");
    expect(s).toContain("'atualizando-motor'");
    expect(s).toMatch(/try \{.*\} finally \{ Remove-Item -LiteralPath \$marca/);
    expect(s).toContain("$env:LOCALAPPDATA");
  });

  it("recusa servidor que quebraria as aspas do PowerShell", () => {
    for (const ruim of ["https://x'; calc; '", "http://exemplo.com", "https://a b", "file:///c"]) expect(() => scriptDaAtualizacao(ruim)).toThrow("servidor_invalido");
    expect(() => scriptDaAtualizacao("http://127.0.0.1:4100")).not.toThrow();
  });

  it("o comando abre um PowerShell que solta outro (Start-Process) com o script codificado, fora da árvore do motor", () => {
    const c = comandoDeAtualizarSolto("https://app.nodbot.ai", "C:\\Windows");
    expect(c.arquivo).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(c.args).toContain("-WindowStyle");
    const cmd = c.args.at(-1)!;
    expect(cmd).toMatch(/^Start-Process -FilePath 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe' -WindowStyle Hidden -ArgumentList /);
    const b64 = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(cmd)![1]!;
    expect(b64).toBe(codificar(scriptDaAtualizacao("https://app.nodbot.ai")));
    expect(Buffer.from(b64, "base64").toString("utf16le")).toBe(scriptDaAtualizacao("https://app.nodbot.ai"));
  });

  it("a marca vale por VALIDADE_DA_MARCA_MS; sem arquivo, não há troca em curso", async () => {
    expect(marcaValida(null, 0)).toBe(false);
    expect(marcaValida(0, VALIDADE_DA_MARCA_MS - 1)).toBe(true);
    expect(marcaValida(0, VALIDADE_DA_MARCA_MS)).toBe(false);
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const env = { NOD_PASTA: pasta };
    expect(await atualizandoAgora(env)).toBe(false);
    await writeFile(arquivoDaMarca(env), "x");
    expect(await atualizandoAgora(env)).toBe(true);
    const velha = (Date.now() - VALIDADE_DA_MARCA_MS - MIN) / 1000;
    await utimes(arquivoDaMarca(env), velha, velha);
    expect(await atualizandoAgora(env)).toBe(false);
  });

  it("o manifesto do Windows deixa de fora o computador (não roda no Windows, #337)", () => {
    expect(manifestoDoWindows({ "nod-motor.mjs": "1", "proxy.mjs": "2", "hook-nativas.mjs": "3", "computador-tela.mjs": "4" })).toEqual({ "nod-motor.mjs": "1", "proxy.mjs": "2", "hook-nativas.mjs": "3" });
  });

  it("compara o motor instalado em <pasta>\\motor\\app com o manifesto; servidor fora = não sabe (null)", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-win-"));
    const app = join(pasta, "motor", "app");
    await mkdir(app, { recursive: true });
    for (const n of ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"]) await writeFile(join(app, n), `// ${n}\n`);
    const manifesto = (motor: string) => async () => new Response(JSON.stringify({ versao: "1", arquivos: { "nod-motor.mjs": sha(motor), "proxy.mjs": sha("// proxy.mjs\n"), "hook-nativas.mjs": sha("// hook-nativas.mjs\n") } }));
    const env = { NOD_PASTA: pasta };
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: manifesto("// nod-motor.mjs\n") as typeof fetch })).toBe(false);
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: manifesto("// novo\n") as typeof fetch })).toBe(true);
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: (async () => new Response("", { status: 404 })) as typeof fetch })).toBe(null);
    expect(await motorDoWindowsDiferente({ servidor: "https://nod", env, buscar: (async () => { throw new Error("fora"); }) as typeof fetch })).toBe(null);
  });

  it("o app atualiza na primeira conferência depois de abrir (o motor antigo da Micherlaine)", () => {
    expect(appDeveAtualizar(APP_PARADO, { agora: 0, diferente: true, atualizando: false }).atualizar).toBe(true);
  });

  it("depois da primeira, o app só entra se o motor seguir diferente além da carência (o motor novo cuida antes)", () => {
    let e = appDeveAtualizar(APP_PARADO, { agora: 0, diferente: false, atualizando: false }).estado;
    let d = appDeveAtualizar(e, { agora: 10 * MIN, diferente: true, atualizando: false });
    expect(d.atualizar).toBe(false);
    e = d.estado;
    d = appDeveAtualizar(e, { agora: 10 * MIN + CARENCIA_DO_APP_MS - 1, diferente: true, atualizando: false });
    expect(d.atualizar).toBe(false);
    d = appDeveAtualizar(d.estado, { agora: 10 * MIN + CARENCIA_DO_APP_MS, diferente: true, atualizando: false });
    expect(d.atualizar).toBe(true);
    expect(d.estado.diferenteDesde).toBe(null);
  });

  it("troca em curso ou servidor sem resposta: o app não dispara", () => {
    expect(appDeveAtualizar(APP_PARADO, { agora: 0, diferente: true, atualizando: true }).atualizar).toBe(false);
    const d = appDeveAtualizar(APP_PARADO, { agora: 0, diferente: null, atualizando: false });
    expect(d).toEqual({ estado: APP_PARADO, atualizar: false });
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CHAVE_DA_EXTENSAO, cookieDaExtensao, criarPonteDoChrome, ID_DA_EXTENSAO, idDaExtensao, lerQuadros, manifestoDoHost, NOME_DO_HOST, quadroNativo, registrarHostNoWindows, rodarHostDoChrome, SEM_EXTENSAO } from "../../../src/adapters/executor/chrome-da-pessoa.ts";

/**
 * 2026-11-23: "Trazer do meu Chrome" no PC pela extensão do nod (native messaging). A prova com o Chrome e a extensão de
 * verdade é tests/windows/navegador-windows.test.ts; aqui, as peças e o caminho host ↔ motor num socket local.
 */
const pastas: string[] = [];
afterEach(() => { for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe("a extensão e o host", () => {
  it("o id vem da chave do manifesto da extensão (o host só aceita esta extensão)", () => {
    const manifesto = JSON.parse(readFileSync(join(process.cwd(), "extensao-chrome", "manifest.json"), "utf8")) as { key: string; permissions: string[] };
    expect(manifesto.key).toBe(CHAVE_DA_EXTENSAO);
    expect(ID_DA_EXTENSAO).toMatch(/^[a-p]{32}$/u);
    expect(idDaExtensao(manifesto.key)).toBe(ID_DA_EXTENSAO);
    // Só o que precisa: ler cookies e falar com o host (o alarme religa o service worker).
    expect(manifesto.permissions.sort()).toEqual(["alarms", "cookies", "nativeMessaging"]);
    expect(manifestoDoHost("C:\\nod\\navegador-host.cmd")).toEqual({ name: NOME_DO_HOST, description: expect.any(String), path: "C:\\nod\\navegador-host.cmd", type: "stdio", allowed_origins: [`chrome-extension://${ID_DA_EXTENSAO}/`] });
  });

  it("o quadro do native messaging: 4 bytes de tamanho e o JSON, em pedaços", () => {
    const dois = Buffer.concat([quadroNativo({ a: 1 }), quadroNativo({ b: "ç" })]);
    const meio = lerQuadros(dois.subarray(0, 7));
    expect(meio.mensagens).toEqual([]);
    const tudo = lerQuadros(Buffer.concat([meio.resto, dois.subarray(7)]));
    expect(tudo.mensagens).toEqual([{ a: 1 }, { b: "ç" }]);
    expect(tudo.resto.length).toBe(0);
  });

  it("o cookie do chrome.cookies vira o da ponte (sameSite, sessão)", () => {
    expect(cookieDaExtensao({ name: "s", value: "v", domain: ".itau.com.br", path: "/", expirationDate: 1_900_000_000.5, secure: true, httpOnly: true, sameSite: "strict" })).toEqual({ name: "s", value: "v", domain: ".itau.com.br", path: "/", expires: 1_900_000_000, secure: true, httpOnly: true, sameSite: "Strict" });
    expect(cookieDaExtensao({ name: "t", value: "", domain: "a.com", sameSite: "no_restriction" })).toMatchObject({ expires: -1, sameSite: "None", path: "/" });
    expect(cookieDaExtensao({ name: "", value: "x", domain: "a.com" })).toBeNull();
  });

  it("o registro no Windows: o .cmd chama o node com o motor, o manifesto aponta para ele e a chave vai em HKCU", async () => {
    const gravados = new Map<string, string>();
    const comandos: (readonly string[])[] = [];
    const manifesto = await registrarHostNoWindows({ pasta: "C:\\Users\\ana\\AppData\\Roaming\\nod-motor", nodeExe: "C:\\nod\\node\\node.exe", motorMjs: "C:\\nod\\motor\\app\\nod-motor.mjs", systemRoot: "C:\\Windows", deps: { gravar: async (c, t) => { gravados.set(c, t); }, executar: async (_b, a) => { comandos.push(a); return { codigo: 0 }; } } });
    expect(gravados.get("C:\\Users\\ana\\AppData\\Roaming\\nod-motor\\navegador-host.cmd")).toBe('@echo off\r\n"C:\\nod\\node\\node.exe" "C:\\nod\\motor\\app\\nod-motor.mjs" navegador-host %*\r\n');
    expect(JSON.parse(gravados.get(manifesto)!)).toMatchObject({ name: NOME_DO_HOST, path: "C:\\Users\\ana\\AppData\\Roaming\\nod-motor\\navegador-host.cmd" });
    expect(comandos[0]).toEqual(["add", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.nod.navegador", "/ve", "/t", "REG_SZ", "/d", manifesto, "/f"]);
  });
});

describe("o motor pede, o host repassa, a extensão responde (socket local no lugar do pipe)", () => {
  it("com a senha certa, os cookies do site chegam; sem a extensão ligada, o recado de instalar", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "nod-ponte-"));
    pastas.push(pasta);
    const pipe = join(pasta, "p.sock");
    const ponte = await criarPonteDoChrome({ pipe, senha: "a".repeat(64) });
    try {
      await expect(ponte.cookies("itau.com.br")).rejects.toMatchObject({ motivo: "indisponivel", detalhe: SEM_EXTENSAO });
      // A "extensão": lê os quadros que o host escreve no stdout e responde no stdin dele.
      const daExtensao = new PassThrough();
      const paraExtensao = new PassThrough();
      let acumulado: Buffer = Buffer.alloc(0);
      paraExtensao.on("data", (b: Buffer) => {
        acumulado = Buffer.concat([acumulado, b]);
        const r = lerQuadros(acumulado);
        acumulado = r.resto;
        for (const m of r.mensagens as { tipo: string; id: number; host: string }[]) {
          if (m.tipo === "cookies") daExtensao.write(quadroNativo({ tipo: "cookies", id: m.id, cookies: [{ name: "sessao", value: `de-${m.host}`, domain: `.${m.host}`, path: "/", secure: true, httpOnly: true, sameSite: "lax" }] }));
        }
      });
      const host = rodarHostDoChrome({ pipe, senha: "a".repeat(64), entrada: daExtensao, saida: paraExtensao });
      for (let i = 0; i < 50 && !ponte.conectada(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(ponte.conectada()).toBe(true);
      expect(await ponte.cookies("itau.com.br")).toEqual([{ name: "sessao", value: "de-itau.com.br", domain: ".itau.com.br", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }]);
      daExtensao.end();
      expect(await host).toBe(0);
    } finally {
      await ponte.fechar();
    }
  });

  it("senha errada: o motor fecha a conexão e a extensão não conta como ligada", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "nod-ponte-"));
    pastas.push(pasta);
    const pipe = join(pasta, "p.sock");
    const ponte = await criarPonteDoChrome({ pipe, senha: "a".repeat(64) });
    try {
      const entrada = new PassThrough();
      const host = rodarHostDoChrome({ pipe, senha: "b".repeat(64), entrada, saida: new PassThrough() });
      expect(await host).toBe(0);
      expect(ponte.conectada()).toBe(false);
      entrada.end();
    } finally {
      await ponte.fechar();
    }
  });
});

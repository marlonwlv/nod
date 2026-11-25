import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { criarMotorAgentBrowser } from "../../../src/adapters/navegador/motor-agent-browser.ts";

/**
 * Fumaça do motor de verdade (ADR-190): sobe o agent-browser, abre example.com, lê, clica e fecha. Pulado sem
 * NOD_NAVEGADOR_FUMACA=1 (sobe Chrome e precisa de rede); rode sozinho, nunca junto da suíte.
 * Chrome: NOD_NAVEGADOR_CHROME, ou o Chrome for Testing do Playwright no Mac, ou o que o agent-browser achar.
 */
// medido em 2026-11-20: 3,6 s no Mac (o teste inteiro, Chrome for Testing 156 frio); o prazo cobre o Mac sob carga.
vi.setConfig({ testTimeout: 120_000 });

const LIGADO = process.env.NOD_NAVEGADOR_FUMACA === "1";
const PLAYWRIGHT = join(homedir(), "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const chrome = process.env.NOD_NAVEGADOR_CHROME ?? (existsSync(PLAYWRIGHT) ? PLAYWRIGHT : null);
const s = { agenteId: "00000000-0000-4000-8000-0000000000f1" };
let dados: string | null = null;
let fechar: (() => Promise<void>) | null = null;

afterAll(async () => {
  await fechar?.();
  if (dados) await rm(dados, { recursive: true, force: true });
});

it.skipIf(!LIGADO)("abre example.com, lê, clica no link e fecha o Chrome", async () => {
  dados = await mkdtemp(join(tmpdir(), "nod-navegador-fumaca-"));
  const m = criarMotorAgentBrowser({ dados, segredo: Buffer.alloc(32, 1), chrome, ociosoMs: 60_000 });
  fechar = () => m.fechar(s);
  const aberto = await m.abrir(s, "https://example.com");
  expect(aberto.titulo).toBe("Example Domain");
  const l = await m.ler(s);
  const link = Object.entries(l.refs).find(([, r]) => r.papel === "link");
  expect(link?.[1].nome).toMatch(/more/i);
  const print = await m.print(s);
  expect(Buffer.from(print.jpeg, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(await m.portaDoStream(s)).toEqual(expect.any(Number));
  await m.clicar(s, link![0]);
  await m.esperar(s, { ms: 500 });
  expect(await m.url(s)).not.toBe("https://example.com/");
  expect((await m.abas(s)).length).toBeGreaterThanOrEqual(1);
  await m.fechar(s);
  fechar = null;
});

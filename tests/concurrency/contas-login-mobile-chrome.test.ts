import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { ContaIa, ContasIaDto, LoginNaMaquina } from "../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { renderListaDeContas, UI_CONTAS_INICIAL } from "../../web/telas/contas-lista.ts";

/** QA de 2026-11-17: o login de uma conta de IA usa os estilos reais em Chromium a 320 px. */
const chrome = (() => { try { return acharChrome(); } catch { return null; } })();
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("o CI precisa do Chromium para conferir o login de IA no celular");
const descrever = chrome ? describe : describe.skip;
const VM = "11111111-1111-4111-8111-111111111111";
const LOGIN = "33333333-3333-4333-8333-333333333333";
const maquina: MaquinaDto = { id: VM, nome: "vm-qa", prefixo: "qa", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false, atualizaIas: true };
const conta: ContaIa = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", ia: "claude-cli", impressao: "a".repeat(64), apelido: "Pessoal 👩🏽‍💻", email: "pessoa@exemplo.com",
  organizacao: null, plano: "Max", corporativa: false, posicao: 1, entraNaTrocaAutomatica: true, noLimiteAte: null,
  maquinas: [{ maquinaId: VM, nome: maquina.nome, estado: "pronta" }],
};
const contas: ContasIaDto = { disponivel: true, modo: "perguntar", contas: [conta] };
const login = (o: Partial<LoginNaMaquina> = {}): LoginNaMaquina => ({
  id: LOGIN, maquinaId: VM, ia: "claude-cli", contaId: conta.id, apelido: null, fase: "aguardando_pessoa",
  url: "https://claude.com/cai/oauth/authorize", codigoDispositivo: null, pedeCodigo: true, chavePublica: "QUJD",
  codigoEnviado: false, erro: null, contaFinalId: null, criadoEm: 1, atualizadoEm: 1, ...o,
});
const tela = (l: LoginNaMaquina, extra: { codigo?: string; erroEnvio?: string | null; terminal?: string | null } = {}) => renderListaDeContas({
  contas, maquinas: [maquina], detalhes: null, agora: Date.now(), noApp: false, botsNaMaquina: () => ["Ada"], cartaoDoMac: () => "",
  ui: { ...UI_CONTAS_INICIAL, terminal: extra.terminal ?? null, logins: [{ onde: "vm", login: l, codigo: extra.codigo ?? "", enviando: false, erroEnvio: extra.erroEnvio ?? null }] },
});

descrever("Login de conta de IA no celular (Chrome real, 320×568)", () => {
  let cdp: Cdp;
  let processoChrome: ChildProcess;
  let perfil: string;

  beforeAll(async () => {
    perfil = mkdtempSync(join(tmpdir(), "nod-login-conta-cel-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp, chrome: processoChrome } = await abrirChrome(9950 + (process.pid % 40), perfil));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
    const estilos = [...readFileSync("web/index.html", "utf8").matchAll(/href="\/([^"]+\.css)"/g)].map((m) => `web/${m[1]}`).filter(existsSync);
    const css = estilos.map((p) => readFileSync(p, "utf8")).join("\n");
    await avaliar(cdp, `document.open();document.write(${JSON.stringify(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main id="app" class="espaco-corpo"></main>`)});document.close()`);
  }, 30_000);

  afterAll(async () => {
    const saiu = processoChrome?.exitCode === null && processoChrome.signalCode === null
      ? new Promise<void>((ok) => processoChrome.once("exit", () => ok()))
      : Promise.resolve();
    cdp?.fechar();
    await saiu;
    if (perfil) rmSync(perfil, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  });

  it("mantém as ações de código e recuperação com 44 px e sem transbordo", async () => {
    const medir = async (html: string) => {
      await avaliar(cdp, `document.querySelector("#app").innerHTML=${JSON.stringify(html)}`);
      return avaliar<{ texto: string; largura: number; altura: number }[]>(cdp, `[...document.querySelectorAll(".cl-login button,.cl-login a,.cl-login input,.cl-terminal-link")].filter((el)=>el.getClientRects().length).map((el)=>{const r=el.getBoundingClientRect();return {texto:(el.textContent||el.getAttribute("placeholder")||"").trim(),largura:r.width,altura:r.height}})`);
    };
    const codigo = await medir(tela(login(), { codigo: "código da página" }));
    const falha = await medir(tela(login({ fase: "falhou", erro: "codigo_invalido" })));
    const pequenos = [...codigo, ...falha].filter((m) => m.largura < 44 || m.altura < 44);
    expect(await avaliar<number>(cdp, "document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
    expect(pequenos).toEqual([]);
  });
});

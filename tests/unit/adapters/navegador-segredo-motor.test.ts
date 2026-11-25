import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarMotorAgentBrowser, JS_CAMPOS_LOGIN, nomeDaSessao, SELETOR_CAMPO, SESSAO_IDENTIDADE, type ExecutorProcesso } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { inserirCodigo, preencherLogin } from "../../../src/adapters/navegador/preencher-login.ts";

/**
 * O segredo no motor do agent-browser (ADR-190, L3): a senha, o código e os cookies vão pelo relay do daemon (corpo de um
 * POST local), nunca pelo argv de um processo. O executor e o relay são falsos: o teste junta o argv de TODOS os processos
 * e confere que o segredo não está lá, e que está, inteiro, no relay.
 */
const A = "00000000-0000-4000-8000-00000000000a";
const SENHA = "S3nh@-que-nao-vaza";
const vida = { lifecycle: { launched: false, reused: true } };
const ok = (data: Record<string, unknown>) => JSON.stringify({ success: true, data: { ...vida, ...data }, error: null });

let dados: string;
let argvs: string[][];
let relays: { porta: number; comando: Record<string, unknown> }[];
let relayResponde: boolean;
let campos: Record<string, boolean>;

const executor: ExecutorProcesso = async (p) => {
  // A pergunta da identidade do Chrome (uma sessão à parte, uma vez por motor) não é comando do bot.
  if (p.args.includes(nomeDaSessao(SESSAO_IDENTIDADE))) return { codigo: 0, saida: ok({}), erro: "", estourou: false };
  argvs.push([...p.args]);
  const [cmd, sub] = p.args;
  if (cmd === "stream" && sub === "status") return { codigo: 0, saida: ok({ enabled: true, port: 51234 }), erro: "", estourou: false };
  if (cmd === "eval") return { codigo: 0, saida: ok({ result: campos }), erro: "", estourou: false };
  return { codigo: 0, saida: ok({}), erro: "", estourou: false };
};
const motor = () => criarMotorAgentBrowser({ dados, segredo: Buffer.alloc(32, 1), binario: "/bin/agent-browser-falso", executor, relay: async (porta, comando) => { relays.push({ porta, comando: { ...comando } }); return relayResponde; } });
const s = { agenteId: A };

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), "nod-segredo-"));
  argvs = [];
  relays = [];
  relayResponde = true;
  campos = { usuario: true, senha: true, codigo: false };
});
afterEach(async () => { await rm(dados, { recursive: true, force: true }); });

describe("o segredo vai pelo relay, nunca pelo argv", () => {
  it("preencher um login: o usuário por fill, a senha focada e digitada pelo relay (medido: focus + insertText)", async () => {
    expect(await preencherLogin(motor(), s, { usuario: "ana@x.com", senha: SENHA })).toEqual({ usuario: true, senha: true });
    expect(argvs.flat().join(" ")).not.toContain(SENHA);
    expect(argvs.find((a) => a[0] === "eval")?.[2]).toBe(Buffer.from(JS_CAMPOS_LOGIN, "utf8").toString("base64"));
    expect(argvs.filter((a) => a[0] === "fill").map((a) => a.slice(1, 3))).toEqual([[SELETOR_CAMPO.usuario, "ana@x.com"], [SELETOR_CAMPO.senha, ""]]);
    expect(relays).toEqual([
      { porta: 51234, comando: { action: "focus", selector: SELETOR_CAMPO.senha } },
      { porta: 51234, comando: { action: "keyboard", subaction: "insertText", text: SENHA } },
    ]);
  });

  it("o código vai ao campo de código, ou ao focado; o relay que recusa vira falha (nunca 'preenchi')", async () => {
    campos = { usuario: false, senha: false, codigo: true };
    await inserirCodigo(motor(), s, "918273");
    expect(relays.map((r) => r.comando)).toEqual([{ action: "focus", selector: SELETOR_CAMPO.codigo }, { action: "keyboard", subaction: "insertText", text: "918273" }]);
    relays = [];
    campos = { usuario: false, senha: false, codigo: false };
    await inserirCodigo(motor(), s, "111222");
    expect(relays.map((r) => r.comando)).toEqual([{ action: "keyboard", subaction: "insertText", text: "111222" }]);
    expect(argvs.flat().join(" ")).not.toMatch(/918273|111222/);
    relayResponde = false;
    await expect(motor().inserirTexto(s, SELETOR_CAMPO.senha, SENHA)).rejects.toMatchObject({ motivo: "alvo_invalido" });
  });

  it("sem campo de login na página, nada é digitado", async () => {
    campos = { usuario: false, senha: false, codigo: false };
    await expect(preencherLogin(motor(), s, { usuario: "a", senha: SENHA })).rejects.toMatchObject({ motivo: "alvo_invalido" });
    expect(relays).toEqual([]);
  });

  it("os cookies do Chrome entram pelo relay (cookies_set, medido em 2026-11-20), com os atributos", async () => {
    const c = { name: "sessao", value: "valor-secreto", domain: ".itau.com.br", path: "/", expires: 2_000_000_000, secure: true, httpOnly: true, sameSite: "Lax" as const };
    await motor().definirCookies(s, [c]);
    expect(relays).toEqual([{ porta: 51234, comando: { action: "cookies_set", cookies: [c] } }]);
    expect(argvs.flat().join(" ")).not.toContain("valor-secreto");
    await motor().definirCookies(s, []);
    expect(relays).toHaveLength(1);
  });
});

/**
 * QA-209 (r208): o daemon do agent-browser nasce com o stream ligado num WebSocket de 127.0.0.1 sem token, que aceita
 * qualquer Origin de loopback (o relay só confere o cabeçalho Origin, que um processo forja). Medido no Chromium real: com
 * o stream ligado, um processo local ouvia o `insertText` da senha e rodava `evaluate` pelo relay. O motor desliga o
 * stream do daemon novo e só o liga durante o relay e a vista ao vivo.
 */
describe("QA-209: o stream só fica ligado enquanto alguém precisa dele", () => {
  let ligado: boolean;
  let novo: boolean;
  const exec: ExecutorProcesso = async (p) => {
    if (p.args.includes(nomeDaSessao(SESSAO_IDENTIDADE))) return { codigo: 0, saida: ok({}), erro: "", estourou: false };
    argvs.push([...p.args]);
    const vidaAgora = { lifecycle: { launched: novo, reused: !novo } };
    novo = false;
    const resp = (data: Record<string, unknown>) => ({ codigo: 0, saida: JSON.stringify({ success: true, data: { ...vidaAgora, ...data }, error: null }), erro: "", estourou: false });
    const [cmd, sub] = p.args;
    if (cmd === "stream" && sub === "status") return resp(ligado ? { enabled: true, port: 51234 } : { enabled: false, port: null });
    if (cmd === "stream" && sub === "enable") { ligado = true; return resp({}); }
    if (cmd === "stream" && sub === "disable") { ligado = false; return resp({ disabled: true }); }
    if (cmd === "eval") return resp({ result: campos });
    return resp({ url: "https://banco.example/login", title: "Login" });
  };
  const m = () => criarMotorAgentBrowser({ dados, segredo: Buffer.alloc(32, 1), binario: "/bin/agent-browser-falso", executor: exec, relay: async (porta, comando) => { relays.push({ porta, comando: { ...comando } }); expect(ligado).toBe(true); return relayResponde; } });
  beforeEach(() => { ligado = true; novo = true; });

  it("o daemon que acabou de subir tem o stream desligado logo no primeiro comando", async () => {
    await m().abrir(s, "https://banco.example/login");
    expect(argvs.map((a) => a.slice(0, 2).join(" "))).toEqual(["open https://banco.example/login", "stream disable"]);
    expect(ligado).toBe(false);
    // daemon já de pé: nenhum disable a mais
    await m().url(s);
    expect(argvs.filter((a) => a[1] === "disable")).toHaveLength(1);
  });

  it("o cofre liga o stream só para digitar a senha e desliga no fim, mesmo quando o relay falha", async () => {
    const motor1 = m();
    await motor1.abrir(s, "https://banco.example/login");
    expect(await preencherLogin(motor1, s, { usuario: "ana@x.com", senha: SENHA })).toEqual({ usuario: true, senha: true });
    expect(relays.map((r) => r.comando.action)).toEqual(["focus", "keyboard"]);
    expect(ligado).toBe(false);
    relayResponde = false;
    await expect(motor1.inserirTexto(s, SELETOR_CAMPO.senha, SENHA)).rejects.toMatchObject({ motivo: "alvo_invalido" });
    expect(ligado).toBe(false);
    relayResponde = true;
    await motor1.definirCookies(s, [{ name: "s", value: "v", domain: ".banco.example", path: "/", expires: 2_000_000_000, secure: true, httpOnly: true, sameSite: "Lax" }]);
    expect(ligado).toBe(false);
  });

  it("com a vista ao vivo aberta (stream já ligado), o cofre não desliga o stream de quem assiste", async () => {
    const motor1 = m();
    await motor1.abrir(s, "https://banco.example/login");
    expect(await motor1.portaDoStream(s)).toBe(51234);
    await motor1.inserirTexto(s, SELETOR_CAMPO.senha, SENHA);
    expect(ligado).toBe(true);
    expect(argvs.filter((a) => a[1] === "disable")).toHaveLength(1);
  });
});

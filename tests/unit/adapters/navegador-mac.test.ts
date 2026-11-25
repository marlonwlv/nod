import { afterEach, describe, expect, it } from "vitest";
import { iniciarNavegadorDaMaquina, lerComandoNavegador, type CanalNavegadorDaMaquina, type NavegadorDaMaquina, type RecursosDoMac } from "../../../src/adapters/executor/navegador.ts";
import { criarCanalNavegador } from "../../../src/adapters/navegador/canal-maquina.ts";
import { criarMacDaPessoa, lerOpcoesDoMac } from "../../../src/adapters/navegador/mac-da-pessoa.ts";
import { FalhaNavegador, type MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";

/**
 * O Mac da pessoa para o navegador do bot (ADR-177, ADR-190 L e A1), de ponta a ponta na fila: o servidor pede pelo
 * `criarMacDaPessoa`, a máquina puxa e atende com um cofre e um motor falsos. O segredo do `preencher` não volta ao
 * servidor; o do `ler` volta só na resposta.
 */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };
const MAQ = "00000000-0000-4000-8000-0000000000c1";
const BOT = "00000000-0000-4000-8000-0000000000d1";
const ID = "00000000-0000-4000-8000-0000000000e1";
const SENHA = "senha-do-cofre";
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

let laco: NavegadorDaMaquina | null = null;
afterEach(() => { laco?.parar(); laco = null; });

function montar(o: { plataforma?: "darwin" | "linux"; mac?: RecursosDoMac | null } = {}) {
  const canal = criarCanalNavegador({ agora: Date.now });
  const doMotor: { op: string; args: unknown[] }[] = [];
  const respostas: unknown[] = [];
  const motor = new Proxy({} as MotorNavegador, {
    get: (_t, op: string) => op === "then" ? undefined : async (...args: unknown[]) => { doMotor.push({ op, args: args.slice(1) }); return op === "camposDeLogin" ? { usuario: true, senha: true, codigo: false } : undefined; },
  });
  const daMaquina: CanalNavegadorDaMaquina = {
    puxar: async () => { canal.presenca(ESCOPO, MAQ, { plataforma: o.plataforma ?? "darwin", nome: "Mac" }); await esperar(2); return canal.puxar(ESCOPO, MAQ); },
    resultado: async (r) => { respostas.push(r); return canal.resultado(ESCOPO, MAQ, r); },
    vivo: async () => null,
  };
  const cofre: { op: string; args: unknown[] }[] = [];
  const macFalso: RecursosDoMac = {
    listar: async (host) => { cofre.push({ op: "listar", args: [host] }); return [{ fonte: "1password", ref: "op://v/i/password", rotulo: "Itaú · ana@…", disponivel: true }]; },
    ler: async (...a) => { cofre.push({ op: "ler", args: a }); return { usuario: "ana@x.com", senha: SENHA }; },
    guardar: async (...a) => { cofre.push({ op: "guardar", args: a.slice(0, 3) }); },
    cookiesDoChrome: async (host) => { cofre.push({ op: "chrome", args: [host] }); return [{ name: "s", value: "v", domain: ".itau.com.br", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }]; },
    touchId: async (motivo) => { cofre.push({ op: "touchId", args: [motivo] }); return motivo.includes("sim"); },
  };
  laco = iniciarNavegadorDaMaquina({ canal: daMaquina, motor: async () => motor, ...(o.mac === null ? {} : { mac: o.mac ?? macFalso }), dormir: async (ms) => { await esperar(Math.min(ms, 5)); } });
  return { canal, mac: criarMacDaPessoa({ canal }), doMotor, cofre, respostas };
}

describe("os comandos do Mac na fila", () => {
  it("a máquina confere a forma: host, fonte e referência; senha vazia ou host estranho não passam", () => {
    const base = { id: ID, agenteId: BOT, prazoEm: 1 };
    expect(lerComandoNavegador({ ...base, tipo: "cofre", pedido: { operacao: "listar", host: "www.itau.com.br" } })).toMatchObject({ tipo: "cofre" });
    expect(lerComandoNavegador({ ...base, tipo: "cofre", pedido: { operacao: "listar", host: "itau.com.br; rm -rf" } })).toBeNull();
    expect(lerComandoNavegador({ ...base, tipo: "cofre", pedido: { operacao: "ler", fonte: "nod", ref: "x", host: "a.com" } })).toBeNull();
    expect(lerComandoNavegador({ ...base, tipo: "cofre", pedido: { operacao: "guardar", fonte: "bitwarden", site: "a.com", usuario: "u", senha: "" } })).toBeNull();
    expect(lerComandoNavegador({ ...base, tipo: "chrome", host: "a.com", aplicar: "sim" })).toMatchObject({ tipo: "chrome", aplicar: false });
    expect(lerComandoNavegador({ ...base, tipo: "touch_id", motivo: "" })).toBeNull();
  });

  it("o servidor só vê o Mac (darwin) e lê as opções conferidas", () => {
    expect(lerOpcoesDoMac({ opcoes: [{ fonte: "nod", ref: "x" }, { fonte: "bitwarden", ref: "a\u0000b" }, { fonte: "1password", ref: "op://v/i/password", rotulo: "Itaú" }, { fonte: "bitwarden", ref: "", disponivel: false }] }))
      .toEqual([{ fonte: "1password", ref: "op://v/i/password", rotulo: "Itaú", disponivel: true }, { fonte: "bitwarden", ref: "", rotulo: "Bitwarden", disponivel: false, motivoIndisponivel: "destravar no seu Mac" }]);
  });

  it("listar, preencher no próprio Mac (a senha não volta), ler (volta só na resposta) e guardar", async () => {
    const m = montar();
    await esperar(10);
    expect(m.mac.maquina(ESCOPO)).toBe(MAQ);
    expect(await m.mac.listar(ESCOPO, BOT, "www.itau.com.br")).toEqual([{ fonte: "1password", ref: "op://v/i/password", rotulo: "Itaú · ana@…", disponivel: true }]);
    expect(await m.mac.preencher(ESCOPO, BOT, "1password", "op://v/i/password", "www.itau.com.br")).toEqual({ usuario: true, senha: true });
    expect(m.doMotor.find((c) => c.op === "inserirTexto")?.args).toEqual(['[data-nod-campo="senha"]', SENHA]);
    const doPreencher = m.respostas.at(-1);
    expect(JSON.stringify(doPreencher)).not.toContain(SENHA);
    expect(await m.mac.ler(ESCOPO, BOT, "bitwarden", "item-1", "www.itau.com.br")).toEqual({ usuario: "ana@x.com", senha: SENHA });
    await m.mac.guardar(ESCOPO, BOT, "bitwarden", "itau.com.br", "ana@x.com", "nova");
    expect(m.cofre.map((c) => c.op)).toEqual(["listar", "ler", "ler", "guardar"]);
  });

  it("Chrome: aplicar no Mac define os cookies e recarrega; sem aplicar, os cookies voltam ao servidor", async () => {
    const m = montar();
    await esperar(10);
    expect(await m.mac.cookies(ESCOPO, BOT, "www.itau.com.br", true)).toBe(1);
    expect(m.doMotor.map((c) => c.op)).toEqual(["definirCookies", "historico"]);
    expect(await m.mac.cookies(ESCOPO, BOT, "www.itau.com.br", false)).toEqual([{ name: "s", value: "v", domain: ".itau.com.br", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }]);
  });

  it("Touch ID: confirmado, recusado; sem Mac ligado, 'sem_mac'; numa máquina sem os cofres, indisponível", async () => {
    const m = montar();
    await esperar(10);
    expect(await m.mac.touchId(ESCOPO, BOT, "Pagar sim")).toBe("confirmado");
    expect(await m.mac.touchId(ESCOPO, BOT, "Pagar não")).toBe("recusado");
    expect(m.respostas.at(-1)).toMatchObject({ ok: false, motivo: "recusado" });
    laco?.parar();
    const linux = montar({ plataforma: "linux", mac: null });
    await esperar(10);
    expect(linux.mac.maquina(ESCOPO)).toBeNull();
    expect(await linux.mac.touchId(ESCOPO, BOT, "x")).toBe("sem_mac");
    await expect(linux.mac.ler(ESCOPO, BOT, "1password", "", "a.com")).rejects.toBeInstanceOf(FalhaNavegador);
  });
});

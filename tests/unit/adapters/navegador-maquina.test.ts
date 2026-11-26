import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { iniciarNavegadorDaMaquina, lerComandoNavegador, chromeDoLinux, chromeDoMac, agentBrowserDoLinux, type CanalNavegadorDaMaquina, type NavegadorDaMaquina } from "../../../src/adapters/executor/navegador.ts";
import { criarPonteHttp } from "../../../src/adapters/executor/ponte-http.ts";
import { criarCanalNavegador, PRESENCA_MS } from "../../../src/adapters/navegador/canal-maquina.ts";
import { ehFalhaNavegador, type MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { criarMotorRemoto } from "../../../src/adapters/navegador/motor-remoto.ts";
import { lerValor } from "../../../src/adapters/navegador/operacoes-remotas.ts";
import { criarVivoDaMaquina } from "../../../src/adapters/navegador/vivo-maquina.ts";
import { anexarCanaisVoz } from "../../../src/adapters/voz/ws.ts";
import type { ResultadoComandoNavegador } from "../../../src/contracts/navegador-maquina.ts";

/**
 * O navegador do bot na máquina da pessoa (ADR-190, decisão 5): a fila do servidor, o motor remoto que a usa, a máquina
 * que puxa e executa num motor falso (nunca sobe Chrome) e a vista ao vivo vinda da máquina por WebSocket de verdade
 * (`ws` no servidor, o WebSocket global na máquina), com um stream do agent-browser falso.
 */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };
const OUTRA = { tenantId: ESCOPO.tenantId, pessoaId: "00000000-0000-4000-8000-0000000000b2" };
const MAQ = "00000000-0000-4000-8000-0000000000c1";
const MAQ2 = "00000000-0000-4000-8000-0000000000c2";
const BOT = "00000000-0000-4000-8000-0000000000d1";
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate(fn: () => boolean, ms = 3_000): Promise<void> {
  const fim = Date.now() + ms;
  while (!fn()) { if (Date.now() > fim) throw new Error("tempo esgotado esperando a condição"); await esperar(5); }
}

describe("a fila do navegador por máquina (canal-maquina)", () => {
  it("o comando sai só para a máquina e a pessoa dele, uma vez, e a resposta volta para quem esperava", async () => {
    const canal = criarCanalNavegador({ agora: Date.now });
    canal.presenca(ESCOPO, MAQ, { plataforma: "darwin", nome: "Mac" });
    const resposta = canal.enviar(ESCOPO, MAQ, { tipo: "motor", agenteId: BOT, operacao: "url", args: [] }, 1_000);
    expect(canal.temPara(ESCOPO, MAQ)).toBe(true);
    expect(canal.puxar(OUTRA, MAQ)).toEqual([]);
    expect(canal.puxar(ESCOPO, MAQ2)).toEqual([]);
    const [c] = canal.puxar(ESCOPO, MAQ);
    expect(c).toMatchObject({ tipo: "motor", agenteId: BOT, operacao: "url" });
    expect(canal.puxar(ESCOPO, MAQ)).toEqual([]);
    // Máquina errada ou pessoa errada não resolvem o comando alheio.
    expect(canal.resultado(ESCOPO, MAQ2, { id: c!.id, ok: true, valor: "x" })).toBe(false);
    expect(canal.resultado(OUTRA, MAQ, { id: c!.id, ok: true, valor: "x" })).toBe(false);
    expect(canal.resultado(ESCOPO, MAQ, { id: c!.id, ok: true, valor: "https://exemplo.com/" })).toBe(true);
    expect(await resposta).toEqual({ id: c!.id, ok: true, valor: "https://exemplo.com/" });
    // A segunda resposta do mesmo id é ignorada.
    expect(canal.resultado(ESCOPO, MAQ, { id: c!.id, ok: true })).toBe(false);
  });

  it("máquina sem o navegador ligado responde indisponível na hora; sem resposta até o prazo, tempo esgotado", async () => {
    let agora = 1_000_000;
    const canal = criarCanalNavegador({ agora: () => agora, folgaMs: 5 });
    expect(await canal.enviar(ESCOPO, MAQ, { tipo: "motor", agenteId: BOT, operacao: "url", args: [] }, 50)).toMatchObject({ ok: false, motivo: "indisponivel" });
    canal.presenca(ESCOPO, MAQ, { plataforma: "linux", nome: "vm-sp" });
    expect(canal.ligadas(ESCOPO)).toEqual([{ maquinaId: MAQ, plataforma: "linux", nome: "vm-sp", em: agora, recursos: [] }]);
    expect(canal.ligadas(OUTRA)).toEqual([]);
    expect(await canal.enviar(ESCOPO, MAQ, { tipo: "motor", agenteId: BOT, operacao: "url", args: [] }, 20)).toMatchObject({ ok: false, motivo: "tempo_esgotado" });
    // O comando vencido não sai mais na puxada.
    void canal.enviar(ESCOPO, MAQ, { tipo: "motor", agenteId: BOT, operacao: "url", args: [] }, 10_000);
    agora += 20_000;
    expect(canal.puxar(ESCOPO, MAQ)).toEqual([]);
    agora += PRESENCA_MS;
    expect(canal.ligada(ESCOPO, MAQ)).toBe(false);
  });

  it("a máquina que sai solta quem esperava dela com indisponível", async () => {
    const canal = criarCanalNavegador({ agora: Date.now });
    canal.presenca(ESCOPO, MAQ, { plataforma: "darwin", nome: "Mac" });
    const r = canal.enviar(ESCOPO, MAQ, { tipo: "motor", agenteId: BOT, operacao: "abas", args: [] }, 10_000);
    canal.esquecerMaquina(MAQ);
    expect(await r).toMatchObject({ ok: false, motivo: "indisponivel", detalhe: "a máquina saiu" });
    expect(canal.pendentes()).toEqual([]);
  });
});

describe("o motor remoto (motor-remoto)", () => {
  it("cada chamada vira um comando na fila e a resposta volta com a forma do motor local; a falha vira FalhaNavegador", async () => {
    const canal = criarCanalNavegador({ agora: Date.now });
    canal.presenca(ESCOPO, MAQ, { plataforma: "darwin", nome: "Mac" });
    const m = criarMotorRemoto({ canal, escopo: ESCOPO, maquinaId: MAQ, lugar: { tipo: "mac", nome: "seu Mac" } });
    expect(m.lugar).toEqual({ tipo: "mac", nome: "seu Mac" });
    const lendo = m.ler({ agenteId: BOT }, { soInterativos: true });
    await ate(() => canal.temPara(ESCOPO, MAQ));
    const [c] = canal.puxar(ESCOPO, MAQ);
    expect(c).toMatchObject({ tipo: "motor", operacao: "ler", agenteId: BOT, args: [{ soInterativos: true }] });
    canal.resultado(ESCOPO, MAQ, { id: c!.id, ok: true, valor: { url: "https://a.com/", arvore: "- button [ref=e1]", refs: { e1: { papel: "button", nome: "Ok" }, lixo: { papel: "x" } } } });
    expect(await lendo).toEqual({ url: "https://a.com/", arvore: "- button [ref=e1]", refs: { e1: { papel: "button", nome: "Ok" } } });

    const clicando = m.clicar({ agenteId: BOT }, "@e9");
    await ate(() => canal.temPara(ESCOPO, MAQ));
    const [c2] = canal.puxar(ESCOPO, MAQ);
    canal.resultado(ESCOPO, MAQ, { id: c2!.id, ok: false, motivo: "alvo_invalido", detalhe: "Unknown ref: e9" });
    const e = await clicando.catch((x: unknown) => x);
    expect(ehFalhaNavegador(e) && e.motivo === "alvo_invalido" && e.detalhe === "Unknown ref: e9").toBe(true);
    expect(await m.portaDoStream({ agenteId: BOT })).toBeNull();
  });

  it("o que volta da máquina é conferido: print sem JPEG é falha; abas e caixa ganham a forma do motor", () => {
    expect(() => lerValor("print", { jpeg: "não é imagem" })).toThrow("navegador_acao_falhou");
    expect(lerValor("print", { jpeg: "/9j/AAAA" })).toEqual({ jpeg: "/9j/AAAA" });
    expect(lerValor("abas", [{ id: "t1", titulo: "A", url: "https://a.com/", ativa: true }, { titulo: "sem id" }])).toEqual([{ id: "t1", titulo: "A", url: "https://a.com/", ativa: true }]);
    expect(lerValor("clicar", { qualquer: 1 })).toBeUndefined();
    expect(lerValor("focado", null)).toBeNull();
  });
});

/** Um motor falso: registra as operações e devolve o mínimo de cada uma. */
function motorFalso(o: { porta?: number | null } = {}): { motor: MotorNavegador; ops: { op: string; args: unknown[] }[] } {
  const ops: { op: string; args: unknown[] }[] = [];
  const motor = new Proxy({} as MotorNavegador, {
    get(_t, op: string) {
      if (op === "lugar") return { tipo: "nod" };
      // O motor sai de um `await o.motor()`: sem isto o Proxy viraria um thenable que nunca resolve.
      if (op === "then") return undefined;
      return async (...args: unknown[]) => {
        ops.push({ op, args: args.slice(1) });
        if (op === "abrir") return { url: String(args[1]), titulo: "Página" };
        if (op === "portaDoStream") return o.porta ?? null;
        if (op === "url") return "https://exemplo.com/";
        return undefined;
      };
    },
  });
  return { motor, ops };
}

let paraParar: NavegadorDaMaquina[] = [];
afterEach(() => { for (const n of paraParar) n.parar(); paraParar = []; });

describe("a máquina puxa e executa (iniciarNavegadorDaMaquina)", () => {
  it("roda os comandos conferidos no motor local, em ordem por bot, e responde; o resto é ignorado ou recusado", async () => {
    const { motor, ops } = motorFalso();
    const respostas: ResultadoComandoNavegador[] = [];
    const futuro = Date.now() + 60_000;
    const lote = [
      { id: "00000000-0000-4000-8000-000000000001", agenteId: BOT, prazoEm: futuro, tipo: "motor", operacao: "abrir", args: ["https://exemplo.com/", false] },
      { id: "00000000-0000-4000-8000-000000000002", agenteId: BOT, prazoEm: futuro, tipo: "motor", operacao: "abrir", args: ["file:///etc/passwd"] },
      { id: "00000000-0000-4000-8000-000000000003", agenteId: BOT, prazoEm: futuro, tipo: "motor", operacao: "rm_rf", args: [] },
      { id: "00000000-0000-4000-8000-000000000004", agenteId: BOT, prazoEm: Date.now() - 1, tipo: "motor", operacao: "url", args: [] },
      { id: "00000000-0000-4000-8000-000000000001", agenteId: BOT, prazoEm: futuro, tipo: "motor", operacao: "abrir", args: ["https://exemplo.com/", false] },
      { id: "00000000-0000-4000-8000-000000000005", agenteId: BOT, prazoEm: futuro, tipo: "motor", operacao: "rolar", args: [{ direcao: "baixo", pixels: 300 }] },
    ];
    let puxadas = 0;
    const canal: CanalNavegadorDaMaquina = {
      puxar: async () => { await esperar(5); return puxadas++ === 0 ? lote : []; },
      resultado: async (r) => { respostas.push(r); return true; },
      vivo: async () => null,
    };
    paraParar.push(iniciarNavegadorDaMaquina({ canal, motor: async () => motor }));
    await ate(() => respostas.length >= 3);
    await esperar(30);
    expect(ops.map((o) => o.op)).toEqual(["abrir", "rolar"]);
    expect(ops[1]!.args).toEqual([{ direcao: "baixo", pixels: 300 }]);
    expect(respostas).toEqual([
      { id: "00000000-0000-4000-8000-000000000001", ok: true, valor: { url: "https://exemplo.com/", titulo: "Página" } },
      { id: "00000000-0000-4000-8000-000000000002", ok: false, motivo: "alvo_invalido", detalhe: "argumentos inválidos para abrir" },
      { id: "00000000-0000-4000-8000-000000000005", ok: true },
    ]);
  });

  it("o motor indisponível (Chrome sendo preparado) responde indisponível com a frase; resposta que não subiu vai na volta seguinte", async () => {
    const respostas: ResultadoComandoNavegador[] = [];
    let aceitar = false;
    let puxadas = 0;
    const canal: CanalNavegadorDaMaquina = {
      puxar: async () => { await esperar(5); return puxadas++ === 0 ? [{ id: "00000000-0000-4000-8000-000000000009", agenteId: BOT, prazoEm: Date.now() + 60_000, tipo: "motor", operacao: "url", args: [] }] : []; },
      resultado: async (r) => { if (!aceitar) return false; respostas.push(r); return true; },
      vivo: async () => null,
    };
    const { FalhaNavegador } = await import("../../../src/adapters/navegador/motor-agent-browser.ts");
    paraParar.push(iniciarNavegadorDaMaquina({ canal, motor: async () => { throw new FalhaNavegador("indisponivel", "estou preparando o Chrome nesta máquina pela primeira vez"); } }));
    await esperar(30);
    aceitar = true;
    await ate(() => respostas.length === 1);
    expect(respostas[0]).toMatchObject({ ok: false, motivo: "indisponivel", detalhe: expect.stringContaining("preparando o Chrome") });
  });

  it("servidor sem a rota (404): dorme bem antes de tentar de novo", async () => {
    const sonos: number[] = [];
    let puxadas = 0;
    const canal: CanalNavegadorDaMaquina = { puxar: async () => { puxadas++; return "sem_rota"; }, resultado: async () => true, vivo: async () => null };
    paraParar.push(iniciarNavegadorDaMaquina({ canal, motor: async () => motorFalso().motor, dormir: async (ms) => { sonos.push(ms); await esperar(5); } }));
    await ate(() => sonos.length >= 2);
    expect(sonos[0]).toBe(10 * 60_000);
    expect(puxadas).toBeGreaterThanOrEqual(2);
  });

  it("lerComandoNavegador recusa a forma estranha", () => {
    expect(lerComandoNavegador({ id: "x", agenteId: BOT, prazoEm: 1, tipo: "motor", operacao: "url", args: [] })).toBeNull();
    expect(lerComandoNavegador({ id: "00000000-0000-4000-8000-000000000001", agenteId: BOT, prazoEm: 1, tipo: "assistir", token: "curto" })).toBeNull();
    expect(lerComandoNavegador({ id: "00000000-0000-4000-8000-000000000001", agenteId: BOT, prazoEm: 1, tipo: "motor", operacao: "url", args: new Array(9).fill(0) })).toBeNull();
  });
});

describe("onde a máquina acha o Chrome e o agent-browser", () => {
  it("Mac: o Google Chrome do sistema, senão null (o Chrome for Testing do agent-browser install)", () => {
    expect(chromeDoMac("/Users/p", (c) => c === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(chromeDoMac("/Users/p", (c) => c === "/Users/p/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")).toBe("/Users/p/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(chromeDoMac("/Users/p", () => false)).toBeNull();
  });

  it("Linux: a env, o Chromium do computador (o mais novo), o PATH", () => {
    const existe = (c: string) => ["/opt/chrome", "/opt/nod-motor/chromium/chromium-1200/chrome-linux64/chrome", "/opt/nod-motor/chromium/chromium-1100/chrome-linux/chrome", "/usr/bin/chromium"].includes(c);
    const listar = () => ["chromium-1100", "chromium-1200", "ffmpeg-1"];
    expect(chromeDoLinux({ NOD_NAVEGADOR_CHROME: "/opt/chrome" }, existe, listar)).toBe("/opt/chrome");
    expect(chromeDoLinux({}, existe, listar)).toBe("/opt/nod-motor/chromium/chromium-1200/chrome-linux64/chrome");
    expect(chromeDoLinux({ PATH: "/usr/local/bin:/usr/bin" }, existe, () => [])).toBe("/usr/bin/chromium");
    expect(chromeDoLinux({}, () => false, () => [])).toBeNull();
    expect(agentBrowserDoLinux({}, "x64", (c) => c === "/opt/nod-motor/navegador/node_modules/@agent-browser/cli-linux-x64-gnu/bin/agent-browser")).toBe("/opt/nod-motor/navegador/node_modules/@agent-browser/cli-linux-x64-gnu/bin/agent-browser");
    expect(agentBrowserDoLinux({ PATH: "/usr/bin" }, "arm64", (c) => c === "/usr/bin/agent-browser")).toBe("/usr/bin/agent-browser");
  });
});

describe("a vista ao vivo vinda da máquina (WebSocket de verdade, agent-browser falso)", () => {
  let servidor: Server | null = null;
  let stream: WebSocketServer | null = null;
  afterEach(async () => {
    for (const c of stream?.clients ?? []) c.terminate();
    await new Promise<void>((r) => (stream ? stream.close(() => r()) : r()));
    await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r()));
    servidor = null;
    stream = null;
  });

  it("a máquina disca com o token, repassa só frame/tabs/status, entrega a entrada ao stream e o texto ao relay; fechar fecha os dois", async () => {
    // O stream local falso do agent-browser.
    stream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((r) => stream!.once("listening", () => r()));
    const portaStream = (stream.address() as AddressInfo).port;
    const noStream: unknown[] = [];
    let local: WsSocket | null = null;
    stream.on("connection", (ws) => { local = ws; ws.on("message", (d) => noStream.push(JSON.parse(String(d)))); });

    // O servidor do nod: a fila, a vista da máquina e o upgrade de verdade.
    const canal = criarCanalNavegador({ agora: Date.now });
    canal.presenca(ESCOPO, MAQ, { plataforma: "darwin", nome: "Mac" });
    const vivo = criarVivoDaMaquina({ canal, maquinaDoBot: () => MAQ, prazoParMs: 5_000 });
    servidor = createServer();
    anexarCanaisVoz(servidor, {
      resolverEscopo: () => null, autorizarTokenTurno: () => null, ligacaoDoTurno: () => null, anexarMidia: () => null, anexarCerebro: () => null, anexarDitado: () => {},
      navegadorVivo: { web: () => {}, maquina: (agenteId, token, c) => vivo.anexar(agenteId, token, c) },
    });
    await new Promise<void>((r) => servidor!.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    // A máquina: puxa da fila de verdade e abre o WebSocket pela ponte HTTP do app.
    const relays: unknown[] = [];
    const ponte = criarPonteHttp({ url, chave: "chave", versao: "9.9.9" });
    const { motor } = motorFalso({ porta: portaStream });
    paraParar.push(iniciarNavegadorDaMaquina({
      canal: { puxar: async () => { await esperar(5); return canal.puxar(ESCOPO, MAQ); }, resultado: async (r) => canal.resultado(ESCOPO, MAQ, r), vivo: ponte.navegador.vivo },
      motor: async () => motor,
      relay: async (_porta, c) => { relays.push(c); return true; },
    }));

    const fonte = await vivo.abrir(ESCOPO, BOT);
    expect(fonte).not.toBeNull();
    const recebidas: string[] = [];
    fonte!.stream.aoMensagem((t) => recebidas.push(t));
    await ate(() => local !== null);
    const quadro = JSON.stringify({ type: "frame", data: "/9j/AAAA", metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    local!.send(JSON.stringify({ type: "command", action: "eval", script: "segredo()" }));
    local!.send(quadro);
    local!.send(JSON.stringify({ type: "tabs", tabs: [{ tabId: "t1", title: "A", url: "https://a.com/", active: true }] }));
    await ate(() => recebidas.length === 2);
    expect(recebidas[0]).toBe(quadro);
    expect(recebidas.some((t) => t.includes("segredo"))).toBe(false);

    // A entrada da pessoa desce ao stream (só input_*); o texto vai ao relay (só tecla e insertText).
    fonte!.stream.enviar({ type: "input_mouse", eventType: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 });
    fonte!.stream.enviar({ type: "navigate", url: "file:///etc" });
    await ate(() => noStream.length === 1);
    await esperar(20);
    expect(noStream).toEqual([{ type: "input_mouse", eventType: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 }]);
    expect(await fonte!.relay({ action: "keyboard", subaction: "insertText", text: "olá" })).toBe(true);
    expect(await fonte!.relay({ action: "eval", script: "x" })).toBe(false);
    expect(relays).toEqual([{ action: "keyboard", subaction: "insertText", text: "olá" }]);

    // O token não serve duas vezes nem para outro bot.
    expect(vivo.anexar(BOT, "token-que-nao-existe", { enviarJson: () => {}, fechar: () => {}, aoMensagem: () => {}, aoFechar: () => {}, pendente: () => 0 })).toBe(false);

    // Fechar do lado do servidor fecha o stream local na máquina.
    const fechouLocal = new Promise<void>((r) => local!.once("close", () => r()));
    fonte!.stream.fechar();
    await fechouLocal;
    await ate(() => paraParar[0]!.vivos() === 0);
  });

  it("sem Chrome vivo na máquina, ela recusa e a espera solta na hora (null)", async () => {
    const canal = criarCanalNavegador({ agora: Date.now });
    canal.presenca(ESCOPO, MAQ, { plataforma: "darwin", nome: "Mac" });
    const vivo = criarVivoDaMaquina({ canal, maquinaDoBot: () => MAQ, prazoParMs: 5_000 });
    const { motor } = motorFalso({ porta: null });
    paraParar.push(iniciarNavegadorDaMaquina({
      canal: { puxar: async () => { await esperar(5); return canal.puxar(ESCOPO, MAQ); }, resultado: async (r) => canal.resultado(ESCOPO, MAQ, r), vivo: async () => null },
      motor: async () => motor,
    }));
    const inicio = Date.now();
    expect(await vivo.abrir(ESCOPO, BOT)).toBeNull();
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(vivo.esperando()).toBe(0);
    expect(await criarVivoDaMaquina({ canal, maquinaDoBot: () => null }).abrir(ESCOPO, BOT)).toBeNull();
  });
});

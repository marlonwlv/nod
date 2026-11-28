import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import type { StreamDoNavegador } from "../../../src/adapters/navegador/stream-local.ts";
import { alvoAtivoDasAbas, criarVistaLocal, type VistaLocal } from "../../../src/adapters/navegador/vista-local.ts";
import type { ConexaoCdp } from "../../../src/adapters/navegador/entrada-cdp.ts";

/**
 * 2026-11-28: a vista local do lado da máquina, sem Chrome: o motor e o stream são falsos; o cliente é um `ws` como o do
 * app. A prova com o Chrome de verdade é tests/windows/painel-local.test.ts.
 */
const BOT = "00000000-0000-4000-8000-0000000000c1";
const TOKEN = "t".repeat(43);
const vistas: VistaLocal[] = [];
afterEach(async () => { for (const v of vistas.splice(0)) await v.parar(); });

function streamFalso() {
  const enviadas: Record<string, unknown>[] = [];
  let leitor: (t: string) => void = () => undefined;
  let fechou: () => void = () => undefined;
  const st: StreamDoNavegador = {
    enviar: (m) => { enviadas.push({ ...m }); },
    fechar: () => fechou(),
    aoMensagem: (fn) => { leitor = fn; },
    aoFechar: (fn) => { fechou = fn; },
  };
  return { st, enviadas, mandar: (m: object) => leitor(JSON.stringify(m)), cair: () => fechou() };
}

async function montar(o: { porta?: number | null; cdp?: boolean } = {}) {
  const stream = streamFalso();
  const relay: Record<string, unknown>[] = [];
  const cdpEnviadas: { method: string; params: Record<string, unknown>; sessionId?: string }[] = [];
  const motor = {
    portaDoStream: async () => (o.porta === undefined ? 9999 : o.porta),
    enderecoCdp: async () => "ws://127.0.0.1:1/devtools/browser/abc",
  } as unknown as MotorNavegador;
  const conectarCdp = async (): Promise<ConexaoCdp> => {
    let leitor: (t: string) => void = () => undefined;
    return {
      enviar: (t) => {
        const m = JSON.parse(t) as { id: number; method: string; params: Record<string, unknown>; sessionId?: string };
        cdpEnviadas.push(m);
        queueMicrotask(() => leitor(JSON.stringify({ id: m.id, result: m.method === "Target.attachToTarget" ? { sessionId: "s1" } : {} })));
      },
      aoMensagem: (fn) => { leitor = fn; }, aoFechar: () => undefined, fechar: () => undefined,
    };
  };
  const v = criarVistaLocal({ motor: async () => motor, conectarStream: async () => stream.st, relay: async (_p, c) => { relay.push({ ...c }); return true; }, ...(o.cdp ? { conectarCdp } : {}), token: TOKEN });
  vistas.push(v);
  const end = await v.iniciar();
  return { v, end, stream, relay, cdpEnviadas };
}

async function cliente(porta: number, caminho: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}${caminho}`);
  const msgs: Record<string, unknown>[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(d.toString()) as Record<string, unknown>));
  const fechou = new Promise<number>((r) => ws.once("close", (c) => r(c)));
  const abriu = await new Promise<boolean>((r) => { ws.once("open", () => r(true)); ws.once("unexpected-response", () => r(false)); ws.once("error", () => r(false)); });
  return { ws, msgs, fechou, abriu };
}
const ate = async (cond: () => boolean, ms = 2_000) => { const fim = Date.now() + ms; while (!cond()) { if (Date.now() > fim) throw new Error("não chegou"); await new Promise((r) => setTimeout(r, 5)); } };

describe("a vista local da máquina (127.0.0.1, com token)", () => {
  it("só 127.0.0.1, porta do sistema; sem o token certo (ou com bot fora do formato), 403", async () => {
    const { end } = await montar();
    expect(end).toMatchObject({ token: TOKEN });
    expect(end.porta).toBeGreaterThan(0);
    expect((await cliente(end.porta, `/navegador/${BOT}?t=errado`)).abriu).toBe(false);
    expect((await cliente(end.porta, `/navegador/nao-e-uuid?t=${TOKEN}`)).abriu).toBe(false);
    expect((await cliente(end.porta, `/outra/${BOT}?t=${TOKEN}`)).abriu).toBe(false);
    expect((await cliente(end.porta, `/navegador/${BOT}?t=${TOKEN}`)).abriu).toBe(true);
  });

  it("sem o Chrome do bot nesta máquina: nem abre (404), e o app devolve null na hora", async () => {
    const { end } = await montar({ porta: null });
    expect((await cliente(end.porta, `/navegador/${BOT}?t=${TOKEN}`)).abriu).toBe(false);
  });

  it("do stream só saem quadro, abas e tamanho (o JS e os resultados do bot ficam)", async () => {
    const { end, stream } = await montar();
    const c = await cliente(end.porta, `/navegador/${BOT}?t=${TOKEN}`);
    await new Promise((r) => setTimeout(r, 30));
    stream.mandar({ type: "command", action: "evaluate", params: { script: "document.cookie" } });
    stream.mandar({ type: "result", data: { result: "SEGREDO-DO-BOT" } });
    stream.mandar({ type: "console", text: "oi" });
    stream.mandar({ type: "status", viewportWidth: 1024, viewportHeight: 600 });
    stream.mandar({ type: "frame", data: "/9j/AA", metadata: { deviceWidth: 10, deviceHeight: 10 } });
    await ate(() => c.msgs.length === 2);
    expect(c.msgs.map((m) => m.type)).toEqual(["status", "frame"]);
    expect(JSON.stringify(c.msgs)).not.toMatch(/SEGREDO|cookie|"oi"/);
  });

  it("com o CDP: cada entrada vai confirmada à aba ativa (a das abas do stream) e volta {t:'ok'}", async () => {
    const { end, stream, cdpEnviadas } = await montar({ cdp: true });
    const c = await cliente(end.porta, `/navegador/${BOT}?t=${TOKEN}`);
    await new Promise((r) => setTimeout(r, 30));
    stream.mandar({ type: "tabs", tabs: [{ tabId: "t1", active: true, targetId: "ABCDEF0123456789", url: "https://x/", title: "x" }] });
    stream.mandar({ type: "status", viewportWidth: 1280, viewportHeight: 720 });
    await ate(() => c.msgs.length === 2);
    c.ws.send(JSON.stringify({ t: "entrada", n: 1, e: { t: "tecla", evento: "keyDown", tecla: "1", codigo: "Digit1", texto: "1" } }));
    c.ws.send(JSON.stringify({ t: "entrada", n: 2, e: { t: "tecla", evento: "char", texto: "ção" } }));
    c.ws.send(JSON.stringify({ t: "entrada", n: 3, e: { t: "mouse", evento: "mousePressed", x: 99_999, y: 1 } }));
    await ate(() => c.msgs.filter((m) => m.t === "ok").length === 3);
    // A fora do viewport volta na hora (recusada); as outras, quando o Chrome responde.
    expect(c.msgs.filter((m) => m.t === "ok").sort((a, b) => Number(a.n) - Number(b.n))).toEqual([{ t: "ok", n: 1, ok: true }, { t: "ok", n: 2, ok: true }, { t: "ok", n: 3, ok: false }]);
    expect(cdpEnviadas.map((m) => m.method)).toEqual(["Target.attachToTarget", "Input.dispatchKeyEvent", "Input.insertText"]);
    expect(cdpEnviadas[0]!.params).toEqual({ targetId: "ABCDEF0123456789", flatten: true });
    expect(stream.enviadas).toEqual([]);
  });

  it("sem o CDP: o caminho antigo (o clique pelo stream, o texto pelo relay, que confirma)", async () => {
    const { end, stream, relay } = await montar();
    const c = await cliente(end.porta, `/navegador/${BOT}?t=${TOKEN}`);
    await new Promise((r) => setTimeout(r, 30));
    c.ws.send(JSON.stringify({ t: "entrada", n: 1, e: { t: "mouse", evento: "mousePressed", x: 5, y: 5 } }));
    c.ws.send(JSON.stringify({ t: "entrada", n: 2, e: { t: "tecla", evento: "char", texto: "olá" } }));
    await ate(() => c.msgs.filter((m) => m.t === "ok").length === 2);
    expect(stream.enviadas).toMatchObject([{ type: "input_mouse", eventType: "mousePressed", x: 5, y: 5 }]);
    expect(relay).toEqual([{ action: "keyboard", subaction: "insertText", text: "olá" }]);
  });

  it("o Chrome fechou (a pausa): fim 'fechou' e a vista some", async () => {
    const { v, end, stream } = await montar();
    const c = await cliente(end.porta, `/navegador/${BOT}?t=${TOKEN}`);
    await ate(() => v.abertas() === 1);
    stream.cair();
    await c.fechou;
    expect(c.msgs).toEqual([{ t: "fim", motivo: "fechou" }]);
    expect(v.abertas()).toBe(0);
  });

  it("a aba ativa das abas do stream", () => {
    expect(alvoAtivoDasAbas({ tabs: [{ active: false, targetId: "AAAAAAAA" }, { active: true, targetId: "BBBBBBBB" }] })).toBe("BBBBBBBB");
    expect(alvoAtivoDasAbas({ tabs: [{ active: true, targetId: "../x" }] })).toBeNull();
    expect(alvoAtivoDasAbas({})).toBeNull();
  });
});

describe("o daemon fica acordado enquanto alguém assiste (2026-11-28)", () => {
  it("um comando barato a cada intervalo; para quando a vista fecha", async () => {
    const { manterAcordado } = await import("../../../src/adapters/navegador/manter-acordado.ts");
    let aberto = true;
    let chamadas = 0;
    manterAcordado({ portaDoStream: async () => { chamadas++; return 1; } }, BOT, () => aberto, 10);
    await new Promise((r) => setTimeout(r, 45));
    expect(chamadas).toBeGreaterThanOrEqual(3);
    aberto = false;
    await new Promise((r) => setTimeout(r, 15));
    const depois = chamadas;
    await new Promise((r) => setTimeout(r, 40));
    expect(chamadas).toBe(depois);
  });
});

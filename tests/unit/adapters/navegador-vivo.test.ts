import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { criarVivoNavegador, type PortaoDoVivo } from "../../../src/adapters/navegador/vivo.ts";
import { anexarCanaisVoz } from "../../../src/adapters/voz/ws.ts";
import { FECHAMENTOS_NAVEGADOR_VIVO, type EntradaNavegador, type VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";

/**
 * O canal ao vivo do navegador (ADR-190) com `ws` de verdade dos dois lados: a web abre o caminho de tenant e o servidor
 * fala com um agent-browser FALSO (um servidor WebSocket e o `POST /api/command` na mesma porta), pelos clientes padrão
 * do canal (`conectarPadrao`, `relayPadrao`). O portão é de mentira: a vista em memória e o que ele recebeu.
 */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };
const BOT = "00000000-0000-4000-8000-0000000000c1";
const OUTRO = "00000000-0000-4000-8000-0000000000c2";
const JPEG = "/9j/4AAQSkZJRgABAQ==";

const servidores: { close(cb: () => void): void }[] = [];
afterEach(async () => { for (const s of servidores.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

function vistaBase(o: Partial<VistaNavegador> = {}): VistaNavegador {
  return { agenteId: BOT, estado: "ao_vivo", controle: "bot", lugar: { tipo: "nod" }, abas: [], aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, ofertaGuardar: null, atividadeEm: 0, erro: null, viewport: { w: 1280, h: 720 }, ...o };
}

/** O agent-browser falso: guarda o que chegou pelo stream e pelo relay e manda o que o teste pedir. */
async function agentBrowserFalso() {
  const recebidas: Record<string, unknown>[] = [];
  const relay: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const http = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c: Buffer) => { corpo += c.toString(); });
    req.on("end", () => {
      const ok = req.url === "/api/command" && req.headers.origin === `http://127.0.0.1:${porta}`;
      if (ok) relay.push(JSON.parse(corpo) as Record<string, unknown>);
      res.writeHead(ok ? 200 : 403, { "Content-Type": "application/json" }).end(JSON.stringify({ success: ok, data: {} }));
    });
  });
  const wss = new WebSocketServer({ server: http });
  const conexoes: WebSocket[] = [];
  wss.on("connection", (ws, req) => {
    urls.push(req.url ?? "");
    conexoes.push(ws);
    ws.on("message", (d) => recebidas.push(JSON.parse(d.toString()) as Record<string, unknown>));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const porta = (http.address() as { port: number }).port;
  servidores.push({ close: (cb) => { for (const c of wss.clients) c.terminate(); wss.close(); http.close(() => cb()); } });
  return {
    porta, recebidas, relay, urls,
    abertas: () => conexoes.filter((c) => c.readyState === c.OPEN).length,
    mandar: (msg: object) => { for (const c of conexoes) if (c.readyState === c.OPEN) c.send(JSON.stringify(msg)); },
  };
}

async function montar(o: { intervaloQuadroMs?: number; semVivo?: boolean } = {}) {
  const ab = await agentBrowserFalso();
  let vista = vistaBase();
  const doStream: unknown[] = [];
  const antes: EntradaNavegador[] = [];
  const tamanhos: { w: number; h: number }[] = [];
  const portao: PortaoDoVivo = {
    conferirDona: async (_e, agenteId) => { if (agenteId !== BOT) throw new Error("nao_encontrado"); },
    vistaDe: () => vista,
    portaDoStream: async () => ab.porta,
    doStream: (_e, _a, m) => { doStream.push(m); },
    antesDaEntrada: async (_e, _a, e) => { antes.push(e); },
    tamanho: (_e, _a, area) => { tamanhos.push(area); },
  };
  const vivo = criarVivoNavegador({ portao, intervaloQuadroMs: o.intervaloQuadroMs ?? 0, reabrirMs: 50 });
  const srv: Server = createServer();
  const canais = anexarCanaisVoz(srv, {
    resolverEscopo: async () => ESCOPO, autorizarTokenTurno: () => null, ligacaoDoTurno: () => null, anexarMidia: () => null, anexarCerebro: () => null, anexarDitado: () => {},
    ...(o.semVivo ? {} : { navegadorVivo: { web: (escopo, agenteId, canal) => vivo.web(escopo, agenteId, canal) } }),
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  servidores.push({ close: (cb) => { vivo.fechar(); void canais.fechar().then(() => { srv.closeAllConnections(); srv.close(() => cb()); }); } });
  const host = `127.0.0.1:${(srv.address() as { port: number }).port}`;
  const mudar = (p: Partial<VistaNavegador>) => { vista = { ...vista, ...p }; vivo.vistaMudou(ESCOPO, vista); };
  return { ab, vivo, host, doStream, antes, mudar, tamanhos };
}

type Web = { ws: WebSocket; msgs: Record<string, unknown>[]; fechou: Promise<{ codigo: number; motivo: string }> };
async function abrirWeb(host: string, agenteId = BOT, origem = `http://${host}`): Promise<Web> {
  const ws = new WebSocket(`ws://${host}/api/t/${ESCOPO.tenantId}/agentes/${agenteId}/navegador/vivo`, { headers: { origin: origem } });
  const msgs: Record<string, unknown>[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(d.toString()) as Record<string, unknown>));
  const fechou = new Promise<{ codigo: number; motivo: string }>((r) => ws.once("close", (codigo, motivo) => r({ codigo, motivo: motivo.toString() })));
  await new Promise<void>((r, e) => { ws.once("open", () => r()); ws.once("unexpected-response", (_q, res) => e(new Error(String(res.statusCode)))); ws.once("error", e); });
  return { ws, msgs, fechou };
}

/** Espera uma condição (o tráfego é assíncrono nos dois sockets). */
async function ate(cond: () => boolean, ms = 3_000): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("condição não chegou");
    await new Promise((r) => setTimeout(r, 10));
  }
}
const quadros = (w: Web) => w.msgs.filter((m) => m.t === "quadro");

describe("navegador ao vivo pelo WebSocket", () => {
  it("a dona recebe a vista; o stream abre com teto de 10/s; quadros passam, command/result/console não; abas e tela vão ao portão", async () => {
    const { ab, host, doStream } = await montar();
    const web = await abrirWeb(host);
    await ate(() => web.msgs.length > 0 && ab.abertas() === 1);
    expect(web.msgs[0]).toMatchObject({ t: "vista", vista: { agenteId: BOT, estado: "ao_vivo" } });
    expect(ab.urls).toEqual(["/?maxFps=10"]);
    ab.mandar({ type: "command", action: "evaluate", params: { script: "document.cookie" } });
    ab.mandar({ type: "result", data: { result: "VALOR-DO-BOT" } });
    ab.mandar({ type: "console", text: "oi" });
    ab.mandar({ type: "status", viewportWidth: 1024, viewportHeight: 600, connected: true });
    ab.mandar({ type: "tabs", tabs: [{ tabId: "t1", title: "Loja", url: "https://u:s@loja.exemplo.com/a", active: true }, { tabId: "x9", title: "inválida" }] });
    ab.mandar({ type: "frame", seq: 7, data: "nao-e-jpeg", metadata: { deviceWidth: 10, deviceHeight: 10 } });
    ab.mandar({ type: "frame", seq: 8, data: JPEG, metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    await ate(() => quadros(web).length === 1 && doStream.length === 2);
    expect(quadros(web)[0]).toEqual({ t: "quadro", seq: 1, jpeg: JPEG, w: 1280, h: 720 });
    expect(JSON.stringify(web.msgs)).not.toMatch(/VALOR-DO-BOT|document\.cookie|"oi"/);
    expect(doStream).toEqual([{ viewport: { w: 1024, h: 600 } }, { abas: [{ id: "t1", titulo: "Loja", url: "https://loja.exemplo.com/a", ativa: true }] }]);
    web.ws.close();
    await ate(() => ab.abertas() === 0);
  });

  it("teto de taxa por espectador e nada de quadro com segredo na página", async () => {
    const { ab, host, mudar } = await montar({ intervaloQuadroMs: 60_000 });
    const web = await abrirWeb(host);
    await ate(() => ab.abertas() === 1);
    for (let i = 0; i < 5; i++) ab.mandar({ type: "frame", seq: i + 1, data: JPEG, metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    await ate(() => quadros(web).length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(quadros(web)).toHaveLength(1);
    const web2 = await abrirWeb(host);
    await ate(() => web2.msgs.length === 1);
    mudar({ segredoNaPagina: true });
    await ate(() => web2.msgs.some((m) => m.t === "vista" && (m.vista as VistaNavegador).segredoNaPagina));
    ab.mandar({ type: "frame", seq: 9, data: JPEG, metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    await new Promise((r) => setTimeout(r, 100));
    expect(quadros(web2)).toHaveLength(0);
    web.ws.close();
    web2.ws.close();
  });

  it("saindo do segredo, o stream abre de novo para trazer o quadro da página atual (prova real: a área logada ficava em branco)", async () => {
    const { ab, host, mudar } = await montar();
    const web = await abrirWeb(host);
    await ate(() => ab.abertas() === 1 && web.msgs.length === 1);
    mudar({ segredoNaPagina: true });
    // O quadro da página nova chega antes de o portão saber da URL nova: cai.
    ab.mandar({ type: "frame", seq: 1, data: JPEG, metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(quadros(web)).toHaveLength(0);
    mudar({ segredoNaPagina: false });
    await ate(() => ab.urls.length === 2 && ab.abertas() === 1);
    ab.mandar({ type: "frame", seq: 2, data: JPEG, metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    await ate(() => quadros(web).length === 1);
    // Outra vista sem segredo não reabre.
    mudar({ atividadeEm: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(ab.urls).toHaveLength(2);
    web.ws.close();
  });

  it("entrada: com o bot no controle volta a vista; com a pessoa, o mouse vai pelo stream e o texto e o Backspace pelo relay", async () => {
    const { ab, host, mudar, antes } = await montar();
    const web = await abrirWeb(host);
    await ate(() => ab.abertas() === 1 && web.msgs.length === 1);
    web.ws.send(JSON.stringify({ t: "mouse", evento: "mousePressed", x: 10, y: 10 }));
    await ate(() => web.msgs.length === 2);
    expect(web.msgs[1]).toMatchObject({ t: "vista", vista: { controle: "bot" } });
    expect(ab.recebidas).toEqual([]);
    mudar({ controle: "pessoa" });
    web.ws.send(JSON.stringify({ t: "mouse", evento: "mousePressed", x: 2000, y: 10 }));
    web.ws.send("isto não é json");
    web.ws.send(JSON.stringify({ t: "mouse", evento: "mousePressed", x: 40, y: 30, botao: "left", cliques: 1 }));
    web.ws.send(JSON.stringify({ t: "tecla", evento: "char", texto: "olá" }));
    web.ws.send(JSON.stringify({ t: "tecla", evento: "keyDown", tecla: "Backspace" }));
    web.ws.send(JSON.stringify({ t: "tecla", evento: "keyUp", tecla: "Backspace" }));
    // O keyUp do Backspace só é tratado depois que a resposta do relay volta: espera as quatro entradas no portão.
    await ate(() => ab.recebidas.length === 1 && ab.relay.length === 2 && antes.length === 4);
    expect(ab.recebidas).toEqual([{ type: "input_mouse", eventType: "mousePressed", x: 40, y: 30, button: "left", clickCount: 1, deltaX: 0, deltaY: 0, modifiers: 0 }]);
    expect(ab.relay).toEqual([{ action: "keyboard", subaction: "insertText", text: "olá" }, { action: "press", key: "Backspace" }]);
    // O portão viu cada entrada repassada (para a gravação), antes do repasse.
    expect(antes.map((e) => e.t + ":" + ("evento" in e ? e.evento : ""))).toEqual(["mouse:mousePressed", "tecla:char", "tecla:keyDown", "tecla:keyUp"]);
    web.ws.close();
  });

  it("tamanho (emenda de 2026-11-20): vai ao portão assistindo, sem resposta de recusa nem repasse ao Chrome; fora da forma, ignorado", async () => {
    const { ab, host, tamanhos, antes } = await montar();
    const web = await abrirWeb(host);
    await ate(() => ab.abertas() === 1 && web.msgs.length === 1);
    web.ws.send(JSON.stringify({ t: "tamanho", w: 560.4, h: 700 }));
    web.ws.send(JSON.stringify({ t: "tamanho", w: 50, h: 700 }));
    web.ws.send(JSON.stringify({ t: "tamanho", w: 560, h: 700, x: 1 }));
    web.ws.send(JSON.stringify({ t: "tamanho", w: "560", h: 700 }));
    await ate(() => tamanhos.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(tamanhos).toEqual([{ w: 560, h: 700 }]);
    expect(web.msgs).toHaveLength(1);
    expect(ab.recebidas).toEqual([]);
    expect(antes).toEqual([]);
    web.ws.close();
  });

  it("bot de outra pessoa: fim nao_permitido e 4403; o terceiro espectador derruba o mais antigo; sem ninguém, o stream fecha", async () => {
    const { ab, host, vivo } = await montar();
    const intruso = await abrirWeb(host, OUTRO);
    expect(await intruso.fechou).toEqual({ codigo: FECHAMENTOS_NAVEGADOR_VIVO.recusado, motivo: "nao_permitido" });
    expect(intruso.msgs).toEqual([{ t: "fim", motivo: "nao_permitido" }]);
    const a = await abrirWeb(host);
    const b = await abrirWeb(host);
    await ate(() => vivo.abertos()[0]?.espectadores === 2);
    const c = await abrirWeb(host);
    expect(await a.fechou).toEqual({ codigo: FECHAMENTOS_NAVEGADOR_VIVO.trocou, motivo: "outra_janela" });
    expect(a.msgs.at(-1)).toEqual({ t: "fim", motivo: "outra_janela" });
    await ate(() => ab.abertas() === 1);
    b.ws.close();
    c.ws.close();
    await ate(() => ab.abertas() === 0 && vivo.abertos().length === 0);
  });

  it("a vista que muda vai a quem assiste; pausa fecha o stream e ao_vivo reabre", async () => {
    const { ab, host, mudar } = await montar();
    const web = await abrirWeb(host);
    await ate(() => ab.abertas() === 1);
    mudar({ estado: "pausa" });
    await ate(() => ab.abertas() === 0);
    expect(web.msgs.at(-1)).toMatchObject({ t: "vista", vista: { estado: "pausa" } });
    mudar({ estado: "ao_vivo" });
    await ate(() => ab.abertas() === 1);
    expect(ab.urls).toHaveLength(2);
    web.ws.close();
  });

  it("caminho: sem o navegador ligado é 404; id fora de uuid é 404; Origin de fora é 403", async () => {
    const sem = await montar({ semVivo: true });
    await expect(abrirWeb(sem.host)).rejects.toThrow("404");
    const { host } = await montar();
    await expect(abrirWeb(host, "nao-e-uuid")).rejects.toThrow("404");
    await expect(abrirWeb(host, BOT, "http://outro.site")).rejects.toThrow("403");
  });
});

describe("a vista de um bot que roda na máquina da pessoa (lugar mac/maquina)", () => {
  it("os quadros vêm da fonte da máquina, a entrada desce por ela e o lugar novo troca a fonte; o stream local nunca abre", async () => {
    let vista = vistaBase({ lugar: { tipo: "mac", nome: "seu Mac" }, controle: "pessoa" });
    const portao: PortaoDoVivo = {
      conferirDona: async () => {}, vistaDe: () => vista, portaDoStream: async () => { throw new Error("não abre o stream local"); },
      doStream: () => {}, antesDaEntrada: async () => {},
    };
    const doStream: ((t: string) => void)[] = [];
    const desceu: unknown[] = [];
    const relays: unknown[] = [];
    let fechadas = 0;
    let aberturas = 0;
    const vivo = criarVivoNavegador({
      portao, intervaloQuadroMs: 0, reabrirMs: 20,
      conectar: async () => { throw new Error("não abre o stream local"); },
      maquina: { abrir: async () => {
        aberturas++;
        return { stream: { enviar: (m) => desceu.push(m), fechar: () => { fechadas++; }, aoMensagem: (fn) => { doStream.push(fn); }, aoFechar: () => {} }, relay: async (c) => { relays.push(c); return true; } };
      } },
    });
    const web: unknown[] = [];
    const ouvintes: ((m: { texto: string }) => void)[] = [];
    vivo.web(ESCOPO, BOT, { enviarJson: (m) => web.push(m), fechar: () => {}, aoMensagem: (fn) => { ouvintes.push(fn as (m: { texto: string }) => void); }, aoFechar: () => {}, pendente: () => 0 });
    const ate = async (fn: () => boolean) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };
    await ate(() => doStream.length === 1);
    doStream[0]!(JSON.stringify({ type: "frame", data: JPEG, metadata: { deviceWidth: 800, deviceHeight: 600 } }));
    expect(web.at(-1)).toMatchObject({ t: "quadro", jpeg: JPEG, w: 800, h: 600 });
    ouvintes[0]!({ texto: JSON.stringify({ t: "mouse", evento: "mousePressed", x: 5, y: 5, botao: "left", cliques: 1 }) });
    ouvintes[0]!({ texto: JSON.stringify({ t: "tecla", evento: "char", texto: "oi" }) });
    await ate(() => relays.length === 1);
    expect(desceu[0]).toMatchObject({ type: "input_mouse", eventType: "mousePressed" });
    expect(relays).toEqual([{ action: "keyboard", subaction: "insertText", text: "oi" }]);
    // O bot passou para a vm-sp: a fonte do Mac fecha e a da máquina nova abre.
    vista = { ...vista, lugar: { tipo: "maquina", maquinaId: OUTRO, nome: "vm-sp" } };
    vivo.vistaMudou(ESCOPO, vista);
    await ate(() => aberturas === 2);
    expect(fechadas).toBe(1);
    vivo.fechar();
  });
});

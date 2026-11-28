import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntradaNavegador, OperacaoNavegador, RespostaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import type { PonteNavegadorLocal } from "../../../src/contracts/navegador-local.ts";
import { montarVistaNavegador, type SocketDaVista } from "../../../web/telas/navegador-vista.ts";
import { criarFilaLocal } from "../../../web/lib/navegador-local.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a vista com a vista local do app (happy-dom). Com o Chrome do bot neste
 * computador (o lugar "mac"), os quadros vêm da ponte do app e a entrada vai por ela, confirmada; o servidor fica com a
 * vista e o espelho. Sem confirmação, a entrada que não foi segue pelo servidor, sem perder o que a pessoa digitou.
 */
const vista = (x: Partial<VistaNavegador> = {}): VistaNavegador => ({
  agenteId: "a1", estado: "ao_vivo", controle: "bot", lugar: { tipo: "mac", nome: "PC de Ana" },
  abas: [{ id: "t1", titulo: "Banco", url: "https://banco.example/login", ativa: true, carregando: false, inseguro: false }],
  aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, ofertaGuardar: null, atividadeEm: 1_000, erro: null, viewport: { w: 1280, h: 800 }, ...x,
});
const resposta = (x: Partial<VistaNavegador> = {}): RespostaNavegador => ({ vista: vista(x), disponivel: true });

class SocketFalso implements SocketDaVista {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  enviados: Record<string, unknown>[] = [];
  constructor(readonly url: string) {}
  send(d: string): void { this.enviados.push(JSON.parse(d) as Record<string, unknown>); }
  close(): void { /* nada */ }
  chega(m: object): void { this.onmessage?.({ data: JSON.stringify(m) }); }
}

function ponteFalsa(o: { abre?: boolean; confirma?: (e: EntradaNavegador) => boolean } = {}) {
  let ouvinte: (id: string, texto: string) => void = () => undefined;
  const enviadas: EntradaNavegador[] = [];
  const ponte: PonteNavegadorLocal & { quadro(): void; fim(motivo: string): void; enviadas: EntradaNavegador[]; abertas: number } = {
    abertas: 0,
    enviadas,
    abrir: vi.fn(async () => { ponte.abertas++; return o.abre === false ? null : "v1"; }),
    enviar: vi.fn(async (_id: string, e: EntradaNavegador) => { enviadas.push(e); return o.confirma ? o.confirma(e) : true; }),
    fechar: vi.fn(async () => undefined),
    aoMensagem: (fn) => { ouvinte = fn; },
    quadro: () => ouvinte("v1", JSON.stringify({ type: "frame", seq: 1, data: "/9j/QUJD", metadata: { deviceWidth: 1280, deviceHeight: 800 } })),
    fim: (motivo) => ouvinte("v1", JSON.stringify({ t: "fim", motivo })),
  };
  return ponte;
}

function apiFalsa() {
  return {
    operarNavegador: vi.fn(async (_id: string, op: OperacaoNavegador) => ({ ok: true as const, vista: vista({ controle: op === "assumir" ? "pessoa" : "bot" }) })),
    irParaNoNavegador: vi.fn(async () => ({ ok: true as const, vista: vista({ controle: "pessoa" }) })),
    trocarAbaDoNavegador: vi.fn(async () => ({ ok: true as const, vista: vista({ controle: "pessoa" }) })),
    urlVivoNavegador: (id: string) => `ws://teste/agentes/${id}/navegador/vivo`,
    navegador: vi.fn(async () => resposta()),
  };
}

const palcoEm = (el: HTMLElement) => {
  const palco = el.querySelector<HTMLElement>(".nv-palco")!;
  palco.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 600, right: 640, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  return palco;
};
const ponteiro = (tipo: string, x: number, y: number) => {
  const e = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
};

describe("a vista local do app (o Chrome do bot neste computador)", () => {
  let sockets: SocketFalso[];
  beforeEach(() => { sockets = []; document.body.innerHTML = ""; });

  function montar(ponte: PonteNavegadorLocal, r: RespostaNavegador = resposta()) {
    const v = montarVistaNavegador({ api: apiFalsa(), agenteId: "a1", nome: () => "Ada", local: ponte, abrirSocket: (url) => { const s = new SocketFalso(url); sockets.push(s); return s; }, menosMovimento: () => true });
    document.body.append(v.el);
    v.atualizar(r);
    v.ligar(true);
    return v;
  }

  it("o servidor fica só com a vista (?quadros=local) e o quadro vem da ponte do app", async () => {
    const ponte = ponteFalsa();
    const v = montar(ponte);
    expect(sockets[0]!.url).toBe("ws://teste/agentes/a1/navegador/vivo?quadros=local");
    await vi.waitFor(() => expect(ponte.abrir).toHaveBeenCalledWith("a1"));
    // O quadro pode chegar antes de a ponte devolver o id (o IPC corre separado): espera e entra assim mesmo.
    ponte.quadro();
    await vi.waitFor(() => expect(v.el.querySelector<HTMLImageElement>(".nv-quadro")!.getAttribute("src")).toBe("data:image/jpeg;base64,/9j/QUJD"));
    expect(v.el.dataset.estado).toBe("ao_vivo");
  });

  it("no controle: o clique vai confirmado pela ponte e o servidor recebe só o espelho", async () => {
    const ponte = ponteFalsa();
    const v = montar(ponte);
    await vi.waitFor(() => expect(ponte.abrir).toHaveBeenCalled());
    ponte.quadro();
    v.el.querySelector<HTMLButtonElement>('[data-nv="assumir"]')!.click();
    await vi.waitFor(() => expect(v.controleComPessoa()).toBe(true));
    const palco = palcoEm(v.el);
    palco.dispatchEvent(ponteiro("pointerdown", 320, 200));
    palco.dispatchEvent(ponteiro("pointerup", 320, 200));
    await vi.waitFor(() => expect(ponte.enviadas.map((e) => (e.t === "mouse" ? e.evento : e.t))).toEqual(["mousePressed", "mouseReleased"]));
    const doServidor = sockets[0]!.enviados.filter((m) => m.t !== "tamanho");
    expect(doServidor.map((m) => m.t)).toEqual(["espelho", "espelho"]);
    expect(doServidor.some((m) => m.t === "mouse")).toBe(false);
  });

  it("o Chrome não confirma nem tentando de novo: a tecla segue pelo servidor e os quadros também", async () => {
    const ponte = ponteFalsa({ confirma: () => false });
    const v = montar(ponte);
    await vi.waitFor(() => expect(ponte.abrir).toHaveBeenCalled());
    ponte.quadro();
    v.el.querySelector<HTMLButtonElement>('[data-nv="assumir"]')!.click();
    await vi.waitFor(() => expect(v.controleComPessoa()).toBe(true));
    const palco = palcoEm(v.el);
    palco.dispatchEvent(new KeyboardEvent("keydown", { key: "7", code: "Digit7", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(sockets[0]!.enviados).toContainEqual(expect.objectContaining({ t: "tecla", evento: "keyDown", tecla: "7" })), { timeout: 3_000 });
    expect(ponte.enviadas.length).toBeGreaterThanOrEqual(3);
    expect(sockets[0]!.enviados).toContainEqual({ t: "quadros", local: false });
    expect(v.el.querySelector(".nv-anuncio")?.textContent).toContain("seguindo pela internet");
  });

  it("sem o Chrome do bot neste computador: a ponte não abre e o servidor volta a mandar os quadros", async () => {
    const ponte = ponteFalsa({ abre: false });
    montar(ponte);
    await vi.waitFor(() => expect(sockets[0]!.enviados).toContainEqual({ t: "quadros", local: false }));
  });

  it("o navegador mora no nod (nuvem): nem tenta a ponte", async () => {
    const ponte = ponteFalsa();
    montar(ponte, resposta({ lugar: { tipo: "nod" } }));
    await vi.waitFor(() => expect(sockets[0]!.enviados).toContainEqual({ t: "quadros", local: false }));
    expect(ponte.abrir).not.toHaveBeenCalled();
  });

  it("o Chrome em pausa: espera; quando volta a viver, abre a vista local", async () => {
    const ponte = ponteFalsa();
    const v = montar(ponte, resposta({ estado: "pausa" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(ponte.abrir).not.toHaveBeenCalled();
    v.atualizar(resposta({ estado: "ao_vivo" }));
    await vi.waitFor(() => expect(ponte.abrir).toHaveBeenCalledTimes(1));
  });

  it("gravando uma tarefa (T): a entrada vai pelo servidor (a gravação lê o elemento antes do clique)", async () => {
    const ponte = ponteFalsa();
    const gravando = { iniciadaEm: 1, passos: [], host: "banco.example" } as unknown as VistaNavegador["gravacao"];
    const v = montar(ponte, resposta({ gravacao: gravando }));
    await vi.waitFor(() => expect(ponte.abrir).toHaveBeenCalled());
    ponte.quadro();
    v.atualizar(resposta({ controle: "pessoa", gravacao: gravando }));
    const palco = palcoEm(v.el);
    palco.dispatchEvent(ponteiro("pointerdown", 320, 200));
    expect(ponte.enviadas).toHaveLength(0);
    expect(sockets[0]!.enviados).toContainEqual(expect.objectContaining({ t: "mouse", evento: "mousePressed" }));
  });
});

describe("a fila da entrada local", () => {
  it("uma por vez, na ordem; o mouse andando dá lugar ao mais novo", async () => {
    const feitas: string[] = [];
    let soltar: () => void = () => undefined;
    const primeira = new Promise<void>((r) => { soltar = r; });
    const fila = criarFilaLocal({
      enviar: async (e) => { if (!feitas.length) await primeira; feitas.push(e.t === "mouse" ? `${e.evento}@${e.x}` : e.t); return true; },
      aoFalhar: () => undefined,
    });
    fila.colocar({ t: "mouse", evento: "mousePressed", x: 1, y: 1 });
    fila.colocar({ t: "mouse", evento: "mouseMoved", x: 2, y: 2 });
    fila.colocar({ t: "mouse", evento: "mouseMoved", x: 3, y: 3 });
    fila.colocar({ t: "tecla", evento: "char", texto: "a" });
    soltar();
    await vi.waitFor(() => expect(fila.tamanho()).toBe(0));
    // O movimento 2 ainda não tinha saído quando veio o 3: só o 3 vai.
    expect(feitas).toEqual(["mousePressed@1", "mouseMoved@3", "tecla"]);
  });

  it("não confirmada: tenta de novo e, se não vai, entrega ela e o que vinha atrás (sem o mouse andando)", async () => {
    let tentativas = 0;
    const falhou = vi.fn();
    const fila = criarFilaLocal({ enviar: async () => { tentativas++; return false; }, aoFalhar: falhou, esperarMs: 1 });
    fila.colocar({ t: "tecla", evento: "char", texto: "1" });
    fila.colocar({ t: "mouse", evento: "mouseMoved", x: 1, y: 1 });
    fila.colocar({ t: "tecla", evento: "char", texto: "2" });
    await vi.waitFor(() => expect(falhou).toHaveBeenCalled());
    expect(tentativas).toBe(3);
    expect(falhou.mock.calls[0]![0]).toEqual([{ t: "tecla", evento: "char", texto: "1" }, { t: "tecla", evento: "char", texto: "2" }]);
    fila.colocar({ t: "tecla", evento: "char", texto: "3" });
    expect(falhou).toHaveBeenLastCalledWith([{ t: "tecla", evento: "char", texto: "3" }]);
  });

  it("confirmada na segunda tentativa: segue sem falhar", async () => {
    let n = 0;
    const falhou = vi.fn();
    const fila = criarFilaLocal({ enviar: async () => ++n > 1, aoFalhar: falhou, esperarMs: 1 });
    fila.colocar({ t: "tecla", evento: "char", texto: "x" });
    await vi.waitFor(() => expect(fila.tamanho()).toBe(0));
    expect(falhou).not.toHaveBeenCalled();
  });
});

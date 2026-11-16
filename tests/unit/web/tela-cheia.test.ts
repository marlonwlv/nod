import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVISO_ASSUMA, MS_ASSUMINDO_VISIVEL, MS_PLANO_B, esperaParaReconectar, estadoDaBarra } from "../../../web/lib/computador-pessoa.ts";
import type { AbrirVivo, ClienteVivo } from "../../../web/lib/tela-vivo.ts";
import { abrirTelaCheia, pulsarHalo, telaCheiaAberta } from "../../../web/telas/tela-cheia.ts";

/**
 * Card D, itens 3 e 4: o visualizador em tela cheia num DOM de mentira (o unit não tem jsdom), com os relógios falsos
 * do vitest. A barra de controle (Assistindo / Assumindo… só depois de 300 ms / Você está no controle), o pulso do
 * halo, o VNC também assistindo (viewOnly) e trocado sem reconectar, a reconexão 1/2/4/8 s, o plano B e o fechar.
 */
type Evento = { preventDefault: () => void; target?: unknown; key?: string };
type Ouvinte = (e: Evento) => void;
class El {
  hidden = false;
  className = "";
  textContent: string | null = "";
  type = "";
  offsetWidth = 10;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  ouvintes: Record<string, Ouvinte[]> = {};
  filhos = new Map<string, El>();
  historico: string[] = [];
  classes = new Set<string>();
  trocasDeClasse: string[] = [];
  private html = "";
  classList = {
    toggle: (c: string, v?: boolean) => { if (v ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c); },
    add: (c: string) => { this.classes.add(c); this.trocasDeClasse.push(`+${c}`); },
    remove: (c: string) => { this.classes.delete(c); this.trocasDeClasse.push(`-${c}`); },
  };
  set innerHTML(v: string) { this.html = v; this.historico.push(v); }
  get innerHTML(): string { return this.html; }
  set src(v: string) { this.attrs.src = v; }
  get src(): string { return this.attrs.src ?? ""; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  querySelector(s: string): El { let f = this.filhos.get(s); if (!f) { f = new El(); this.filhos.set(s, f); } return f; }
  addEventListener(tipo: string, fn: Ouvinte): void { (this.ouvintes[tipo] ??= []).push(fn); }
  disparar(tipo: string, extra: Partial<Evento> = {}): { impedido: boolean } {
    let impedido = false;
    for (const fn of this.ouvintes[tipo] ?? []) fn({ preventDefault: () => { impedido = true; }, target: null, ...extra });
    return { impedido };
  }
  /** Um clique num botão com `data-c` (o ouvinte de click lê pelo closest do alvo). */
  clicar(c: string): void { this.disparar("click", { target: { closest: () => ({ dataset: { c } }) } }); }
  replaceChildren(): void {}
  focus(): void { doc.activeElement = this; }
  before(): void {}
  remove(): void {}
  showModal(): void {}
  close(): void { this.disparar("close"); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; }
}

let doc: { activeElement: El | null; hidden: boolean; body: { append: (e: El) => void }; createElement: () => El; querySelector: () => null };
let dialog: El;
const barra = () => dialog.querySelector(".ctc-barra-lugar");
const estadoDaBarraNaTela = () => /data-estado="(\w+)"/.exec(barra().innerHTML)?.[1] ?? null;

type Pendente = { resolver: (v?: unknown) => void; rejeitar: (e: unknown) => void; promessa: Promise<unknown> };
function pendente(): Pendente {
  let resolver!: (v?: unknown) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise((r, j) => { resolver = r; rejeitar = j; });
  return { resolver, rejeitar, promessa };
}
const dto = (controle: "bot" | "pessoa", indisponivelDesde: number | null = null) => ({ ativo: true, disponivel: true, motivo: null, atividade: [], computador: { controle, ocupadoAte: 0, indisponivelDesde } });
/** Só microtarefas: o setTimeout é falso aqui. */
async function esvaziar(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }

function api(controleInicial: "bot" | "pessoa", indisponivelDesde: number | null = null) {
  let controle = controleInicial;
  const chamadas: string[] = [];
  let assumir: Pendente | null = null;
  let ler: Pendente | null = null;
  return {
    chamadas,
    segurarAssumir() { assumir = pendente(); return assumir; },
    segurarLeitura() { ler = pendente(); return ler; },
    computador: vi.fn(async () => { if (ler) { const p = ler; ler = null; await p.promessa; } return dto(controle, indisponivelDesde); }),
    urlVivo: () => "ws://teste/vivo",
    acaoComputador: vi.fn(async () => ({ tela: { imagem: "AA", quadro: "q1" } })),
    configurarComputador: vi.fn(async (_id: string, op: string) => {
      chamadas.push(op);
      if (op === "assumir" && assumir) { const p = assumir; assumir = null; await p.promessa; }
      controle = op === "assumir" ? "pessoa" : "bot";
      return { ok: true };
    }),
  };
}

/** O VNC de mentira: guarda as aberturas, os `soVer` e o fechar; o teste liga e derruba quando quer. */
function vncFalso(o: { liga?: boolean } = {}) {
  const aberturas: Array<{ url: string; soVer: boolean; ligar: () => void; cair: () => void }> = [];
  const soVer: boolean[] = [];
  let fechados = 0;
  const abrir: AbrirVivo = async (p) => {
    aberturas.push({ url: p.url, soVer: p.soVer, ligar: () => p.aoLigar(), cair: () => p.aoCair(null) });
    const c: ClienteVivo = { fechar: () => { fechados++; }, focar: () => undefined, soVer: (v) => { soVer.push(v); } };
    if (o.liga !== false) queueMicrotask(() => p.aoLigar());
    return c;
  };
  return { abrir, aberturas, soVer, fechados: () => fechados };
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = {
    activeElement: null,
    hidden: false,
    body: { append: () => undefined },
    createElement: () => { dialog = new El(); return dialog; },
    querySelector: () => null,
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
});
afterEach(() => {
  if (telaCheiaAberta()) dialog.clicar("fechar");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BOT = { id: "a", nome: "Dev 2" };

describe("barra de controle: Assistindo, Assumindo… (só depois de 300 ms) e Você está no controle", () => {
  it("mostra Fora do ar na barra superior quando o computador cai", async () => {
    abrirTelaCheia(api("bot", Date.now()) as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    expect(dialog.querySelector(".ctc-fora").hidden).toBe(false);
  });

  it("mantém o aviso Fora do ar escondido no estado normal", async () => {
    abrirTelaCheia(api("bot", null) as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    expect(dialog.querySelector(".ctc-fora").hidden).toBe(true);
  });

  it("estadoDaBarra: até 300 ms nada muda; depois Assumindo…; com o controle, Você está no controle", () => {
    expect(estadoDaBarra("bot", null, 1_000)).toBe("assistindo");
    expect(estadoDaBarra("bot", 1_000, 1_000 + MS_ASSUMINDO_VISIVEL - 1)).toBe("assistindo");
    expect(estadoDaBarra("bot", 1_000, 1_000 + MS_ASSUMINDO_VISIVEL)).toBe("assumindo");
    expect(estadoDaBarra("pessoa", 1_000, 1_000 + 5_000)).toBe("controle");
    expect(estadoDaBarra(undefined, null, 0)).toBe("assistindo");
  });

  it("abre em Assistindo; o assumir lento passa por Assumindo… aos 300 ms (botão desabilitado) e chega no controle", async () => {
    const a = api("bot");
    const vnc = vncFalso();
    abrirTelaCheia(a as never, BOT, { vivo: vnc.abrir });
    await esvaziar();
    expect(estadoDaBarraNaTela()).toBe("assistindo");
    const segura = a.segurarAssumir();
    dialog.clicar("assumir");
    await esvaziar();
    vi.advanceTimersByTime(MS_ASSUMINDO_VISIVEL - 1);
    expect(estadoDaBarraNaTela()).toBe("assistindo");
    vi.advanceTimersByTime(1);
    expect(estadoDaBarraNaTela()).toBe("assumindo");
    expect(barra().innerHTML).toMatch(/Assumindo…[\s\S]*disabled/);
    segura.resolver();
    await esvaziar();
    expect(estadoDaBarraNaTela()).toBe("controle");
    expect(barra().innerHTML).toContain("Você está no controle");
    // O servidor já liberou o teclado: o mesmo VNC sai do viewOnly, sem reconectar.
    expect(vnc.soVer.at(-1)).toBe(false);
    expect(vnc.aberturas).toHaveLength(1);
  });

  it("assumir rápido (antes de 300 ms) não mostra Assumindo… nem por um quadro", async () => {
    const a = api("bot");
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    dialog.clicar("assumir");
    await esvaziar();
    vi.advanceTimersByTime(1_000);
    expect(barra().historico.some((h) => h.includes('data-estado="assumindo"'))).toBe(false);
    expect(estadoDaBarraNaTela()).toBe("controle");
  });

  it("Parar troca a barra na hora (antes da resposta) e volta o VNC ao viewOnly", async () => {
    const a = api("pessoa");
    const vnc = vncFalso();
    abrirTelaCheia(a as never, BOT, { vivo: vnc.abrir });
    await esvaziar();
    expect(estadoDaBarraNaTela()).toBe("controle");
    expect(vnc.aberturas[0]).toMatchObject({ soVer: false });
    dialog.clicar("devolver");
    expect(estadoDaBarraNaTela()).toBe("assistindo");
    expect(vnc.soVer.at(-1)).toBe(true);
    await esvaziar();
    expect(a.chamadas).toEqual(["devolver"]);
  });

  it("o assumir que falha volta a Assistindo", async () => {
    const a = api("bot");
    const segura = a.segurarAssumir();
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    dialog.clicar("assumir");
    vi.advanceTimersByTime(MS_ASSUMINDO_VISIVEL);
    expect(estadoDaBarraNaTela()).toBe("assumindo");
    segura.rejeitar(new Error("409"));
    await esvaziar();
    expect(estadoDaBarraNaTela()).toBe("assistindo");
  });
});

describe("clique na tela assistindo: o halo pulsa e o leitor de tela ouve o aviso", () => {
  it("pulsa uma vez; um clique novo durante o pulso reinicia (tira e põe a classe)", async () => {
    const a = api("bot");
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir, menosMovimento: () => false });
    await esvaziar();
    const quadro = dialog.querySelector(".ctc-quadro");
    const botao = dialog.querySelector(".ctc-assumir");
    const aviso = dialog.querySelector(".ctc-aviso");
    expect(quadro.disparar("pointerdown").impedido).toBe(true);
    expect(botao.classes.has("pulsando")).toBe(true);
    expect(aviso.textContent?.trim()).toBe(AVISO_ASSUMA);
    vi.advanceTimersByTime(1_000);
    quadro.disparar("pointerdown");
    expect(botao.trocasDeClasse).toEqual(["-pulsando", "+pulsando", "-pulsando", "+pulsando"]);
    // O aviso muda a cada clique (senão o leitor de tela não relê).
    expect(aviso.textContent?.trim()).toBe(AVISO_ASSUMA);
  });

  it("com prefers-reduced-motion: sem pulso, só o aviso", () => {
    const botao = { classList: { add: vi.fn(), remove: vi.fn() }, offsetWidth: 1 };
    const aviso = { textContent: "" as string | null };
    expect(pulsarHalo(botao, aviso, true)).toBe(false);
    expect(botao.classList.add).not.toHaveBeenCalled();
    expect(aviso.textContent).toBe(AVISO_ASSUMA);
  });

  it("no controle o clique é do site: nada de pulso", async () => {
    const a = api("pessoa");
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir, menosMovimento: () => false });
    await esvaziar();
    expect(dialog.querySelector(".ctc-quadro").disparar("pointerdown").impedido).toBe(false);
    expect(dialog.querySelector(".ctc-assumir").classes.has("pulsando")).toBe(false);
  });
});

describe("ao vivo: VNC também assistindo, reconexão e plano B", () => {
  it("abre o VNC em modo assistir (viewOnly) e fecha o socket ao fechar a tela", async () => {
    const a = api("bot");
    const vnc = vncFalso();
    abrirTelaCheia(a as never, BOT, { vivo: vnc.abrir });
    await esvaziar();
    expect(vnc.aberturas).toEqual([expect.objectContaining({ url: "ws://teste/vivo?modo=assistir", soVer: true })]);
    expect(dialog.dataset.fase).toBe("vendo");
    dialog.clicar("fechar");
    expect(vnc.fechados()).toBe(1);
    expect(telaCheiaAberta()).toBeNull();
  });

  it("o VNC cai: Reconectando e novas tentativas em 1, 2, 4 e 8 s; depois de 30 s, capturas de 2 s; voltou, para", async () => {
    const a = api("bot");
    const vnc = vncFalso({ liga: false });
    abrirTelaCheia(a as never, BOT, { vivo: vnc.abrir });
    await esvaziar();
    vnc.aberturas[0]!.ligar();
    a.acaoComputador.mockClear();
    vnc.aberturas[0]!.cair();
    expect(dialog.dataset.fase).toBe("reconectando");
    for (const espera of [1_000, 2_000, 4_000, 8_000]) {
      const antes = vnc.aberturas.length;
      vi.advanceTimersByTime(espera - 1);
      await esvaziar();
      expect(vnc.aberturas.length).toBe(antes);
      vi.advanceTimersByTime(1);
      await esvaziar();
      expect(vnc.aberturas.length).toBe(antes + 1);
      vnc.aberturas.at(-1)!.cair();
    }
    expect(a.acaoComputador).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MS_PLANO_B - 15_000);
    await esvaziar();
    expect(a.acaoComputador).toHaveBeenCalledWith("a", { tipo: "observar" });
    const capturas = a.acaoComputador.mock.calls.length;
    vi.advanceTimersByTime(2_000);
    await esvaziar();
    expect(a.acaoComputador.mock.calls.length).toBeGreaterThan(capturas);
    // O VNC voltou: some o plano B.
    vnc.aberturas.at(-1)!.ligar();
    const depois = a.acaoComputador.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    await esvaziar();
    expect(a.acaoComputador.mock.calls.length).toBe(depois);
    expect(dialog.dataset.fase).toBe("vendo");
  });

  it("esperaParaReconectar: 1, 2, 4, 8 s e fica nos 8", () => {
    expect([0, 1, 2, 3, 4, 9].map(esperaParaReconectar)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  });
});

describe("fechar: só pelo botão; Esc não fecha; no controle devolve", () => {
  it("Esc não fecha (nem o keydown nem o cancel); o botão fecha", async () => {
    const a = api("pessoa");
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    expect(dialog.disparar("keydown", { key: "Escape" }).impedido).toBe(true);
    expect(dialog.disparar("keydown", { key: "a" }).impedido).toBe(false);
    expect(dialog.disparar("cancel").impedido).toBe(true);
    expect(telaCheiaAberta()).toBe("a");
  });

  it("fechar com a pessoa no controle devolve; assistindo não mexe no controle", async () => {
    const a = api("pessoa");
    const fechou = vi.fn();
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir, aoFechar: fechou });
    await esvaziar();
    dialog.clicar("fechar");
    await esvaziar();
    expect(a.chamadas).toEqual(["devolver"]);
    expect(fechou).toHaveBeenCalledOnce();
    const b = api("bot");
    abrirTelaCheia(b as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    dialog.clicar("fechar");
    await esvaziar();
    expect(b.chamadas).toEqual([]);
  });

  it("fechar durante o assumir devolve quando o assumir termina, nunca antes", async () => {
    const a = api("bot");
    abrirTelaCheia(a as never, BOT, { vivo: vncFalso().abrir });
    await esvaziar();
    const segura = a.segurarAssumir();
    dialog.clicar("assumir");
    await esvaziar();
    dialog.clicar("fechar");
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir"]);
    segura.resolver();
    await esvaziar();
    expect(a.chamadas).toEqual(["assumir", "devolver"]);
  });

  it("aberta pelo pedido de ajuda (já no controle) e fechada antes da primeira leitura: nem assume", async () => {
    const a = api("bot");
    const leitura = a.segurarLeitura();
    abrirTelaCheia(a as never, BOT, { assumir: true, vivo: vncFalso().abrir });
    await esvaziar();
    dialog.clicar("fechar");
    leitura.resolver();
    await esvaziar();
    expect(a.chamadas).toEqual([]);
  });

  it("o controle sai da pessoa por fora (mensagem nova ao bot): a barra volta a Assistindo e o VNC ao viewOnly", async () => {
    const a = api("pessoa");
    const vnc = vncFalso();
    abrirTelaCheia(a as never, BOT, { vivo: vnc.abrir });
    await esvaziar();
    a.computador.mockImplementation(async () => dto("bot"));
    vi.advanceTimersByTime(2_000);
    await esvaziar();
    expect(estadoDaBarraNaTela()).toBe("assistindo");
    expect(vnc.soVer.at(-1)).toBe(true);
  });
});

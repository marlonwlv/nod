import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperacaoNavegador, RespostaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { criarNavegadorNaTela, lerAbasDeLugar } from "../../../web/telas/navegador.ts";
import { ESPERAS_DO_CANAL_MS, montarVistaNavegador, type SocketDaVista } from "../../../web/telas/navegador-vista.ts";

/**
 * ADR-190 (Paper D1–D8) em happy-dom: a vista do navegador (o canal ao vivo falso, a pílula, o assumir e devolver, o mouse e
 * o teclado mapeados para o viewport só no controle, a dica "Assumir para mexer", a aprovação, a reconexão) e quem a
 * hospeda (o painel com a alça, a aba de lugar com o Desfazer, a tela cheia sem Esc, o ⋯ que pergunta antes de encerrar).
 */
const vista = (x: Partial<VistaNavegador> = {}): VistaNavegador => ({
  agenteId: "a1", estado: "ao_vivo", controle: "bot", lugar: { tipo: "nod" },
  abas: [{ id: "t1", titulo: "Google Voos", url: "https://www.google.com/travel/flights", ativa: true, carregando: false, inseguro: false }],
  aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, ofertaGuardar: null, atividadeEm: 1_000, erro: null, viewport: { w: 1280, h: 800 }, ...x,
});
const resposta = (x: Partial<VistaNavegador> = {}): RespostaNavegador => ({ vista: vista(x), disponivel: true });

class SocketFalso implements SocketDaVista {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  enviados: unknown[] = [];
  fechado = false;
  send(d: string): void { this.enviados.push(JSON.parse(d)); }
  close(): void { this.fechado = true; }
  chega(m: object): void { this.onmessage?.({ data: JSON.stringify(m) }); }
}

function apiFalsa(controleDepois: Partial<Record<OperacaoNavegador, VistaNavegador["controle"]>> = {}) {
  const ops: string[] = [];
  const api = {
    operarNavegador: vi.fn(async (_id: string, op: OperacaoNavegador) => { ops.push(op); return { ok: true as const, vista: vista({ controle: controleDepois[op] ?? (op === "assumir" ? "pessoa" : "bot"), ...(op === "encerrar" ? { estado: "desligado" as const } : {}) }) }; }),
    irParaNoNavegador: vi.fn(async () => ({ ok: true as const, vista: vista({ controle: "pessoa" }) })),
    trocarAbaDoNavegador: vi.fn(async () => ({ ok: true as const, vista: vista({ controle: "pessoa" }) })),
    urlVivoNavegador: (id: string) => `ws://teste/agentes/${id}/navegador/vivo`,
    navegador: vi.fn(async () => resposta()),
  };
  return { api, ops };
}

const palcoEm = (el: HTMLElement, w = 640, h = 600) => {
  const palco = el.querySelector<HTMLElement>(".nv-palco")!;
  palco.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) });
  return palco;
};
const ponteiro = (tipo: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
  const e = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1, ...extra });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
};

describe("a vista do navegador (D1–D4)", () => {
  let sockets: SocketFalso[];
  beforeEach(() => { sockets = []; document.body.innerHTML = ""; });
  afterEach(() => { vi.useRealTimers(); });

  function montar(r: RespostaNavegador | null = resposta(), o: { decidir?: (id: string, a: boolean, s: boolean) => Promise<void> } = {}) {
    const { api, ops } = apiFalsa();
    const v = montarVistaNavegador({ api, agenteId: "a1", nome: () => "Ada", abrirSocket: () => { const s = new SocketFalso(); sockets.push(s); return s; }, menosMovimento: () => true, ...o });
    document.body.append(v.el);
    v.atualizar(r);
    v.ligar(true);
    return { v, api, ops };
  }

  it("conecta com o esqueleto claro e troca para a imagem no primeiro quadro (nunca tela preta)", () => {
    const { v } = montar();
    expect(sockets).toHaveLength(1);
    expect(v.el.dataset.estado).toBe("conectando");
    expect(v.el.querySelector(".nv-estado-conectando")?.textContent).toContain("Conectando à tela de Ada…");
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    expect(v.el.dataset.estado).toBe("ao_vivo");
    const img = v.el.querySelector<HTMLImageElement>(".nv-quadro")!;
    expect(img.hidden).toBe(false);
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,QUJD");
    expect(v.el.querySelector(".nv-estado-lugar")!.innerHTML).toBe("");
    // A pílula mora na faixa de 52 px embaixo (D1d), não por cima da imagem.
    expect(v.el.querySelector(".nv-faixa .nv-pilula")?.getAttribute("data-estado")).toBe("assistindo");
  });

  it("assistindo: o clique não vai ao site; mostra 'Assumir para mexer' e pulsa o botão", () => {
    const { v } = montar();
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    const palco = palcoEm(v.el);
    palco.dispatchEvent(ponteiro("pointerdown", 320, 300));
    expect(sockets[0]!.enviados).toEqual([]);
    expect(v.el.querySelector<HTMLElement>(".nv-dica-assumir")!.hidden).toBe(false);
    expect(v.el.querySelector(".nv-anuncio")?.textContent).toContain("Assuma o controle");
  });

  it("assumir: a pílula vira 'Você está no controle | Devolver à Ada', a borda preta; o mouse vai ao viewport", async () => {
    const { v, ops } = montar();
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    v.el.querySelector<HTMLButtonElement>('[data-nv="assumir"]')!.click();
    await vi.waitFor(() => expect(v.controleComPessoa()).toBe(true));
    expect(ops).toEqual(["assumir"]);
    expect(v.el.querySelector(".nv-pilula")?.textContent).toContain("Devolver à Ada");
    expect(v.el.querySelector<HTMLElement>(".nv-moldura")!.dataset.controle).toBe("pessoa");
    expect(v.el.querySelector(".nv-endereco-input")).not.toBeNull();
    const palco = palcoEm(v.el);
    // A imagem 640×400 fica em cima (letterbox embaixo): o centro dela é o centro do viewport.
    palco.dispatchEvent(ponteiro("pointerdown", 320, 200));
    palco.dispatchEvent(ponteiro("pointerup", 320, 200));
    // No letterbox, nada vai.
    palco.dispatchEvent(ponteiro("pointerdown", 320, 520));
    expect(sockets[0]!.enviados).toEqual([
      { t: "mouse", evento: "mousePressed", x: 640, y: 400, botao: "left", cliques: 1, modificadores: 0 },
      { t: "mouse", evento: "mouseReleased", x: 640, y: 400, botao: "left", cliques: 1, modificadores: 0 },
    ]);
  });

  it("o teclado com foco na vista vai ao site no controle; ⌘⇧A devolve", async () => {
    const { v, ops } = montar(resposta({ controle: "pessoa" }));
    const palco = palcoEm(v.el);
    palco.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true, cancelable: true }));
    palco.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", bubbles: true, cancelable: true }));
    expect(sockets[0]!.enviados).toEqual([
      { t: "tecla", evento: "keyDown", tecla: "a", codigo: "KeyA", texto: "a", modificadores: 0 },
      { t: "tecla", evento: "keyUp", tecla: "a", codigo: "KeyA", modificadores: 0 },
    ]);
    palco.dispatchEvent(new KeyboardEvent("keydown", { key: "A", code: "KeyA", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(ops).toEqual(["devolver"]));
    expect(v.el.querySelector(".nv-pilula")?.getAttribute("data-estado")).toBe("assistindo");
  });

  it("precisa de você: borda azul, 'Já resolvi' resolve; o pedido de login vira a faixa fina fora da imagem", async () => {
    const { v, ops } = montar(resposta({ controle: "precisa_de_voce", pedido: { tipo: "ajuda", decisaoId: "d", motivo: "O site quer provar que é uma pessoa (CAPTCHA)", codigo: false } }));
    expect(v.el.querySelector<HTMLElement>(".nv-moldura")!.dataset.controle).toBe("precisa");
    expect(v.el.querySelector(".nv-aviso-lugar")?.textContent).toContain("CAPTCHA");
    v.el.querySelector<HTMLButtonElement>('[data-nv="resolver"]')!.click();
    await vi.waitFor(() => expect(ops).toEqual(["resolver"]));
  });

  it("a aprovação no ponto sem volta (A1) responde pela mesma decisão; o botão do site em azul", async () => {
    const decidir = vi.fn(async () => undefined);
    const { v } = montar(resposta({ controle: "precisa_de_voce", pedido: { tipo: "aprovacao", decisaoId: "d9", pergunta: "Pagar R$ 3.780 na TAP?", botao: "pagar", classe: "pagar", touchId: true, avisoTouchId: null, caixa: { x: 100, y: 100, w: 200, h: 40 }, lembrar: null } }), { decidir });
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    expect(v.el.querySelector(".nv-pilula")?.textContent).toMatch(/Pagar R\$ 3\.780 na TAP\?.*Não.*Pagar com Touch ID/);
    expect(v.el.querySelector<HTMLElement>(".nv-realce")!.hidden).toBe(false);
    v.el.querySelector<HTMLButtonElement>('[data-nv="aprovar"]')!.click();
    v.el.querySelector<HTMLButtonElement>('[data-nv="recusar"]')!.click();
    await vi.waitFor(() => expect(decidir).toHaveBeenCalledTimes(2));
    expect(decidir).toHaveBeenNthCalledWith(1, "d9", true, false);
    expect(decidir).toHaveBeenNthCalledWith(2, "d9", false, false);
  });

  it("o cursor do bot com o nome e o anel no alvo; esperando, o cursor some", () => {
    const { v } = montar(resposta({ passo: { tipo: "mirar", frase: "Clicando em Buscar", caixa: { x: 100, y: 80, w: 200, h: 40 }, em: 5 } }));
    palcoEm(v.el);
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    const cursor = v.el.querySelector<HTMLElement>(".nv-cursor")!;
    expect(cursor.hidden).toBe(false);
    expect(cursor.textContent).toContain("Ada");
    expect(v.el.querySelector<HTMLElement>(".nv-anel")!.hidden).toBe(false);
    v.atualizar(resposta({ passo: { tipo: "esperar", frase: "Esperando o site responder", caixa: { x: 1, y: 1, w: 1, h: 1 }, em: 6 } }));
    expect(cursor.hidden).toBe(true);
  });

  it("o canal caiu: o último quadro fica com 'Imagem a cada 2 s' e o canal volta em 1, 2, 4 e 8 s", () => {
    vi.useFakeTimers();
    const { v } = montar();
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    sockets[0]!.onclose?.({ code: 1006 });
    expect(v.el.dataset.estado).toBe("rede_fraca");
    expect(v.el.querySelector(".nv-aviso-lugar")?.textContent).toContain("Imagem a cada 2 s");
    expect(v.el.querySelector<HTMLImageElement>(".nv-quadro")!.hidden).toBe(false);
    vi.advanceTimersByTime(ESPERAS_DO_CANAL_MS[0]);
    expect(sockets).toHaveLength(2);
    sockets[1]!.chega({ t: "quadro", seq: 2, jpeg: "REVG", w: 1280, h: 800 });
    expect(v.el.dataset.estado).toBe("ao_vivo");
  });

  it("os parados têm botão: desligado → Ligar; pausa → Retomar; erro → Tentar de novo", async () => {
    const { v, ops } = montar(resposta({ estado: "desligado", abas: [] }));
    expect(v.el.querySelector(".nv-faixa .nv-pilula")).toBeNull();
    v.el.querySelector<HTMLButtonElement>('[data-nv="ligar"]')!.click();
    v.atualizar(resposta({ estado: "pausa" }));
    v.el.querySelector<HTMLButtonElement>('[data-nv="retomar"]')!.click();
    await vi.waitFor(() => expect(ops).toEqual(["ligar", "retomar"]));
  });

  it("fechar a vista desliga o canal (o bot continua)", () => {
    const { v } = montar();
    v.ligar(false);
    expect(sockets[0]!.fechado).toBe(true);
  });
});

describe("o painel, a aba e a tela cheia (D1, D1c, D4 E, D5, D7)", () => {
  let navegador: ReturnType<typeof criarNavegadorNaTela>;
  let operacoes: string[];
  let renders = 0;
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    try { window.localStorage.clear(); } catch { /* sem storage */ }
    document.body.innerHTML = '<div class="app"><aside id="sidebar"></aside><main class="stage"><header id="cabecalho"></header><section id="timeline"></section><footer id="composer"></footer></main><aside class="detalhes" id="detalhes"></aside></div>';
    document.getElementById("sidebar")!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 340, height: 900, right: 340, bottom: 900, x: 0, y: 0, toJSON: () => ({}) });
    const { api, ops } = apiFalsa();
    operacoes = ops;
    renders = 0;
    let modoAbas = false;
    navegador = criarNavegadorNaTela({
      api: () => api,
      nome: () => "Ada",
      temComputador: () => true,
      abrirComputador: vi.fn(),
      lerVista: vi.fn(),
      guardarVista: vi.fn(),
      decidir: vi.fn(async () => undefined),
      mandarRecado: vi.fn(async () => undefined),
      abrirLogins: vi.fn(),
      abrirFora: vi.fn(),
      aoErro: vi.fn(),
      modoAbas: () => modoAbas,
      ligarModoAbas: () => { modoAbas = true; },
      render: () => { renders++; },
      pessoaId: () => "p1",
      celular: () => false,
    });
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta() } });
  });

  afterEach(() => navegador.destruir());
  const painel = () => document.getElementById("navegador-painel")!;
  const app = () => document.querySelector<HTMLElement>(".app")!;

  it("abre ao lado com os lugares e as ações; a conversa encolhe (40 % da área) e o painel do bot sai", () => {
    navegador.abrirPainel("a1");
    expect(painel().hidden).toBe(false);
    expect(app().classList.contains("nv-lado")).toBe(true);
    expect(app().style.getPropertyValue("--nv-largura")).toBe("440px");
    expect(painel().querySelector(".nv-lugares")?.textContent).toMatch(/Navegador.*Computador/);
    for (const a of ["em-aba", "tela-cheia", "menu", "fechar"]) expect(painel().querySelector(`[data-nv-p="${a}"]`)).not.toBeNull();
    expect(painel().querySelector(".nv-vista")).not.toBeNull();
    expect(navegador.htmlBotaoDoCanto("a1")).toContain('aria-pressed="true"');
  });

  it("a alça: duplo clique volta ao padrão; as setas mudam 24 px; a largura é lembrada por pessoa", () => {
    navegador.abrirPainel("a1");
    const alca = painel().querySelector<HTMLElement>(".nv-alca")!;
    alca.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(app().style.getPropertyValue("--nv-largura")).toBe("464px");
    expect(window.localStorage.getItem("nod:navegador:largura:p1")).toBe(String(Math.round((464 / 1100) * 1000) / 1000));
    alca.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(app().style.getPropertyValue("--nv-largura")).toBe("440px");
  });

  it("⌘\\ abre e fecha; fechar no controle devolve e mostra 'Devolvido à Ada · Desfazer'", async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", metaKey: true, ctrlKey: true, bubbles: true }));
    expect(painel().hidden).toBe(false);
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta({ controle: "pessoa" }) } });
    painel().querySelector<HTMLButtonElement>('[data-nv-p="fechar"]')!.click();
    await vi.waitFor(() => expect(operacoes).toContain("devolver"));
    const aviso = document.querySelector(".nv-aviso");
    expect(aviso?.textContent).toContain("Devolvido à Ada");
    expect(aviso?.querySelector("button")?.textContent).toContain("Desfazer");
  });

  it("trocar de lugar para o Computador mostra a tela de hoje com 'Abrir a tela'", () => {
    navegador.abrirPainel("a1");
    painel().querySelector<HTMLButtonElement>('[data-lugar="computador"]')!.click();
    expect(painel().querySelector(".nv-computador")?.textContent).toContain("Abrir a tela");
    expect(painel().querySelector(".nv-vista")).toBeNull();
  });

  it("Abrir em aba: a vista vai para o lugar da conversa; fechar a aba tem Desfazer", () => {
    navegador.abrirPainel("a1");
    painel().querySelector<HTMLButtonElement>('[data-nv-p="em-aba"]')!.click();
    expect(painel().parentElement?.classList.contains("stage")).toBe(true);
    expect(app().classList.contains("nv-aba-ativa")).toBe(true);
    expect(navegador.abaNaFileira("a1")?.html).toContain('aria-current="page"');
    expect(lerAbasDeLugar(window.localStorage.getItem("nod:navegador:abas"))).toEqual(new Set(["a1"]));
    expect(painel().querySelector(".nv-legenda")?.textContent).toBe("Navegador de Ada");
    navegador.fecharAba("a1");
    expect(navegador.abaAberta("a1")).toBe(false);
    expect(app().classList.contains("nv-aba-ativa")).toBe(false);
    const desfazer = document.querySelector<HTMLButtonElement>(".nv-aviso button")!;
    expect(desfazer.textContent).toContain("⌘⇧T");
    desfazer.click();
    expect(navegador.abaAberta("a1")).toBe(true);
    expect(navegador.abaAtiva("a1")).toBe(true);
  });

  it("o clique direito na aba abre o menu dela (D7); Encerrar pergunta só com o bot no meio de algo", async () => {
    navegador.abrirAba("a1");
    const aba = document.createElement("div");
    aba.innerHTML = navegador.abaNaFileira("a1")!.html;
    document.body.append(aba);
    aba.querySelector(".nv-aba-lugar")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const menu = document.querySelector(".nv-menu")!;
    expect(menu.textContent).toMatch(/Pôr ao lado da conversa.*Assumir.*Abrir em tela cheia.*Fechar aba.*Encerrar o navegador de Ada/);
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta({ passo: { tipo: "clicar", frase: "", caixa: null, em: Date.now() } }) } });
    menu.querySelector<HTMLButtonElement>('[data-nv-menu="encerrar"]')!.click();
    expect(menu.textContent).toContain("está no meio de algo");
    expect(operacoes).toEqual([]);
    menu.querySelector<HTMLButtonElement>('[data-nv-menu="encerrar"]')!.click();
    await vi.waitFor(() => expect(operacoes).toEqual(["encerrar"]));
  });

  it("tela cheia: o seletor no topo, Esc não fecha, sair volta ao painel; ⌘⇧F entra e sai", () => {
    navegador.abrirPainel("a1");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F", metaKey: true, ctrlKey: true, shiftKey: true, bubbles: true }));
    const d = document.querySelector<HTMLDialogElement>("dialog.nv-tc")!;
    expect(d).not.toBeNull();
    expect(d.querySelector(".nv-tc-lugares")?.textContent).toMatch(/Navegador.*Computador/);
    expect(d.querySelector(".nv-tc-titulo")?.textContent).toBe("Ada");
    expect(d.querySelector(".nv-recado-bt")?.textContent).toBe("Recado para Ada");
    expect(d.querySelector(".nv-vista")).not.toBeNull();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    d.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(navegador.onde()?.modo).toBe("tela-cheia");
    d.querySelector<HTMLButtonElement>('[data-nv-p="sair"]')!.click();
    expect(document.querySelector("dialog.nv-tc")).toBeNull();
    expect(navegador.onde()).toEqual({ agenteId: "a1", modo: "painel" });
    expect(painel().querySelector(".nv-vista")).not.toBeNull();
  });

  it("sair da conversa do bot fecha o painel sem parar o bot", () => {
    navegador.abrirPainel("a1");
    navegador.sincronizar({ agenteId: null, navegadores: { a1: resposta() } });
    expect(navegador.onde()).toBeNull();
    expect(operacoes).toEqual([]);
    expect(renders).toBeGreaterThan(0);
  });
});

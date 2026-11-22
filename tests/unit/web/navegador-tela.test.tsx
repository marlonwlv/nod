import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperacaoNavegador, RespostaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { SELETOR_MODAL } from "../../../web/lib/atalhos.ts";
import { criarNavegadorNaTela, lerAbasDeLugar, MS_RELOGIO_GRAVACAO } from "../../../web/telas/navegador.ts";
import { ESPERAS_DO_CANAL_MS, montarVistaNavegador, MS_CRUZAR_PILULA, type SocketDaVista } from "../../../web/telas/navegador-vista.ts";

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

  function montar(r: RespostaNavegador | null = resposta(), o: { decidir?: (id: string, a: boolean, s: boolean) => Promise<void>; menosMovimento?: () => boolean; entrarEuMesmo?: (a: string, d: string) => Promise<VistaNavegador | null> } = {}) {
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
    expect(v.el.querySelector(".nv-estado-conectando")?.textContent).toContain("Conectando à tela da Ada…");
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

  it("login esperando a pessoa: tocar a tela é o 'Entrar eu mesmo' e o mesmo toque chega ao site", async () => {
    const login = { tipo: "login" as const, decisaoId: "d1", site: "accounts.google.com", motivo: "", opcoes: [], podeTrazerDoChrome: false, etapa: "escolher" as const, erro: null };
    const entrarEuMesmo = vi.fn(async () => vista({ controle: "pessoa", pedido: { ...login, etapa: "eu_mesmo" } }));
    const { v } = montar(resposta({ controle: "precisa_de_voce", pedido: login }), { entrarEuMesmo });
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    palcoEm(v.el).dispatchEvent(ponteiro("pointerdown", 320, 300));
    await vi.waitFor(() => expect(v.controleComPessoa()).toBe(true));
    expect(entrarEuMesmo).toHaveBeenCalledWith("a1", "d1");
    expect(v.el.querySelector<HTMLElement>(".nv-dica-assumir")!.hidden).toBe(true);
    expect(sockets[0]!.enviados.map((m) => (m as { evento?: string }).evento)).toEqual(["mousePressed", "mouseReleased"]);
    expect(document.activeElement).toBe(v.el.querySelector(".nv-palco"));
  });

  it("precisa de você (captcha): tocar a tela assume direto, sem a dica", async () => {
    const { v, ops } = montar(resposta({ controle: "precisa_de_voce" }));
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 800 });
    palcoEm(v.el).dispatchEvent(ponteiro("pointerdown", 320, 300));
    await vi.waitFor(() => expect(v.controleComPessoa()).toBe(true));
    expect(ops).toEqual(["assumir"]);
    expect(sockets[0]!.enviados).toHaveLength(2);
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

  it("o clique segue o tamanho do QUADRO quando a vista diz outro viewport (o 1280×633 real contra o 1280×800 padrão)", async () => {
    const { v } = montar();
    sockets[0]!.chega({ t: "quadro", seq: 1, jpeg: "QUJD", w: 1280, h: 640 });
    v.el.querySelector<HTMLButtonElement>('[data-nv="assumir"]')!.click();
    await vi.waitFor(() => expect(v.controleComPessoa()).toBe(true));
    // Palco baixo (640×200): o quadro 1280×640 vira 400×200 centrado (pela vista, 1280×800, seria 320×200 e o y sairia 400).
    const palco = palcoEm(v.el, 640, 200);
    palco.dispatchEvent(ponteiro("pointerdown", 320, 100));
    expect(sockets[0]!.enviados.at(-1)).toMatchObject({ evento: "mousePressed", x: 640, y: 320 });
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

  it("D8: assumir e devolver trocam o texto da pílula em fade cruzado de 180 ms; a velha não recebe clique nem leitor", () => {
    vi.useFakeTimers();
    const { v } = montar(resposta(), { menosMovimento: () => false });
    expect(v.el.querySelector(".nv-pilula")?.getAttribute("data-estado")).toBe("assistindo");
    v.atualizar(resposta({ controle: "pessoa" }));
    const sai = v.el.querySelector<HTMLElement>(".nv-pilula-sai")!;
    expect(sai.dataset.estado).toBe("assistindo");
    expect(sai.getAttribute("aria-hidden")).toBe("true");
    expect(sai.inert).toBe(true);
    expect(sai.hasAttribute("role")).toBe(false);
    const entra = v.el.querySelector<HTMLElement>(".nv-pilula:not(.nv-pilula-sai)")!;
    expect(entra.dataset.estado).toBe("controle");
    expect(entra.classList.contains("nv-pilula-entra")).toBe(true);
    vi.advanceTimersByTime(MS_CRUZAR_PILULA);
    expect(v.el.querySelector(".nv-pilula-sai")).toBeNull();
    expect(v.el.querySelectorAll(".nv-pilula")).toHaveLength(1);
    expect(entra.classList.contains("nv-pilula-entra")).toBe(false);
    // Login e aprovação são outra pergunta: troca seca.
    v.atualizar(resposta({ controle: "precisa_de_voce", pedido: { tipo: "login", decisaoId: "d", site: "itau.com.br", motivo: "", opcoes: [], podeTrazerDoChrome: false, etapa: "eu_mesmo", erro: null } }));
    expect(v.el.querySelector(".nv-pilula-sai")).toBeNull();
  });

  it("D8 com movimento reduzido: a troca da pílula é seca", () => {
    const { v } = montar();
    v.atualizar(resposta({ controle: "pessoa" }));
    expect(v.el.querySelector(".nv-pilula-sai")).toBeNull();
    expect(v.el.querySelectorAll(".nv-pilula")).toHaveLength(1);
  });

  it("achado 10: o pedido de ajuda vira a faixa só com o motivo; a ação é a da pílula", () => {
    // O pedido de ajuda já entrega o navegador (2026-11-21): controle "pessoa", a faixa com o motivo e a pílula
    // "Precisa de você · Já resolvi", sem "Assumir".
    const { v } = montar(resposta({ controle: "pessoa", pedido: { tipo: "ajuda", decisaoId: "d", motivo: "O site quer provar que é uma pessoa (CAPTCHA)", codigo: false } }));
    const faixa = v.el.querySelector(".nv-aviso-site")!;
    expect(faixa.textContent).toContain("O site quer provar que é uma pessoa (CAPTCHA)");
    expect(faixa.querySelector("button")).toBeNull();
    expect(v.el.querySelector(".nv-pilula")?.textContent).toContain("Precisa de você");
    expect(v.el.querySelector(".nv-pilula")?.textContent).toContain("Já resolvi");
    expect(v.el.querySelector(".nv-pilula")?.textContent).not.toContain("Assumir o controle");
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

  it("com a folha do celular fechada nada casa com SELETOR_MODAL (senão os atalhos ⌘B e ⌘, param; CI de 2026-11-20)", () => {
    navegador.abrirPainel("a1");
    expect(document.querySelector(SELETOR_MODAL)).toBeNull();
  });

  // 2026-11-22 (pedido do dono): a coluna da direita é uma pilha — o painel do bot recolhe o navegador e, ao fechar, ele volta.
  it("o painel do bot recolhe o navegador aberto ao lado; ao fechar, o navegador volta (só o do mesmo bot)", () => {
    expect(navegador.recolherParaOPainelDoBot()).toBeNull();
    navegador.abrirPainel("a1");
    expect(navegador.recolherParaOPainelDoBot()).toEqual(expect.any(Number));
    expect(navegador.painelAberto("a1")).toBe(false);
    expect(navegador.voltarDoPainelDoBot("a2")).toBe(false);
    expect(navegador.painelAberto("a1")).toBe(false);
    navegador.abrirPainel("a1");
    navegador.recolherParaOPainelDoBot();
    expect(navegador.voltarDoPainelDoBot("a1")).toBe(true);
    expect(navegador.painelAberto("a1")).toBe(true);
    // Abrir o navegador à mão esquece o recolhido: fechar o painel do bot depois não reabre nada.
    navegador.recolherParaOPainelDoBot();
    navegador.abrirPainel("a1");
    expect(navegador.voltarDoPainelDoBot("a1")).toBe(false);
  });

  // 2026-11-22 (teste do dono): da conversa do Chico para a da Ada com o painel aberto, os dois navegadores empilhavam.
  it("trocar de bot com o painel aberto deixa só a vista do bot novo", () => {
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta(), a2: resposta() } });
    navegador.abrirPainel("a1");
    expect(painel().querySelectorAll(".nv-vista")).toHaveLength(1);
    navegador.abrirPainel("a2");
    expect(painel().querySelectorAll(".nv-vista")).toHaveLength(1);
  });

  it("abre ao lado com os lugares e as ações; a conversa encolhe (40 % da área) e o painel do bot sai", () => {
    navegador.abrirPainel("a1");
    expect(painel().hidden).toBe(false);
    expect(app().classList.contains("nv-lado")).toBe(true);
    expect(app().style.getPropertyValue("--nv-largura")).toBe("440px");
    expect(painel().querySelector(".nv-lugares")?.textContent).toMatch(/Navegador.*Computador/);
    for (const a of ["em-aba", "tela-cheia", "menu", "fechar"]) expect(painel().querySelector(`[data-nv-p="${a}"]`)).not.toBeNull();
    expect(painel().querySelector(".nv-vista")).not.toBeNull();
    // C1 e 1a (Paper): com o painel aberto o botão do canto sai do cabeçalho; fechado, ele volta.
    expect(navegador.htmlBotaoDoCanto("a1")).toBe("");
    navegador.fechar();
    expect(navegador.htmlBotaoDoCanto("a1")).toContain('aria-pressed="false"');
  });

  it("D8 com Reduzir movimento: trocar de lugar faz fade de 100 ms (Paper), não um corte", () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    const original = HTMLElement.prototype.animate;
    const animar = vi.fn(() => ({ cancel() {}, onfinish: null }) as unknown as Animation);
    HTMLElement.prototype.animate = animar as unknown as typeof HTMLElement.prototype.animate;
    try {
      navegador.abrirPainel("a1");
      animar.mockClear();
      painel().querySelector<HTMLElement>('[data-lugar="computador"]')!.click();
      expect(animar).toHaveBeenCalledWith([{ opacity: 0.2 }, { opacity: 1 }], { duration: 100, easing: "linear" });
      // O aviso com Desfazer (5d) entra em fade de 100 ms (Paper XMD-0).
      animar.mockClear();
      navegador.abrirAba("a1");
      navegador.fecharAba("a1");
      expect(animar).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: "linear" });
      document.querySelector(".nv-aviso")?.remove();
    } finally {
      HTMLElement.prototype.animate = original;
      window.matchMedia = mm;
    }
  });

  it("D5: com a conversa abaixo de 600 px a app ganha nv-conversa-estreita (o seletor de IA fica só com o anel)", () => {
    navegador.abrirPainel("a1");
    expect(app().classList.contains("nv-conversa-estreita")).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true, ctrlKey: true, altKey: true, bubbles: true }));
    expect(app().style.getPropertyValue("--nv-largura")).toBe("550px");
    expect(app().classList.contains("nv-conversa-estreita")).toBe(true);
  });

  it("D6 B: entre 900 e 1179 px o painel cobre a conversa (cobrindo); a 1440 fica ao lado", () => {
    navegador.abrirPainel("a1");
    expect(navegador.cobrindo()).toBe(false);
    navegador.fechar();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    navegador.abrirPainel("a1");
    expect(app().classList.contains("nv-cobre")).toBe(true);
    expect(navegador.cobrindo()).toBe(true);
    navegador.fechar();
    expect(navegador.cobrindo()).toBe(false);
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
    expect(painel().querySelector(".nv-legenda")?.textContent).toBe("Navegador da Ada");
    navegador.fecharAba("a1");
    expect(navegador.abaAberta("a1")).toBe(false);
    expect(app().classList.contains("nv-aba-ativa")).toBe(false);
    const desfazer = document.querySelector<HTMLButtonElement>(".nv-aviso button")!;
    expect(desfazer.textContent).toContain("⌘⇧T");
    desfazer.click();
    expect(navegador.abaAberta("a1")).toBe(true);
    expect(navegador.abaAtiva("a1")).toBe(true);
  });

  it("arrastar a aba de lugar (D7): antes da primeira tarefa vai ao começo; solta na borda direita vira painel", () => {
    navegador.abrirAba("a1");
    const fileira = document.createElement("nav");
    fileira.className = "abas-tarefa";
    fileira.innerHTML = `<div class="at-aba"><button class="at-ir">Tarefa</button></div>${navegador.abaNaFileira("a1")!.html}`;
    document.body.append(fileira);
    fileira.querySelector<HTMLElement>(".at-aba:not(.nv-aba-lugar)")!.getBoundingClientRect = () => ({ left: 200, top: 0, width: 100, height: 30, right: 300, bottom: 30, x: 200, y: 0, toJSON: () => ({}) });
    const ir = fileira.querySelector<HTMLElement>(".nv-aba-lugar .at-ir")!;
    const ev = (tipo: string, x: number) => { const e = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0 }); Object.defineProperty(e, "pointerId", { value: 1 }); return e; };
    expect(navegador.abaNaFileira("a1")!.frente).toBe(false);
    ir.dispatchEvent(ev("pointerdown", 400));
    document.dispatchEvent(ev("pointermove", 300));
    expect(fileira.querySelector(".nv-aba-lugar")!.classList.contains("nv-aba-arrastando")).toBe(true);
    document.dispatchEvent(ev("pointermove", 210));
    document.dispatchEvent(ev("pointerup", 210));
    expect(navegador.abaNaFileira("a1")!.frente).toBe(true);
    // O clique que fecha o arrasto não abre a aba.
    ir.dispatchEvent(ev("pointerdown", 210));
    document.dispatchEvent(ev("pointermove", 1400));
    expect(document.documentElement.classList.contains("nv-solta-painel")).toBe(true);
    document.dispatchEvent(ev("pointerup", 1420));
    expect(document.documentElement.classList.contains("nv-solta-painel")).toBe(false);
    expect(navegador.abaAberta("a1")).toBe(false);
    expect(navegador.painelAberto("a1")).toBe(true);
  });

  it("o clique direito na aba abre o menu dela (D7); Encerrar pergunta só com o bot no meio de algo", async () => {
    navegador.abrirAba("a1");
    const aba = document.createElement("div");
    aba.innerHTML = navegador.abaNaFileira("a1")!.html;
    document.body.append(aba);
    aba.querySelector(".nv-aba-lugar")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const menu = document.querySelector(".nv-menu")!;
    expect(menu.textContent).toMatch(/Pôr ao lado da conversa.*Assumir o controle.*Abrir em tela cheia.*Fechar aba.*Fechar os outros lugares.*Encerrar o navegador da Ada/);
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
    // D1c: o título é o chip com o personagem (o Paper põe o avatar antes do nome).
    expect(d.querySelector(".nv-tc-titulo > .nv-tc-avatar + .nv-tc-titulo-txt")?.textContent).toBe("Ada");
    expect(d.querySelector(".nv-recado-bt")?.textContent).toBe("Recado para a Ada");
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

  it("5c: o lugar ativo (vivo, precisa de você, no controle) vai ao botão de abas e à pílula; o botão de abas o põe na fileira sem abrir", () => {
    expect(navegador.lugarAtivo("a1")).toEqual({ agenteId: "a1", rotulo: "Navegador da Ada", estado: "ao vivo", ponto: "vivo", site: "Google Voos" });
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta({ controle: "precisa_de_voce" }) } });
    expect(navegador.lugarAtivo("a1")).toMatchObject({ estado: "precisa de você", ponto: "precisa" });
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta({ estado: "pausa" }) } });
    expect(navegador.lugarAtivo("a1")).toBeNull();
    expect(navegador.lugarAtivo("outro")).toBeNull();
    navegador.porNaFileira("a1");
    expect(navegador.abaAberta("a1")).toBe(true);
    expect(navegador.abaAtiva("a1")).toBe(false);
    expect(painel().hidden).toBe(true);
  });

  it("sair da conversa do bot fecha o painel sem parar o bot", () => {
    navegador.abrirPainel("a1");
    navegador.sincronizar({ agenteId: null, navegadores: { a1: resposta() } });
    expect(navegador.onde()).toBeNull();
    expect(operacoes).toEqual([]);
    expect(renders).toBeGreaterThan(0);
  });
});

describe("ensinar uma tarefa na tela cheia (T1, T2)", () => {
  let navegador: ReturnType<typeof criarNavegadorNaTela>;
  let operacoes: string[];
  let ensinos: (string | undefined)[][];
  let atual: VistaNavegador;
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    document.body.innerHTML = '<div class="app"><aside id="sidebar"></aside><main class="stage"><footer id="composer"></footer></main></div>';
    const { api, ops } = apiFalsa();
    operacoes = ops;
    ensinos = [];
    atual = vista({ controle: "pessoa" });
    const ensinarNoNavegador = vi.fn(async (_id: string, op: "comecar" | "descartar" | "salvar" | "desfazer_descarte", nome?: string) => {
      ensinos.push([op, nome]);
      if (op === "comecar" || op === "desfazer_descarte") atual = vista({ controle: "pessoa", gravacao: { desde: Date.now() - 42_000, passos: ["Abriu itau.com.br"], parou: null } });
      if (op === "descartar") atual = vista({ controle: "pessoa", gravacao: null, descarte: { passos: 1, ate: Date.now() + 10_000 } });
      if (op === "salvar") atual = vista({ controle: "pessoa", gravacao: null });
      return { ok: true as const, vista: atual };
    });
    navegador = criarNavegadorNaTela({
      api: () => ({ ...api, ensinarNoNavegador }),
      nome: () => "Ada", temComputador: () => false, abrirComputador: vi.fn(), lerVista: vi.fn(), guardarVista: vi.fn(), decidir: vi.fn(async () => undefined),
      mandarRecado: vi.fn(async () => undefined), abrirLogins: vi.fn(), abrirFora: vi.fn(), aoErro: vi.fn(), modoAbas: () => false, ligarModoAbas: vi.fn(),
      render: () => undefined, pessoaId: () => "p1", celular: () => false,
    });
    navegador.sincronizar({ agenteId: "a1", navegadores: { a1: resposta() } });
  });
  afterEach(() => { navegador.destruir(); vi.restoreAllMocks(); });
  const tc = () => document.querySelector<HTMLDialogElement>("dialog.nv-tc")!;

  it("T1 no ⋯: começar assume, abre a tela cheia e grava; a barra tem o relógio vivo e os passos ficam ao lado", async () => {
    const intervalos = vi.spyOn(window, "setInterval");
    navegador.abrirPainel("a1");
    document.querySelector<HTMLButtonElement>('#navegador-painel [data-nv-p="menu"]')!.click();
    const item = document.querySelector<HTMLButtonElement>('.nv-menu [data-nv-menu="ensinar"]')!;
    // Achado 15: o mesmo subtítulo do + do campo.
    expect(item.textContent).toBe("Ensinar uma tarefaMostre no navegador da Ada; ela aprende");
    item.click();
    await vi.waitFor(() => expect(ensinos).toEqual([["comecar", undefined]]));
    expect(operacoes).toContain("assumir");
    expect(tc().classList.contains("nv-gravando")).toBe(true);
    expect(tc().querySelector<HTMLElement>(".nv-tc-topo")!.hidden).toBe(true);
    expect(tc().querySelector(".nv-grav-barra")?.textContent).toMatch(/^Ensinando a Ada · 0:4[23] · 1 passo/);
    expect(tc().querySelector(".nv-grav-passos")?.textContent).toBe("Passos gravados1 · Abriu itau.com.br");
    const tique = intervalos.mock.calls.find((c) => c[1] === MS_RELOGIO_GRAVACAO)?.[0] as (() => void) | undefined;
    expect(tique).toBeDefined();
    const daqui = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(daqui);
    tique!();
    expect(tc().querySelector(".nv-grav-relogio")?.textContent).toMatch(/^1:4[2-4] · 1 passo$/);
  });

  it("Salvar e ensinar pede o nome com a sugestão pronta, salva e sai da tela cheia (devolvendo à Ada)", async () => {
    await navegador.ensinar("a1");
    tc().querySelector<HTMLButtonElement>('[data-nv-p="salvar-gravacao"]')!.click();
    const campo = tc().querySelector<HTMLInputElement>(".nv-grav-nome-campo")!;
    expect(campo.value).toBe("itau.com.br");
    campo.value = "Baixar a fatura do Itaú";
    tc().querySelector<HTMLFormElement>('[data-nv-form="nomear"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(ensinos.at(-1)).toEqual(["salvar", "Baixar a fatura do Itaú"]));
    await vi.waitFor(() => expect(document.querySelector("dialog.nv-tc")).toBeNull());
    expect(document.querySelector(".nv-aviso")?.textContent).toContain("Ensinado");
  });

  it("Descartar joga fora com aviso e Desfazer; Desfazer assume de novo e devolve a gravação", async () => {
    await navegador.ensinar("a1");
    tc().querySelector<HTMLButtonElement>('[data-nv-p="descartar-gravacao"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".nv-aviso")?.textContent).toContain("Gravação descartada (1 passo)"));
    expect(tc().classList.contains("nv-gravando")).toBe(false);
    document.querySelector<HTMLButtonElement>(".nv-aviso button")!.click();
    await vi.waitFor(() => expect(ensinos.at(-1)).toEqual(["desfazer_descarte", undefined]));
    expect(tc().classList.contains("nv-gravando")).toBe(true);
  });
});

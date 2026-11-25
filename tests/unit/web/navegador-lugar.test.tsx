import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayloadNavegadorLugar, PayloadNavegadorPergunta, RespostaLugarNavegador, RespostaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { htmlCartaoDaPergunta, htmlLinhaDoLugarDoNavegador, htmlLinhaDoLugarNoPainel, htmlListaDoLugar, lugarEscolhido } from "../../../web/lib/navegador-lugar-tela.ts";
import { criarTrocaDePasso, MS_ENTRE_TROCAS, MS_TROCA_DE_PASSO } from "../../../web/lib/navegador-troca-de-passo.ts";
import { fraseNoPassado, htmlLinhaDoNavegador, linhaDoNavegadorVisivel } from "../../../web/lib/navegador-vista.ts";
import { passosDoAnexo } from "../../../web/telas/conversa.ts";
import { MS_TAMANHO_PARADO, montarVistaNavegador, type SocketDaVista } from "../../../web/telas/navegador-vista.ts";

/**
 * ADR-190 (Paper M, N, J, K; D7, D8; emenda de 2026-11-20 do item 4): onde o navegador mora na tela, a linha de atividade
 * com o lugar e a troca de passo, e a vista que manda o tamanho da área pelo canal ao vivo.
 */
const ADA = "00000000-0000-4000-8000-0000000000a1";
const VM_SP = "00000000-0000-4000-8000-0000000000e1";
const VM_RIO = "00000000-0000-4000-8000-0000000000e2";

const lugar = (o: Partial<RespostaLugarNavegador> = {}): RespostaLugarNavegador => ({
  continuaSemMac: true, maquinaId: null, soNaMaquina: false, maquinas: [], maquinaDoComputador: null, temApp: true, nomeDoAparelho: "seu Mac",
  agora: "no nod", subtitulo: "A Ada continua no nod", frasePergunta: { texto: "A Ada continua", lugar: "no nod", resto: "", trocar: false },
  respondeu: false, retomarTurnoId: null, disponivel: true, ...o,
});
const uma = { maquinas: [{ id: VM_SP, nome: "vm-sp", ligada: true }], subtitulo: "A Ada continua na vm-sp", frasePergunta: { texto: "A Ada continua", lugar: "na vm-sp", resto: ", que fica sempre ligada", trocar: false } };
const duas = {
  maquinas: [{ id: VM_SP, nome: "vm-sp", ligada: true }, { id: VM_RIO, nome: "vm-rio", ligada: true }], maquinaDoComputador: VM_SP, subtitulo: "A Ada continua na vm-sp",
  frasePergunta: { texto: "A Ada continua", lugar: "na vm-sp", resto: ", onde ela já trabalha", trocar: true },
};
const doc = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d; };
const pergunta = (o: Partial<PayloadNavegadorPergunta> = {}): PayloadNavegadorPergunta => ({ kind: "navegador_pergunta", agenteId: ADA, pergunta: "continuar_sem_mac", hora: "Às 3h", nomeDoAparelho: "seu Mac", turnoId: null, rotinaId: "r1", em: 1, ...o });

describe("M1/J2/N2: a linha do painel do bot", () => {
  it("com o app: ☾ Com o Mac desligado, o subtítulo do servidor e o interruptor verde que liga e desliga", () => {
    const d = doc(htmlLinhaDoLugarNoPainel(lugar(uma), { agenteId: ADA, nome: "Ada", aberto: false }));
    expect(d.querySelector(".gv-linha-txt")?.textContent).toBe("Com o Mac desligadoA Ada continua na vm-sp");
    const chave = d.querySelector<HTMLElement>(".nvl-chave")!;
    expect(chave.getAttribute("role")).toBe("switch");
    expect(chave.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(chave.dataset.mudar!)).toEqual({ continuaSemMac: false });
    expect(d.querySelector<HTMLElement>(".nvl-abrir")!.dataset).toMatchObject({ act: "nv-lugar-abrir", chave: `painel:${ADA}` });
    const desligado = doc(htmlLinhaDoLugarNoPainel(lugar({ continuaSemMac: false, subtitulo: "A Ada espera o Mac ligar" }), { agenteId: ADA, nome: "Ada", aberto: false }));
    expect(desligado.querySelector(".gv-linha-txt small")?.textContent).toBe("A Ada espera o Mac ligar");
    expect(desligado.querySelector(".nvl-chave")?.getAttribute("aria-checked")).toBe("false");
  });

  it("no PC diz \"Com o PC desligado\"; sem o app vira \"Onde a Ada trabalha · Na vm-sp ›\" sem interruptor; sem navegador, nada", () => {
    expect(htmlLinhaDoLugarNoPainel(lugar({ nomeDoAparelho: "seu PC" }), { agenteId: ADA, nome: "Ada", aberto: false })).toContain("Com o PC desligado");
    const sem = doc(htmlLinhaDoLugarNoPainel(lugar({ ...uma, temApp: false }), { agenteId: ADA, nome: "Ada", aberto: false }));
    expect(sem.querySelector(".gv-linha-txt")?.textContent).toBe("Onde a Ada trabalhaNa vm-sp");
    expect(sem.querySelector(".nvl-chave")).toBeNull();
    expect(sem.querySelector(".gv-chev")).not.toBeNull();
    expect(htmlLinhaDoLugarNoPainel(lugar({ disponivel: false }), { agenteId: ADA, nome: "Ada", aberto: false })).toBe("");
    expect(htmlLinhaDoLugarNoPainel(null, { agenteId: ADA, nome: "Ada", aberto: false })).toBe("");
  });
});

describe("N3: a lista ao tocar na frase", () => {
  const itens = (r: RespostaLugarNavegador) => [...doc(htmlListaDoLugar(r, { agenteId: ADA, nome: "Ada", chave: "k" })).querySelectorAll(".nvl-item")].map((b) => `${b.getAttribute("aria-checked") === "true" ? "✓ " : ""}${b.querySelector(".nvl-rotulo")?.textContent}${b.querySelector(".nvl-ligada")?.textContent ? ` · ${b.querySelector(".nvl-ligada")?.textContent}` : ""}`);

  it("0 máquinas: ✓ No nod e \"Usar uma máquina sua / Uma que fique sempre ligada\" (Conectar uma máquina sempre ligada)", () => {
    const d = doc(htmlListaDoLugar(lugar(), { agenteId: ADA, nome: "Ada", chave: "k" }));
    expect(d.querySelector(".nvl-pop-titulo")?.textContent).toBe("Com o Mac desligado, a Ada continua");
    expect(itens(lugar())).toEqual(["✓ No nod"]);
    expect(d.querySelector<HTMLElement>(".nvl-mais")!.dataset.act).toBe("conectar-sempre-ligada");
    expect(d.querySelector(".nvl-mais")?.textContent).toBe("Usar uma máquina suaUma que fique sempre ligada");
  });

  it("1 máquina: ✓ Na vm-sp · ligada, No nod e Ver máquinas; escolher manda a máquina", () => {
    expect(itens(lugar(uma))).toEqual(["✓ Na vm-sp · ligada", "No nod"]);
    const d = doc(htmlListaDoLugar(lugar(uma), { agenteId: ADA, nome: "Ada", chave: "k" }));
    expect(d.querySelector<HTMLElement>(".nvl-mais")!.dataset.act).toBe("nv-ver-maquinas");
    expect(JSON.parse(d.querySelectorAll<HTMLElement>(".nvl-item")[1]!.dataset.mudar!)).toEqual({ maquinaId: "nod" });
  });

  it("2+: a mesma do computador do bot vem marcada; a escolhida explícita ganha; \"nod\" marca o nod", () => {
    expect(itens(lugar(duas))).toEqual(["✓ Na vm-sp · ligada", "Na vm-rio · ligada", "No nod"]);
    expect(lugarEscolhido(lugar({ ...duas, maquinaId: VM_RIO }))).toBe(VM_RIO);
    expect(lugarEscolhido(lugar({ ...duas, maquinaId: "nod" }))).toBe("nod");
    expect(itens(lugar({ ...duas, maquinas: [{ id: VM_SP, nome: "vm-sp", ligada: false }] }))).toEqual(["✓ Na vm-sp · fora do ar", "No nod"]);
  });
});

describe("M2/J1/N1 e J2: o cartão-pergunta e a resposta registrada", () => {
  const cartao = (r: RespostaLugarNavegador | null, p = pergunta()) => doc(htmlCartaoDaPergunta(p, r, { nome: "Ada", mensagemId: "m1", texto: "Às 3h seu Mac costuma estar desligado", aberto: false }));

  it("sem resposta: título, porquê, os dois botões e a frase de onde (0, 1 e 2+ máquinas, com Trocar só em 2+)", () => {
    const d = cartao(lugar({ continuaSemMac: false }));
    expect(d.querySelector(".nvl-titulo")?.textContent).toBe("Às 3h seu Mac costuma estar desligado");
    expect(d.querySelector(".nvl-texto")?.textContent).toBe("Para essa rotina rodar, a Ada precisa continuar com ele desligado.");
    expect([...d.querySelectorAll(".nvl-bt")].map((b) => [b.textContent, JSON.parse((b as HTMLElement).dataset.mudar!)])).toEqual([["Continuar com o Mac desligado", { continuaSemMac: true }], ["Só com o Mac ligado", { continuaSemMac: false }]]);
    expect(d.querySelector(".nvl-frase")?.textContent).toBe("A Ada continua no nod.");
    expect(cartao(lugar({ ...uma, continuaSemMac: false })).querySelector(".nvl-frase")?.textContent).toBe("A Ada continua na vm-sp, que fica sempre ligada.");
    const varias = cartao(lugar({ ...duas, continuaSemMac: false }));
    expect(varias.querySelector(".nvl-frase")?.textContent).toBe("A Ada continua na vm-sp, onde ela já trabalha.Trocar");
    expect(varias.querySelector<HTMLElement>(".nvl-trocar")!.dataset).toMatchObject({ act: "nv-lugar-abrir", chave: "cartao:m1" });
  });

  it("respondida: \"✓ Você escolheu: …\" com Desfazer que volta; sem o lugar lido, só a linha", () => {
    const d = cartao(lugar({ respondeu: true, continuaSemMac: true }));
    expect(d.querySelector(".nvl-resposta")?.textContent).toBe("✓Você escolheu: continuar com o Mac desligadoDesfazer");
    expect(JSON.parse(d.querySelector<HTMLElement>(".nvl-desfazer")!.dataset.mudar!)).toEqual({ continuaSemMac: false });
    expect(cartao(lugar({ respondeu: true, continuaSemMac: false })).querySelector(".nvl-resposta-txt")?.textContent).toBe("Você escolheu: só com o Mac ligado");
    expect(cartao(null).querySelector("button")).toBeNull();
  });
});

describe("M3/K1/K2: o pedido com o Mac desligado", () => {
  const mac = pergunta({ pergunta: "mac_desligado", turnoId: "t1", rotinaId: null });
  const cartao = (r: RespostaLugarNavegador) => doc(htmlCartaoDaPergunta(mac, r, { nome: "Ada", mensagemId: "m2", texto: "Seu Mac está desligado", aberto: false }));

  it("Mac desligado: [Fazer agora] [Quando o Mac ligar] com o turno; respondido, a linha K2 com Desfazer ou \"Faço quando o Mac ligar\"", () => {
    const d = cartao(lugar({ continuaSemMac: false, agora: null }));
    expect(d.querySelector(".nvl-texto")?.textContent).toBe("Eu uso o navegador nele. Faço assim que ele ligar, ou agora, se eu puder continuar com ele desligado.");
    expect([...d.querySelectorAll<HTMLElement>(".nvl-bt")].map((b) => [b.textContent, b.dataset.act, b.dataset.turno, b.dataset.resposta])).toEqual([["Fazer agora", "nv-mac-desligado", "t1", "agora"], ["Quando o Mac ligar", "nv-mac-desligado", "t1", "ao_ligar"]]);
    expect(cartao(lugar({ continuaSemMac: true })).querySelector(".nvl-resposta")?.textContent).toBe("✓Agora a Ada continua com o Mac desligadoDesfazer");
    expect(cartao(lugar({ continuaSemMac: false, agora: null, retomarTurnoId: "t1" })).querySelector(".nvl-resposta")?.textContent).toBe("Faço quando o Mac ligarFazer agora");
    expect(cartao(lugar({ continuaSemMac: false, agora: "no seu Mac" })).textContent).toBe("Seu Mac está desligado. Ele já ligou.");
  });
});

describe("N, \"Quando algo muda\": as linhas da conversa", () => {
  const p = (o: Partial<PayloadNavegadorLugar>): PayloadNavegadorLugar => ({ kind: "navegador_lugar", agenteId: ADA, aviso: "passou_para_maquina", maquinaId: VM_SP, nome: "vm-sp", em: 1, acao: { rotulo: "Desfazer", mudar: { maquinaId: "nod" } }, ...o });

  it("0→1 com Desfazer; fora do ar com a trava embaixo; saiu da conta com Ver máquinas; quem não é dona só lê", () => {
    expect(doc(htmlLinhaDoLugarDoNavegador(p({}), "Com o Mac desligado, agora continuo na vm-sp.", true)).textContent).toBe("Com o Mac desligado, agora continuo na vm-sp.Desfazer");
    const fora = doc(htmlLinhaDoLugarDoNavegador(p({ aviso: "fez_no_nod", acao: { rotulo: "Só na vm-sp, mesmo que atrase", mudar: { soNaMaquina: true } } }), "A vm-sp estava fora do ar às 3h. Fiz no nod.", true));
    expect(fora.querySelector(".nvl-aviso.empilhado .nvl-trava")?.textContent).toBe("Só na vm-sp, mesmo que atrase");
    const saiu = doc(htmlLinhaDoLugarDoNavegador(p({ aviso: "maquina_saiu", acao: null }), "A vm-sp saiu da sua conta. Continuo no nod.", true));
    expect(saiu.querySelector<HTMLElement>("button")!.dataset.act).toBe("nv-ver-maquinas");
    expect(htmlLinhaDoLugarDoNavegador(p({}), "x", false)).not.toContain("<button");
    expect(htmlLinhaDoLugarDoNavegador(p({ acao: null }), "<img src=x>", true)).toContain("&lt;img src=x&gt;");
  });
});

describe("N4 e D8: a linha de atividade com o lugar e a troca de passo", () => {
  const base: Pick<VistaNavegador, "estado" | "controle" | "pedido" | "passo" | "abas" | "atividadeEm" | "lugar"> = {
    estado: "ao_vivo", controle: "bot", pedido: null, passo: { tipo: "ler", frase: "Lendo os voos", caixa: null, em: 1_000 }, abas: [{ id: "t1", titulo: "Google Voos", url: "https://google.com/travel", ativa: true, carregando: false, inseguro: false }], atividadeEm: 1_000, lugar: { tipo: "nod" },
  };
  it("o lugar fecha a linha; terminado, o ✓ com o passo, a hora e o lugar", () => {
    expect(doc(htmlLinhaDoNavegador("Ada", ADA, base, { modoAbas: false })).querySelector("small")?.textContent).toBe("Google Voos · lendo os voos · no nod");
    const fim = new Date(2026, 10, 21, 3, 2).getTime();
    const feito = doc(htmlLinhaDoNavegador("Ada", ADA, { ...base, estado: "terminou", passo: { tipo: "ler", frase: "baixou 14 notas fiscais", caixa: null, em: fim }, atividadeEm: fim, lugar: { tipo: "maquina", maquinaId: VM_SP, nome: "vm-sp" } }, { modoAbas: false }));
    expect(feito.querySelector(".nv-linha-ok")).not.toBeNull();
    expect(feito.querySelector("small")?.textContent).toBe("Baixou 14 notas fiscais · 03:02 · na vm-sp");
    expect(linhaDoNavegadorVisivel({ ...base, estado: "terminou" }, 2_000)).toBe(true);
    expect(linhaDoNavegadorVisivel({ ...base, estado: "terminou" }, 11 * 60_000)).toBe(false);
    expect(fraseNoPassado('Clicando em "Baixar todas"')).toBe("Clicou em “Baixar todas”");
    expect(fraseNoPassado("Abrindo nfse.prefeitura.sp.gov.br")).toBe("Abriu nfse.prefeitura.sp.gov.br");
    expect(doc(htmlLinhaDoNavegador("Ada", ADA, base, { modoAbas: true })).querySelector(".nv-linha-ver")?.textContent).toBe("Abrir");
  });

  it("o passo antigo sai e o novo entra em 160 ms; dentro do segundo, o novo espera e só o último aparece", () => {
    let agora = 0;
    const timers: { em: number; fn: () => void; id: number }[] = [];
    let seq = 0;
    const t = criarTrocaDePasso({ agora: () => agora, agendar: (fn, ms) => { timers.push({ em: agora + ms, fn, id: ++seq }); return seq; }, cancelar: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); }, reduzido: () => false, raiz: () => document });
    const andar = (ms: number) => { agora += ms; for (const x of timers.filter((y) => y.em <= agora)) { timers.splice(timers.indexOf(x), 1); x.fn(); } };
    const desenhar = (sub: string) => { document.body.innerHTML = htmlLinhaDoNavegador("Ada", ADA, { ...base, passo: { tipo: "ler", frase: sub, caixa: null, em: 1 } }, { modoAbas: false }); t.aplicar(); };
    const small = () => document.querySelector(".nv-linha-txt small")!;
    desenhar("Lendo");
    andar(MS_ENTRE_TROCAS);
    desenhar("Clicando em Buscar");
    expect([...small().querySelectorAll(".nv-passo")].map((e) => `${e.className}:${e.textContent}`)).toEqual(["nv-passo sai:Google Voos · lendo · no nod", "nv-passo entra:Google Voos · clicando em Buscar · no nod"]);
    andar(MS_TROCA_DE_PASSO);
    expect(small().textContent).toBe("Google Voos · clicando em Buscar · no nod");
    andar(200);
    desenhar("Rolando");
    expect(small().textContent).toBe("Google Voos · clicando em Buscar · no nod");
    desenhar("Lendo o preço");
    andar(MS_ENTRE_TROCAS);
    expect(small().querySelector(".nv-passo.entra")?.textContent).toBe("Google Voos · lendo o preço · no nod");
  });
});

describe("T3: o anexo dos passos", () => {
  it("o número de passos sai do nome do anexo", () => {
    expect(passosDoAnexo("passos-gravados (6 passos).txt")).toBe(6);
    expect(passosDoAnexo("passos-gravados (1 passo).txt")).toBe(1);
    expect(passosDoAnexo("passos-gravados.txt")).toBeNull();
    expect(passosDoAnexo("outro (6 passos).txt")).toBeNull();
  });
});

class SocketFalso implements SocketDaVista {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  enviados: unknown[] = [];
  send(d: string): void { this.enviados.push(JSON.parse(d)); }
  close(): void {}
}

describe("a vista manda o tamanho da área (emenda de 2026-11-20 da ADR-190, item 4)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { vi.useRealTimers(); });

  it("ao abrir o canal e 600 ms depois de mudar de tamanho (uma vez por tamanho), assistindo", () => {
    vi.useFakeTimers();
    const vista = { agenteId: "a1", estado: "ao_vivo", controle: "bot", lugar: { tipo: "nod" }, abas: [], aviso: null, passo: null, pedido: null, gravacao: null, descarte: null, segredoNaPagina: false, ofertaGuardar: null, atividadeEm: 0, erro: null, viewport: { w: 1280, h: 720 } } satisfies VistaNavegador;
    const r: RespostaNavegador = { vista, disponivel: true };
    const sockets: SocketFalso[] = [];
    const api = { operarNavegador: vi.fn(), irParaNoNavegador: vi.fn(), trocarAbaDoNavegador: vi.fn(), urlVivoNavegador: () => "ws://x", navegador: vi.fn(async () => r) };
    const v = montarVistaNavegador({ api: api as never, agenteId: "a1", nome: () => "Ada", abrirSocket: () => { const s = new SocketFalso(); sockets.push(s); return s; }, menosMovimento: () => true });
    document.body.append(v.el);
    const palco = v.el.querySelector<HTMLElement>(".nv-palco")!;
    let area = { w: 560, h: 700 };
    palco.getBoundingClientRect = () => ({ left: 0, top: 0, width: area.w, height: area.h, right: area.w, bottom: area.h, x: 0, y: 0, toJSON: () => ({}) });
    v.atualizar(r);
    v.ligar(true);
    sockets[0]!.onopen?.({});
    expect(sockets[0]!.enviados).toEqual([{ t: "tamanho", w: 560, h: 700 }]);
    area = { w: 390, h: 300 };
    v.hospedar("folha");
    vi.advanceTimersByTime(MS_TAMANHO_PARADO - 1);
    expect(sockets[0]!.enviados).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets[0]!.enviados).toEqual([{ t: "tamanho", w: 560, h: 700 }, { t: "tamanho", w: 390, h: 300 }]);
    v.hospedar("folha");
    vi.advanceTimersByTime(MS_TAMANHO_PARADO);
    expect(sockets[0]!.enviados).toHaveLength(2);
    v.destruir();
  });
});

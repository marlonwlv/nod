import { describe, expect, it } from "vitest";
import type { VistaCanvasDto } from "../../../src/contracts/canvas.ts";
import { criarCanvasNaTela } from "../../../web/lib/canvas-na-tela.ts";

/**
 * Revisão do #677: o "Enviar N ›" é assíncrono e a pessoa pode trocar de canvas (ou de bot) no meio. Num DOM de mentira
 * (o unit não tem jsdom): o host não acha nada por seletor, então o desenho vira no-op e só a lógica corre.
 */
type Adiado<T> = { promessa: Promise<T>; resolver: (v: T) => void; rejeitar: (e: unknown) => void };
const adiado = <T>(): Adiado<T> => {
  let resolver!: (v: T) => void; let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((r, j) => { resolver = r; rejeitar = j; });
  return { promessa, resolver, rejeitar };
};
const tique = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const item = (id: string, atualizadoEm: number) => ({ id, issue: id, titulo: id, versao: 1, origemUrl: null, atualizadoEm, abertos: 0, estado: "rascunho", etapa: null, aprovadoEm: null, telas: 0, jornadas: 0 });
const vista = (id: string): VistaCanvasDto => ({
  canvas: item(id, 1) as never, confiavel: true, versoes: 1, comentarios: [], proximaRodada: 1,
  estrutura: { issue: id, titulo: id, versaoTexto: null, links: [], css: [], js: [], jornadas: [], notas: [] },
});
const rasc = (id: string, texto: string) => ({ id, tipo: "nota", endereco: "J1", texto });

function montarCenario() {
  const store = new Map<string, string>();
  const ouvintes = new Map<string, (ev: unknown) => void>();
  const win = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    location: { href: "http://x/", hash: "" },
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => undefined, requestAnimationFrame: () => 0, addEventListener: () => undefined,
  };
  const doc = { defaultView: win, querySelector: () => null, addEventListener: () => undefined, body: { classList: { add() {}, remove() {} } } };
  // Só o topo (onde moram os avisos) e o campo da nota existem; o resto do desenho segue no-op.
  const topo = { innerHTML: "" };
  const nota = { id: "cv-nota-in", value: "", focus() {}, closest: () => ({}) };
  const host = {
    innerHTML: "", firstElementChild: {}, isConnected: true,
    querySelector: (s: string) => (s === ".cv-topo" ? topo : s === "#cv-nota-in" ? nota : null), querySelectorAll: () => [], closest: () => null, contains: () => false,
    addEventListener: (t: string, f: (ev: unknown) => void) => void ouvintes.set(t, f),
  };
  const comentarios: Adiado<{ comentario: unknown }>[] = [];
  const enviados: { conversa: string; texto: string }[] = [];
  let conversa = "conv-gil";
  const api = {
    canvasDoAgente: async () => ({ canvas: [item("cvA", 2), item("cvB", 1)] }),
    verCanvas: async (id: string) => vista(id),
    comentarCanvas: () => { const a = adiado<{ comentario: unknown }>(); comentarios.push(a); return a.promessa; },
    enviar: async (c: string, texto: string) => { enviados.push({ conversa: c, texto }); },
  };
  const tela = criarCanvasNaTela(doc as never, { api: () => api as never, conversa: () => conversa });
  const clicar = (cv: string, id?: string): void => ouvintes.get("click")?.({ target: { closest: (s: string) => (s === "[data-cv]" ? { dataset: { cv, ...(id ? { id } : {}) }, closest: () => null } : null) } });
  const tecla = (key: string, alvo: unknown): void => ouvintes.get("keydown")?.({ key, target: alvo, preventDefault() {}, shiftKey: false, isComposing: false });
  return { store, tela, host, clicar, tecla, topo, nota, comentarios, enviados, trocarConversa: (c: string) => { conversa = c; } };
}

describe("canvas-na-tela: Enviar N › com a pessoa trocando de canvas no meio", () => {
  it("os rascunhos do canvas de destino não vão para a chave do canvas que estava enviando", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "um"), rasc("a2", "dois")]));
    c.store.set("nod.canvas.rodada.cvB", JSON.stringify([rasc("b1", "do B")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("enviar-rodada");
    await tique();
    expect(c.comentarios.length).toBe(1);
    // A pessoa abre o canvas B enquanto o primeiro comentário do A está a caminho.
    c.tela.querAbrir("cvB");
    await tique();
    c.comentarios[0]!.resolver({ comentario: { id: "k1" } });
    await tique();
    c.comentarios[1]?.resolver({ comentario: { id: "k2" } });
    await tique();
    // O A enviou os dois e fica sem rascunho; o B segue com o dele, na chave dele.
    expect(c.store.get("nod.canvas.rodada.cvA")).toBeUndefined();
    expect(JSON.parse(c.store.get("nod.canvas.rodada.cvB") ?? "[]")).toEqual([rasc("b1", "do B")]);
    expect(c.comentarios.length).toBe(2);
  });
  it("o recibo vai para a conversa do bot de quando a pessoa enviou, mesmo que ela troque de bot no meio", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "um")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("enviar-rodada");
    await tique();
    c.trocarConversa("conv-ana");
    c.tela.montar(c.host as never, "ag2", "Ana");
    c.comentarios[0]!.resolver({ comentario: { id: "k1" } });
    await tique();
    expect(c.enviados.map((e) => e.conversa)).toEqual(["conv-gil"]);
    expect(c.enviados[0]!.texto).toContain("cvA");
  });
  it("o aviso de falha conta o que ficou no canvas que estava enviando, não o que está aberto agora", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "um"), rasc("a2", "dois")]));
    c.store.set("nod.canvas.rodada.cvB", JSON.stringify([rasc("b1", "do B")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("enviar-rodada");
    await tique();
    c.tela.querAbrir("cvB");
    await tique();
    c.comentarios[0]!.rejeitar(new Error("rede"));
    await tique();
    expect(c.topo.innerHTML).toContain("Não deu para enviar 2 comentários");
    expect(JSON.parse(c.store.get("nod.canvas.rodada.cvA") ?? "[]")).toHaveLength(2);
  });
  it("o recibo da rodada separa o bot da contagem com espaço", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "um")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("enviar-rodada");
    await tique();
    c.comentarios[0]!.resolver({ comentario: { id: "k1" } });
    await tique();
    expect(c.topo.innerHTML).toContain("Rodada 1 enviada ao Gil · 1 comentário");
  });
});

describe("canvas-na-tela: Esc com a nota em rascunho aberta", () => {
  it("reabrir uma nota em rascunho e apertar Esc não a apaga", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "nota guardada")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("rascunho", "a1");
    expect(c.nota.value).toBe("nota guardada");
    c.tecla("Escape", c.nota);
    const ficou = JSON.parse(c.store.get("nod.canvas.rodada.cvA") ?? "[]") as { texto: string; endereco: string }[];
    expect(ficou.map((r) => [r.endereco, r.texto])).toEqual([["J1", "nota guardada"]]);
  });
  it("o texto que a pessoa escreveu antes do Esc vira rascunho; vazio não cria nada", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "antes")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("rascunho", "a1");
    c.nota.value = "  editada  ";
    c.tecla("Escape", c.nota);
    expect((JSON.parse(c.store.get("nod.canvas.rodada.cvA") ?? "[]") as { texto: string }[]).map((r) => r.texto)).toEqual(["editada"]);
    c.clicar("rascunho", (JSON.parse(c.store.get("nod.canvas.rodada.cvA")!) as { id: string }[])[0]!.id);
    c.nota.value = "   ";
    c.tecla("Escape", c.nota);
    expect(c.store.get("nod.canvas.rodada.cvA")).toBeUndefined();
  });
  it("abrir outro canvas com a nota aberta guarda o texto na chave do canvas dela", async () => {
    const c = montarCenario();
    c.store.set("nod.canvas.rodada.cvA", JSON.stringify([rasc("a1", "do A")]));
    c.tela.querAbrir("cvA");
    c.tela.montar(c.host as never, "ag1", "Gil");
    await tique();
    c.clicar("rascunho", "a1");
    c.tela.querAbrir("cvB");
    await tique();
    expect((JSON.parse(c.store.get("nod.canvas.rodada.cvA") ?? "[]") as { texto: string }[]).map((r) => r.texto)).toEqual(["do A"]);
    expect(c.store.get("nod.canvas.rodada.cvB")).toBeUndefined();
  });
});

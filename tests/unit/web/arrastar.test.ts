import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { FAIXA_AUTO_ROLAGEM, FANTASMA, frasesDoArrasto, frotaAoSoltar, ordemAoSoltar, ordemAoSoltarNaSecao, posicaoDoFantasma, ROLAGEM_MAX_POR_QUADRO, velocidadeAutoRolagem } from "../../../web/lib/arrastar.ts";

type Bot = FrotaDto["agentes"][number];
const bot = (id: string, criadoEm: number, extra: Partial<Bot> = {}): Bot => ({ id, ownerId: "p", nome: id, fixado: false, secao: "", posicao: null, criadoEm, ...extra }) as Bot;

describe("arrastar na barra lateral (canvas “Menu, sidebar e gaveta”)", () => {
  const frota = [
    bot("clarice", 1, { fixado: true, posicao: 0 }),
    bot("milton", 2, { fixado: true, posicao: 1 }),
    bot("nina", 3),
    bot("dev1", 4, { secao: "Devs" }),
    bot("dev2", 5, { secao: "Devs" }),
    bot("da-ana", 6, { ownerId: "ana", fixado: true }),
  ];

  it("soltar na grade põe o bot na posição e deixa de fora bot de outra pessoa", () => {
    expect(ordemAoSoltar(frota, "p", "dev1", { grupo: "fixados" }, 1)).toEqual(["clarice", "dev1", "milton"]);
    expect(ordemAoSoltar(frota, "p", "dev1", { grupo: "fixados" }, 99)).toEqual(["clarice", "milton", "dev1"]);
  });

  it("reordenar dentro do próprio grupo não conta o bot duas vezes", () => {
    expect(ordemAoSoltar(frota, "p", "milton", { grupo: "fixados" }, 0)).toEqual(["milton", "clarice"]);
  });

  it("a barra se reorganiza na hora: o bot muda de grupo e o grupo segue a ordem nova", () => {
    const ordem = ordemAoSoltar(frota, "p", "nina", { grupo: "secao", secao: "Devs" }, 1);
    expect(ordem).toEqual(["dev1", "nina", "dev2"]);
    const nova = frotaAoSoltar(frota, "nina", { grupo: "secao", secao: "Devs" }, ordem);
    expect(nova.filter((b) => !b.fixado && b.secao === "Devs").map((b) => b.id)).toEqual(["dev1", "nina", "dev2"]);
    expect(nova.find((b) => b.id === "nina")).toMatchObject({ fixado: false, secao: "Devs", posicao: 1 });
  });

  it("tirar da grade para uma seção desafixa; fixar mantém a seção guardada", () => {
    const desafixado = frotaAoSoltar(frota, "clarice", { grupo: "secao", secao: "" }, ["nina", "clarice"]);
    expect(desafixado.find((b) => b.id === "clarice")).toMatchObject({ fixado: false, secao: "", posicao: 1 });
    const fixado = frotaAoSoltar(frota, "dev2", { grupo: "fixados" }, ["dev2", "clarice", "milton"]);
    expect(fixado.filter((b) => b.fixado && b.ownerId === "p").map((b) => b.id)).toEqual(["dev2", "clarice", "milton"]);
    expect(fixado.find((b) => b.id === "dev2")?.secao).toBe("Devs");
  });
});

describe("soltar numa seção: a seção inteira é o alvo, sem escolher lugar", () => {
  const frota = [
    bot("clarice", 1, { fixado: true, posicao: 0 }),
    bot("nina", 2),
    bot("dev1", 3, { secao: "Devs", posicao: 0 }),
    bot("dev2", 4, { secao: "Devs", posicao: 1 }),
    bot("da-ana", 5, { ownerId: "ana", secao: "Devs" }),
  ];

  it("de outra seção, o bot entra no fim da seção de destino", () => {
    expect(ordemAoSoltarNaSecao(frota, "p", "nina", "Devs")).toEqual(["dev1", "dev2", "nina"]);
    expect(ordemAoSoltarNaSecao(frota, "p", "dev1", "")).toEqual(["nina", "dev1"]);
  });

  it("na seção em que já está, nada muda (não há reordenar arrastando dentro da seção)", () => {
    expect(ordemAoSoltarNaSecao(frota, "p", "dev2", "Devs")).toBeNull();
    expect(ordemAoSoltarNaSecao(frota, "p", "dev2", "devs")).toBeNull();
    expect(ordemAoSoltarNaSecao(frota, "p", "nina", "")).toBeNull();
  });

  it("um fixado solto numa seção sai da grade e vai para o fim dela", () => {
    expect(ordemAoSoltarNaSecao(frota, "p", "clarice", "")).toEqual(["nina", "clarice"]);
  });

  it("bot que não existe não gera pedido", () => {
    expect(ordemAoSoltarNaSecao(frota, "p", "sumiu", "Devs")).toBeNull();
  });
});

describe("cartão do bot que segue o ponteiro", () => {
  it("é 80×90 e fica centrado no ponteiro", () => {
    expect(FANTASMA).toEqual({ largura: 80, altura: 90 });
    expect(posicaoDoFantasma(200, 300)).toEqual({ x: 160, y: 255 });
  });
});

describe("o que o leitor de tela ouve no arrasto", () => {
  it("pegar, passar sobre, sair, soltar e cancelar", () => {
    expect(frasesDoArrasto.pegou("Teste Fichas")).toBe("Você pegou Teste Fichas");
    expect(frasesDoArrasto.sobre("Teste Fichas", "Organizadores")).toBe("Teste Fichas está sobre Organizadores");
    expect(frasesDoArrasto.fora("Teste Fichas")).toBe("Teste Fichas não está sobre uma área para soltar");
    expect(frasesDoArrasto.soltou("Teste Fichas", "Sem seção")).toBe("Você soltou Teste Fichas em Sem seção");
    expect(frasesDoArrasto.soltou("Teste Fichas", null)).toBe("Você soltou Teste Fichas");
    expect(frasesDoArrasto.cancelou("Teste Fichas")).toBe("O arraste de Teste Fichas foi cancelado");
  });
});

describe("rolagem automática ao arrastar até a borda da lista", () => {
  const TOPO = 100;
  const BASE = 700;
  it("no meio da lista, parada", () => {
    expect(velocidadeAutoRolagem(400, TOPO, BASE)).toBe(0);
    expect(velocidadeAutoRolagem(BASE - FAIXA_AUTO_ROLAGEM, TOPO, BASE)).toBe(0);
  });
  it("perto da base desce, mais rápido quanto mais perto; em cima do rodapé, no máximo", () => {
    const longe = velocidadeAutoRolagem(BASE - FAIXA_AUTO_ROLAGEM + 5, TOPO, BASE);
    const perto = velocidadeAutoRolagem(BASE - 2, TOPO, BASE);
    expect(longe).toBeGreaterThan(0);
    expect(perto).toBeGreaterThan(longe);
    expect(perto).toBeLessThanOrEqual(ROLAGEM_MAX_POR_QUADRO);
    expect(velocidadeAutoRolagem(BASE + 30, TOPO, BASE)).toBe(ROLAGEM_MAX_POR_QUADRO);
  });
  it("perto do topo sobe; acima da lista, no máximo", () => {
    expect(velocidadeAutoRolagem(TOPO + 3, TOPO, BASE)).toBeLessThan(0);
    expect(velocidadeAutoRolagem(TOPO - 40, TOPO, BASE)).toBe(-ROLAGEM_MAX_POR_QUADRO);
  });
  it("lista baixa: as faixas não se cruzam no meio; lista sem altura não rola", () => {
    expect(velocidadeAutoRolagem(150, 100, 200)).toBe(0);
    expect(velocidadeAutoRolagem(100, 100, 100)).toBe(0);
  });
});

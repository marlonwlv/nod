import { describe, expect, it } from "vitest";
import { aprovadaEm, estadoDoCanvas, proximaRodada, resolvidosPorVersao, telasQueMudaram, type ComentarioDoEstado, type TelaDaVersao } from "../../../src/domain/canvas-versoes.ts";

const tela = (id: string, html = `h:${id}`, pendente?: boolean): TelaDaVersao => ({ id, html, ...(pendente ? { pendente } : {}) });
let n = 0;
const com = (o: Partial<ComentarioDoEstado> = {}): ComentarioDoEstado => ({
  id: `c${++n}`, paiId: null, telaId: "J1-1", jornada: "J1", autorTipo: "pessoa", rodada: null, resolvidoEm: null, arquivadoEm: null, criadoEm: 100, ...o,
});

describe("estadoDoCanvas (J7-3)", () => {
  it("tela pendente → em produção, com a primeira que falta e a contagem", () => {
    const r = estadoDoCanvas({ telas: [tela("J1-1"), tela("J2-3", "", true), tela("J2-4", "", true)], criadoEm: 0 }, []);
    expect(r).toEqual({ estado: "em_producao", etapa: "montando a J2-3 · 1 de 3 telas", aprovadoEm: null });
  });

  it("rodada enviada depois da versão atual, com pino aberto → ajustando a rodada", () => {
    const cs = [com({ rodada: 1, criadoEm: 200 }), com({ rodada: 1, criadoEm: 200, resolvidoEm: 250 }), com({ rodada: 1, criadoEm: 200 })];
    expect(estadoDoCanvas({ telas: [tela("J1-1")], criadoEm: 150 }, cs)).toEqual({ estado: "em_producao", etapa: "ajustando a rodada 1 · 1 de 3", aprovadoEm: null });
  });

  it("rodada mais antiga que a versão atual não conta como em produção", () => {
    const cs = [com({ rodada: 1, criadoEm: 100 })];
    expect(estadoDoCanvas({ telas: [tela("J1-1")], criadoEm: 150 }, cs)).toEqual({ estado: "esperando_voce", etapa: "1 comentário aberto", aprovadoEm: null });
  });

  it("vale a última rodada; comentário do bot e resposta não entram", () => {
    const cs = [com({ rodada: 1, criadoEm: 200, resolvidoEm: 210 }), com({ rodada: 2, criadoEm: 300 }), com({ rodada: 3, autorTipo: "bot", criadoEm: 300 }), com({ rodada: 2, paiId: "x", criadoEm: 300 })];
    expect(estadoDoCanvas({ telas: [tela("J1-1")], criadoEm: 150 }, cs).etapa).toBe("ajustando a rodada 2 · 0 de 1");
  });

  it("abertos no plural", () => {
    expect(estadoDoCanvas({ telas: [tela("J1-1")], criadoEm: 0 }, [com(), com()]).etapa).toBe("2 comentários abertos");
  });

  it("regra da Ada: comentários todos resolvidos não aprovam; sem a tarefa fora de Prototipando é esperando você", () => {
    expect(estadoDoCanvas({ telas: [tela("J1-1")], criadoEm: 150 }, [com({ resolvidoEm: 150 })])).toEqual({ estado: "esperando_voce", etapa: "pronto para você ver", aprovadoEm: null });
  });

  it("a tarefa ligada saiu de Prototipando → aprovado com a data, mesmo com tela pendente ou rodada aberta", () => {
    expect(estadoDoCanvas({ telas: [tela("J1-1", "", true)], criadoEm: 0 }, [com({ rodada: 1, criadoEm: 200 })], 777)).toEqual({ estado: "aprovado", etapa: null, aprovadoEm: 777 });
  });

  it("sem comentários (ou só arquivados) → pronto para você ver", () => {
    expect(estadoDoCanvas({ telas: [tela("J1-1")], criadoEm: 0 }, [com({ arquivadoEm: 5 })]).etapa).toBe("pronto para você ver");
    expect(estadoDoCanvas(null, []).estado).toBe("esperando_voce");
  });
});

describe("aprovadaEm (regra da Ada, ADA-228)", () => {
  const colunas = [
    { id: "backlog", nome: "Backlog", grupo: "nao_iniciado" }, { id: "c-prototipando", nome: "Prototipando", grupo: "iniciado" },
    { id: "c-pronto-eng", nome: "Pronto para engenharia", grupo: "iniciado" }, { id: "fazendo", nome: "Implementando", grupo: "iniciado" },
    { id: "voce", nome: "Precisa de você", grupo: "iniciado" }, { id: "feito", nome: "Feito", grupo: "feito" }, { id: "cancelado", nome: "Cancelado", grupo: "fechado" },
  ];
  const t = (status: string, voltarPara: string | null = null) => ({ status, voltarPara, criadoEm: 1 });
  const st = (para: string, criadoEm: number, campo = "status") => ({ campo, para, criadoEm });

  it("em Prototipando ou antes → null", () => {
    expect(aprovadaEm(colunas, t("c-prototipando"), [st("c-prototipando", 5)])).toBeNull();
    expect(aprovadaEm(colunas, t("backlog"), [])).toBeNull();
  });

  it("Pronto para engenharia ou depois → a data da passagem", () => {
    expect(aprovadaEm(colunas, t("c-pronto-eng"), [st("backlog", 2, "criada"), st("c-prototipando", 5), st("c-pronto-eng", 9)])).toBe(9);
    expect(aprovadaEm(colunas, t("fazendo"), [st("c-prototipando", 5), st("c-pronto-eng", 9), st("fazendo", 12)])).toBe(9);
    expect(aprovadaEm(colunas, t("feito"), [st("c-prototipando", 5), st("feito", 20)])).toBe(20);
  });

  it("voltou a Prototipando e saiu de novo → a última saída", () => {
    expect(aprovadaEm(colunas, t("c-pronto-eng"), [st("c-pronto-eng", 9), st("c-prototipando", 10), st("c-pronto-eng", 15)])).toBe(15);
  });

  it("Precisa de você conta pela coluna de volta, sem virar passagem nova", () => {
    expect(aprovadaEm(colunas, t("voce", "fazendo"), [st("c-pronto-eng", 9), st("voce", 11)])).toBe(9);
    expect(aprovadaEm(colunas, t("voce", "c-prototipando"), [st("voce", 11)])).toBeNull();
    expect(aprovadaEm(colunas, t("fazendo"), [st("c-pronto-eng", 9), st("voce", 11), st("fazendo", 13)])).toBe(9);
  });

  it("Cancelado não aprova; quadro sem Prototipando → null; sem histórico vale quando nasceu", () => {
    expect(aprovadaEm(colunas, t("cancelado"), [st("cancelado", 4)])).toBeNull();
    expect(aprovadaEm(colunas.filter((c) => c.id !== "c-prototipando"), t("feito"), [])).toBeNull();
    expect(aprovadaEm(colunas, t("c-pronto-eng"), [])).toBe(1);
  });
});

describe("telasQueMudaram", () => {
  it("a 1ª versão não tem diff", () => {
    expect(telasQueMudaram(null, [tela("J1-1")])).toEqual({ mudaram: [], sairam: [] });
  });
  it("html diferente ou tela nova muda; a que some sai", () => {
    const r = telasQueMudaram([tela("J1-1"), tela("J1-2"), tela("J1-3")], [tela("J1-1"), tela("J1-2", "outro"), tela("J1-4")]);
    expect(r).toEqual({ mudaram: ["J1-2", "J1-4"], sairam: ["J1-3"] });
  });
});

describe("resolvidosPorVersao (J5-6)", () => {
  const versoes = [{ versao: 3, criadoEm: 300 }, { versao: 1, criadoEm: 100 }, { versao: 2, criadoEm: 200 }];
  it("conta para a primeira versão nascida no resolver ou depois; depois da última, a atual", () => {
    const a = com({ resolvidoEm: 150 });
    const b = com({ resolvidoEm: 300 });
    const c = com({ resolvidoEm: 900 });
    const aberto = com();
    const resposta = com({ paiId: "x", resolvidoEm: 150 });
    const r = resolvidosPorVersao(versoes, [a, b, c, aberto, resposta]);
    expect(Object.fromEntries(r)).toEqual({ 1: [], 2: [a.id], 3: [b.id, c.id] });
  });
  it("sem versões, vazio", () => {
    expect(resolvidosPorVersao([], [com({ resolvidoEm: 1 })]).size).toBe(0);
  });
});

describe("proximaRodada (revisão do #677)", () => {
  it("conta só as rodadas da pessoa: a rodada que o bot grava não empurra a dela para fora do CHECK da 0152", () => {
    const cs = [{ autorTipo: "pessoa" as const, rodada: 2 }, { autorTipo: "bot" as const, rodada: 100000 }, { autorTipo: "importado" as const, rodada: 7 }, { autorTipo: "pessoa" as const, rodada: null }];
    expect(proximaRodada(cs)).toBe(3);
  });
  it("sem rodada da pessoa, começa em 1", () => {
    expect(proximaRodada([{ autorTipo: "bot", rodada: 9 }])).toBe(1);
  });
});

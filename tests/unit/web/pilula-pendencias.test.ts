import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { emOrdemDePrazo, pendenciasDaConversa, pilulaPendenciasVisivel, proximoDoCiclo } from "../../../web/lib/pendencias.ts";
import { renderPilulaPendencias, renderTopoComposer } from "../../../web/telas/pergunta.ts";

/** A pílula "N esperam você" junto do campo (item 10 dos acessos devolvidos; Paper "Acessos · pendências", P1–P6). */

const C = "c1";
const AGORA = Date.parse("2026-10-03T14:45:00Z");
const MIN = 60_000;

type Item = SuaVezDto["itens"][number];

function pedido(id: string, o: { tipo?: TipoDecisao; venceEmMin?: number; criadoEm?: string; conversaId?: string; vencido?: boolean; rotina?: boolean; frase?: string } = {}): Item {
  const vence = o.venceEmMin ?? 23 * 60;
  return {
    decisao: {
      tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: o.conversaId ?? C, turnoId: null, tipo: o.tipo ?? "aprovacao", estado: "pendente",
      prazoDecisaoEm: new Date(AGORA + vence * MIN).toISOString(), prazoExecucaoEm: null, frase: o.frase ?? `Pedido ${id}`, desfecho: null, vistaEm: null,
      criadoEm: o.criadoEm ?? "2026-10-03T14:40:00Z", fioId: null,
    },
    estadoColuna: o.vencido ? "vencido" : "pendente", agenteNome: "Ada", aguardandoHaMs: 5 * MIN, recusaAutomaticaEmMs: vence * MIN, gemeas: [], itensAprovacao: [],
    proposta: o.rotina ? ({ payload: { kind: "acesso", rotinaId: "r1" } } as never) : null, fio: null, rotinaParada: null,
  } as Item;
}

function cenario(itens: Item[], extra: Partial<Estado> = {}): Estado {
  return { ...estadoInicial, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never, suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null }, ...extra };
}

describe("o que a pílula conta", () => {
  it("sem pedido, ou só com pergunta, sai vazia", () => {
    expect(renderPilulaPendencias(cenario([]), C)).toBe("");
    expect(renderPilulaPendencias(cenario([pedido("q1", { tipo: "pergunta" }), pedido("q2", { tipo: "falta_de_dado" })]), C)).toBe("");
  });

  it("1 aprovação dá '1 espera você'; aprovação + gate de rotina dão '2 esperam você'", () => {
    expect(renderPilulaPendencias(cenario([pedido("d1")]), C)).toContain("<b>1</b> espera você");
    expect(renderPilulaPendencias(cenario([pedido("d1"), pedido("g1", { tipo: "gate_rotina" })]), C)).toContain("<b>2</b> esperam você");
  });

  it("o vencido e o de outra conversa não contam", () => {
    const itens = [pedido("d1"), pedido("v1", { vencido: true }), pedido("o1", { conversaId: "outra" })];
    expect(pendenciasDaConversa({ itens }, C).map((i) => i.decisao.id)).toEqual(["d1"]);
    expect(renderPilulaPendencias(cenario(itens), C)).toContain("<b>1</b> espera você");
  });
});

describe("o prazo na pílula", () => {
  it("sem urgência (1 h ou mais), neutra: sem o trecho do prazo e sem a classe de aviso", () => {
    const html = renderPilulaPendencias(cenario([pedido("d1", { venceEmMin: 90 })]), C);
    expect(html).not.toContain("pp-prazo");
    expect(html).not.toContain("perto");
    expect(html).toContain('aria-label="Ver o que espera você: 1 pedido"');
  });

  it("aprovação e acesso a menos de 60 min: 'recusa automática em N min', com o curto do celular ao lado", () => {
    const html = renderPilulaPendencias(cenario([pedido("d1", { venceEmMin: 12 }), pedido("a1", { tipo: "acesso", venceEmMin: 120 })]), C);
    expect(html).toContain('class="pilula-pend perto"');
    expect(html).toContain('<span class="pp-longo">recusa automática em 12 min</span><span class="pp-curto">12 min</span>');
    expect(html).toContain('aria-label="Ver o que espera você: 2 pedidos, o primeiro recusa automática em 12 min"');
    const acesso = renderPilulaPendencias(cenario([pedido("a1", { tipo: "acesso", venceEmMin: 30 })]), C);
    expect(acesso).toContain("recusa automática em 30 min");
  });

  it("os outros tipos dizem 'vence em' (sem o resto da frase do cartão); o acesso de rotina diz que ela pausa", () => {
    expect(renderPilulaPendencias(cenario([pedido("r1", { tipo: "rotina", venceEmMin: 25 })]), C)).toContain('<span class="pp-longo">vence em 25 min</span>');
    expect(renderPilulaPendencias(cenario([pedido("t1", { tipo: "retomar_turno", venceEmMin: 25 })]), C)).toContain('<span class="pp-longo">vence em 25 min</span>');
    expect(renderPilulaPendencias(cenario([pedido("a1", { tipo: "acesso", venceEmMin: 20, rotina: true })]), C)).toContain("a rotina pausa sozinha em 20 min");
  });
});

describe("o clique e o ×", () => {
  it("o botão leva (ver-decisao) ao que vence primeiro, não ao mais antigo; title com a frase dele; o × é outro botão", () => {
    const itens = [pedido("antigo", { venceEmMin: 120, criadoEm: "2026-10-03T14:00:00Z" }), pedido("urgente", { venceEmMin: 12, criadoEm: "2026-10-03T14:30:00Z", frase: "Dante quer publicar no #time-produto" })];
    const html = renderPilulaPendencias(cenario(itens), C);
    expect(html).toContain('data-act="ver-decisao" data-id="urgente" data-pendencias="c1"');
    expect(html).toContain('title="Dante quer publicar no #time-produto\nEnter leva ao pedido · de novo, ao próximo"');
    expect(html).toContain('<button type="button" class="pp-dispensar" data-act="dispensar-pendencias" data-conversa="c1" aria-label="Esconder até chegar outro pedido"');
    expect(emOrdemDePrazo(itens, AGORA).map((i) => i.decisao.id)).toEqual(["urgente", "antigo"]);
  });

  it("o ciclo: o primeiro, depois o seguinte, e volta ao começo; o visto que saiu da lista recomeça", () => {
    expect(proximoDoCiclo([], null)).toBeNull();
    expect(proximoDoCiclo(["a", "b"], null)).toBe("a");
    expect(proximoDoCiclo(["a", "b"], "a")).toBe("b");
    expect(proximoDoCiclo(["a", "b"], "b")).toBe("a");
    expect(proximoDoCiclo(["a", "b"], "sumiu")).toBe("a");
  });

  it("reducer: dispensar esconde a pílula; um id novo a traz de volta; o dispensado a menos de 10 min de vencer também", () => {
    const d1 = pedido("d1", { venceEmMin: 45 });
    const e = reduzir(cenario([d1]), { tipo: "dispensar-pendencias", conversaId: C, ids: ["d1"] });
    expect(e.pendenciasDispensadas[C]).toEqual(["d1"]);
    expect(renderPilulaPendencias(e, C)).toBe("");
    // Outra conversa não é afetada.
    expect(renderPilulaPendencias({ ...e, suaVez: { ...e.suaVez!, itens: [pedido("x1", { conversaId: "c2" })] } }, "c2")).toContain("espera você");
    // Chegou um pedido novo.
    expect(renderPilulaPendencias({ ...e, suaVez: { ...e.suaVez!, itens: [d1, pedido("d2")] } }, C)).toContain("<b>2</b> esperam você");
    // O relógio andou: o dispensado entrou nos últimos 10 min.
    expect(pilulaPendenciasVisivel([d1], ["d1"], AGORA + 36 * MIN)).toBe(true);
    expect(renderPilulaPendencias({ ...e, agora: AGORA + 36 * MIN }, C)).toContain("recusa automática em 9 min");
  });

  it("dispensar não persiste: o estado inicial começa sem nenhum dispensado", () => {
    expect(estadoInicial.pendenciasDispensadas).toEqual({});
  });
});

describe("o lugar e o desenho", () => {
  it("o topo do campo continua sem a lista: a pílula vem por renderPilulaPendencias, numa região própria antes da de Trabalhos", () => {
    const e = cenario([pedido("d1"), pedido("g1", { tipo: "gate_rotina" })]);
    expect(renderTopoComposer({ tipo: "normal" } as never, e, C)).toBe("");
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html).toMatch(/<div class="lugar-pendencias" id="pendencias"><\/div>\n[^\n]*\n\s*<div class="lugar-faixa-trabalhos" id="faixa-trabalhos">/);
  });

  it("CSS: neutra em repouso, aviso no prazo (texto e borda), × escondido e 44 px no celular; sem cor literal", () => {
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    const casca = readFileSync(new URL("../../../web/casca.css", import.meta.url), "utf8");
    const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.pp-prazo \{[^}]*background: var\(--warning-soft\); color: var\(--warning\);/);
    expect(css).toMatch(/\.pilula-pend\.perto \{ border-color: var\(--warning-line\); \}/);
    expect(css).not.toMatch(/\.espera-cab|\.esp-txt/);
    expect(casca).toMatch(/\.lugar-pendencias:not\(:empty\) \+ \.lugar-faixa-trabalhos \.pt-precisa \{ display: none; \}/);
    expect(mobile).toMatch(/\.pp-dispensar \{ display: none; \}/);
    expect(mobile).toMatch(/\.lugar-pendencias \.pilula-pend \{ height: 44px; \}/);
    const regras = [css, casca, mobile].flatMap((t) => t.split("\n").filter((l) => /pilula-pend|pp-|lugar-pendencias|pend-lugar/.test(l)));
    expect(regras.length).toBeGreaterThan(10);
    for (const l of regras) expect(l).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { EntradaDiario, Memoria } from "../../../src/contracts/memoria.ts";
import { estadoInicial, reduzir, type Estado, type NivelGaveta } from "../../../web/estado/reducer.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { focarDeNovo } from "../../../web/lib/regioes.ts";
import { focarNaMemoriaSeCaiu, type AcaoDaMemoria } from "../../../web/lib/foco-da-memoria.ts";

/**
 * QA-164: as ações do Histórico da Memória (Revisado, Desfazer, Marcar tudo como revisado) e o Desfazer da linha "Apagada"
 * tiram do DOM o botão apertado pelo teclado. O redesenho procura o mesmo botão (`focarDeNovo`), não acha e o foco cai no
 * `<body>`. Estes testes desenham a gaveta antes e depois com o HTML real (`renderDetalhes`).
 */
type AgenteFrota = FrotaDto["agentes"][number];
const ada: AgenteFrota = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null };
const AGORA = Date.parse("2026-10-28T15:00:00");
const com = (nivel: NivelGaveta, extra: Partial<Estado> = {}): Estado =>
  ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [ada], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, gaveta: { agenteId: "a1", nivel }, ...extra }) as Estado;
const ent = (id: string, extra: Partial<EntradaDiario> = {}): EntradaDiario => ({ id, agenteId: "a1", memoriaId: "m1", acao: "criada", autor: "agente", antes: null, depois: { tipo: "preferencia", texto: "sexta à tarde" }, desfazId: null, desfeitaEm: null, revisadaEm: null, criadoEm: AGORA - 60_000, ...extra });
const mem = (id: string, texto: string): Memoria => ({ tenantId: "t", id, agenteId: "a1", tipo: "fato", texto, origem: "agente", criadoEm: AGORA - 3_600_000 });
const historico = (entradas: EntradaDiario[], aRevisar: number) =>
  reduzir(com({ tipo: "memoria", aba: "historico" }, { memorias: { a1: [] } }), { tipo: "hidratar-diario", agenteId: "a1", pagina: { entradas, mais: false, aRevisar } });

/** Sem dono: no Chrome é o <body>; no happy-dom, null ou o nó que já saiu do DOM. */
const caiu = (a: Element | null): boolean => a === null || a === document.body || !a.isConnected;

let detalhes: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<aside id="detalhes"></aside>';
  detalhes = document.getElementById("detalhes")!;
});

/** Desenha o antes, foca o botão, desenha o depois como o main faz (innerHTML + focarDeNovo) e devolve o ativo. */
function apertarPeloTeclado(antes: Estado, seletor: string, depois: Estado, acao?: AcaoDaMemoria): Element | null {
  detalhes.innerHTML = renderDetalhes(antes);
  const botao = detalhes.querySelector<HTMLElement>(seletor);
  expect(botao, seletor).not.toBeNull();
  botao!.focus();
  expect(document.activeElement).toBe(botao);
  detalhes.innerHTML = renderDetalhes(depois);
  if (!botao!.isConnected) focarDeNovo(botao!, detalhes);
  if (acao) focarNaMemoriaSeCaiu(document, acao);
  return document.activeElement;
}

describe("QA-164: o foco não cai no body nas ações da Memória", () => {
  const e1 = ent("e1");
  const e2 = ent("e2", { memoriaId: "m2", criadoEm: AGORA - 120_000 });

  it("na main (sem o destino), Desfazer, Marcar tudo e o Desfazer da Apagada deixam o foco no body", () => {
    const antes = historico([e1, e2], 2);
    expect(caiu(apertarPeloTeclado(antes, '[data-act="desfazer-entrada"][data-id="e1"]', historico([{ ...e1, desfeitaEm: AGORA }, e2], 1)))).toBe(true);
    expect(caiu(apertarPeloTeclado(antes, '[data-act="revisar-tudo"]', historico([{ ...e1, revisadaEm: AGORA }, { ...e2, revisadaEm: AGORA }], 0)))).toBe(true);
    const comApagada = reduzir(com({ tipo: "memoria" }, { memorias: { a1: [] } }), { tipo: "memoria-apagada", agenteId: "a1", apagada: { memoriaId: "m1", tipo: "fato", texto: "café sem açúcar", criadoEm: AGORA } });
    const semLinha = reduzir(comApagada, { tipo: "memoria-apagada-sai", agenteId: "a1", memoriaId: "m1" });
    expect(caiu(apertarPeloTeclado(comApagada, '[data-act="desfazer-apagada"][data-id="m1"]', semLinha))).toBe(true);
  });

  it("Revisado (já ok na main, pelo data-id): o foco vai ao Desfazer da mesma entrada", () => {
    const ativo = apertarPeloTeclado(historico([e1, e2], 2), '[data-act="revisar-entrada"][data-id="e1"]', historico([{ ...e1, revisadaEm: AGORA }, e2], 1), { tipo: "revisar-entrada", entradaId: "e1" });
    expect((ativo as HTMLElement).dataset.act).toBe("desfazer-entrada");
    expect((ativo as HTMLElement).dataset.id).toBe("e1");
  });

  it("Desfazer no Histórico: o foco fica na própria entrada (agora desfeita), não no topo", () => {
    const ativo = apertarPeloTeclado(historico([e1, e2], 2), '[data-act="desfazer-entrada"][data-id="e1"]', historico([{ ...e1, desfeitaEm: AGORA }, e2], 1), { tipo: "desfazer-entrada", entradaId: "e1" }) as HTMLElement;
    expect(ativo.dataset.entrada).toBe("e1");
    expect(ativo.getAttribute("tabindex")).toBe("-1");
  });

  it("Marcar tudo como revisado: o foco vai ao primeiro Desfazer da lista", () => {
    const ativo = apertarPeloTeclado(historico([e1, e2], 2), '[data-act="revisar-tudo"]', historico([{ ...e1, revisadaEm: AGORA }, { ...e2, revisadaEm: AGORA }], 0), { tipo: "revisar-tudo" }) as HTMLElement;
    expect(ativo.dataset.act).toBe("desfazer-entrada");
  });

  it("Desfazer da linha Apagada: sem a memória ainda relida, o foco vai à aba Memórias; relida, à própria memória", () => {
    const comApagada = reduzir(com({ tipo: "memoria" }, { memorias: { a1: [] } }), { tipo: "memoria-apagada", agenteId: "a1", apagada: { memoriaId: "m1", tipo: "fato", texto: "café sem açúcar", criadoEm: AGORA } });
    const semLinha = reduzir(comApagada, { tipo: "memoria-apagada-sai", agenteId: "a1", memoriaId: "m1" });
    const ativo = apertarPeloTeclado(comApagada, '[data-act="desfazer-apagada"][data-id="m1"]', semLinha, { tipo: "desfazer-apagada", memoriaId: "m1" }) as HTMLElement;
    expect(ativo.dataset.aba).toBe("memorias");
    detalhes.innerHTML = renderDetalhes(com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "café sem açúcar")] } }));
    (document.activeElement as HTMLElement | null)?.blur();
    expect((focarNaMemoriaSeCaiu(document, { tipo: "desfazer-apagada", memoriaId: "m1" }) as HTMLElement).dataset.memCorpo).toBe("m1");
  });

  it("foco que a pessoa já levou para outro controle não é mexido", () => {
    detalhes.innerHTML = renderDetalhes(historico([e1, e2], 2));
    const outro = detalhes.querySelector<HTMLElement>('[data-act="desfazer-entrada"][data-id="e2"]')!;
    outro.focus();
    expect(focarNaMemoriaSeCaiu(document, { tipo: "revisar-entrada", entradaId: "e1" })).toBeNull();
    expect(document.activeElement).toBe(outro);
  });
});

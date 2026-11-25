import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColunaDto, QuadroDto, TarefaDto } from "../../../../../src/contracts/quadro.ts";
import { gruposDasTarefas, quantasPerguntaram, resumoDosQuadros, type FiltrosDasTarefas, type QuadroComProjeto, type VistaDasTarefas } from "../../../../../web/lib/tarefas-de-todos.ts";
import { criarTarefasDeTodosNaTela, type ApiDasTarefas, type DadosDasTarefas } from "../../../../../web/lib/tarefas-de-todos-na-tela.ts";
import { renderTarefasDeTodos } from "../../../../../web/telas/tarefas-de-todos.ts";
import { TelaTarefasDeTodos, type AcoesDasTarefas } from "../../../../../web/react/telas/tarefas-de-todos.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): Tarefas de todos os bots em React. O DOM é o da tela por string (sem os
 * `data-act`, que viraram props); a vista, a busca e os filtros são estado da tela; os quadros vêm do controlador.
 */
const AGORA = 1_800_000_000_000;
const MIN = 60_000;
const col = (id: string, nome: string, grupo: ColunaDto["grupo"]): ColunaDto => ({ id, nome, grupo, fixa: false, daPessoa: false, recolhida: false } as ColunaDto);
const COLUNAS = [col("backlog", "Backlog", "nao_iniciado"), col("afazer", "A fazer", "nao_iniciado"), col("fazendo", "Fazendo", "iniciado"), col("revisao", "Em revisão", "iniciado"), col("bloqueado", "Bloqueado", "iniciado"), col("feito", "Feito", "feito"), col("cancelado", "Cancelado", "fechado")];
const tarefa = (codigo: string, ordem: number, status: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id: `t-${codigo}`, quadroId: "q", titulo: `Tarefa ${codigo}`, descricao: "", status, voltarPara: null, agenteId: "dante", ordem, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: AGORA - 864e5, mudadoEm: AGORA - 30 * MIN, execucao: null, agenteNome: "Dante", codigo, branch: "", prioridade: "sem", ...extra,
} as TarefaDto);
const quadro = (id: string, agenteId: string, nome: string, projetoId: string | null, tarefas: TarefaDto[], feitas = 1, total = 4): QuadroDto =>
  ({ id, agenteId, agenteNome: agenteId, nome, projetoId, prefixo: null, colunas: COLUNAS, tarefas, feitas, total } as unknown as QuadroDto);
const QS: QuadroComProjeto[] = [
  { projeto: "Produto", quadro: quadro("q1", "ada", "Quadro NOD", "pj1", [
    tarefa("NOD-2", 2, "revisao", { esperaPessoa: true, agenteId: "chico", agenteNome: "Chico" }),
    tarefa("NOD-1", 1, "fazendo", { execucao: "rodando", trabalhandoDesde: AGORA - 2 * MIN, prioridade: "alta" }),
    tarefa("NOD-3", 3, "fazendo", { execucao: "fila", naFilaDesde: AGORA - 3 * MIN, prioridade: "urgente" }),
    tarefa("NOD-9", 9, "feito"),
  ], 7, 17) },
  { projeto: null, quadro: quadro("q2", "gil", "Site do nod", null, [tarefa("SIT-1", 1, "afazer", { agenteId: null, agenteNome: null, mudadoEm: AGORA - 26 * 36e5 })], 1, 5) },
];
const avatar = (id: string | null): string => (id ? `<nod-mascote class="icon mascote c-red shape-drop sm" data-mascote="" title="${id}"></nod-mascote>` : "");

function fonteDe(d: DadosDasTarefas) {
  const ouvintes = new Set<() => void>();
  let atual = d;
  return { dados: () => atual, assinar: (o: () => void) => { ouvintes.add(o); return () => ouvintes.delete(o); }, tentarDeNovo: vi.fn(), trocar: (n: DadosDasTarefas) => { atual = n; for (const o of ouvintes) o(); } };
}
const acoesDe = (d: DadosDasTarefas): AcoesDasTarefas & { fonte: ReturnType<typeof fonteDe>; abrirTarefa: ReturnType<typeof vi.fn>; abrirPagina: ReturnType<typeof vi.fn> } =>
  ({ fonte: fonteDe(d), avatar, abrirTarefa: vi.fn(), abrirPagina: vi.fn(), agora: () => AGORA });

const ACOES = new Set(["tdt-vista", "tdt-aberto", "tdt-prioridade", "tdt-reler", "tdt-abrir", "tdt-pagina", "tdt-nova"]);
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-act]")) {
    const act = n.getAttribute("data-act") ?? "";
    if (!ACOES.has(act)) continue;
    n.removeAttribute("data-act");
    if (act === "tdt-vista") n.removeAttribute("data-vista");
  }
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.name === "style" ? a.value.replace(/\s|;$/g, "") : a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><");
}
function porString(d: DadosDasTarefas, vista: VistaDasTarefas = "quadro", filtros: FiltrosDasTarefas = { busca: "", emAberto: true, porPrioridade: false }): Element {
  const carga = d.erro ? { tipo: "erro" as const, mensagem: d.erro } : !d.quadros ? { tipo: "carregando" as const }
    : { tipo: "pronto" as const, grupos: gruposDasTarefas(d.quadros, vista, filtros, AGORA), resumo: resumoDosQuadros(d.quadros), perguntaram: quantasPerguntaram(d.quadros, AGORA), total: d.quadros.length };
  const el = document.createElement("div");
  el.innerHTML = renderTarefasDeTodos({ carga, vista, filtros, avatar });
  return el.firstElementChild!;
}

describe("Tarefas de todos em React", () => {
  for (const [nome, d] of [["carregando", { quadros: null, erro: null }], ["erro", { quadros: null, erro: "Não deu para ler os quadros." }], ["sem quadros", { quadros: [], erro: null }], ["com quadros", { quadros: QS, erro: null }]] as const) {
    it(`o DOM é o da tela por string (${nome})`, () => {
      const { container } = render(<TelaTarefasDeTodos acoes={acoesDe(d as DadosDasTarefas)} />);
      expect(container.querySelector("[data-act]")).toBeNull();
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(d as DadosDasTarefas)));
    });
  }

  it("QA-181: o Você leva as iniciais de quem lê, como a tela por string", () => {
    const d = { quadros: QS, erro: null };
    const { container } = render(<TelaTarefasDeTodos acoes={{ ...acoesDe(d), voce: () => "Beatriz Souza" }} />);
    expect([...container.querySelectorAll(".tdt-voce")].map((e) => e.textContent)).toEqual(["BS"]);
    const el = document.createElement("div");
    el.innerHTML = renderTarefasDeTodos({ carga: { tipo: "pronto", grupos: gruposDasTarefas(QS, "quadro", { busca: "", emAberto: true, porPrioridade: false }, AGORA), resumo: resumoDosQuadros(QS), perguntaram: quantasPerguntaram(QS, AGORA), total: QS.length }, vista: "quadro", filtros: { busca: "", emAberto: true, porPrioridade: false }, avatar, voceNome: "Beatriz Souza" });
    expect(normalizar(container.firstElementChild!)).toBe(normalizar(el.firstElementChild!));
  });

  it("a vista, a busca e os filtros são da tela: o mesmo DOM que a por string com as mesmas escolhas", () => {
    const acoes = acoesDe({ quadros: QS, erro: null });
    const { container } = render(<TelaTarefasDeTodos acoes={acoes} />);
    fireEvent.click([...container.querySelectorAll(".tdt-seg-bt")][1]!);
    fireEvent.click(container.querySelector(".tdt-filtro")!);
    const campo = container.querySelector<HTMLInputElement>(".tdt-busca-campo")!;
    fireEvent.change(campo, { target: { value: "nod" } });
    expect(container.querySelector(".tdt-busca-campo")).toBe(campo);
    expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString({ quadros: QS, erro: null }, "bot", { busca: "nod", emAberto: false, porPrioridade: false })));
  });

  it("as ações chegam por prop e a releitura do controlador redesenha", () => {
    const acoes = acoesDe({ quadros: QS, erro: null });
    const { container } = render(<TelaTarefasDeTodos acoes={acoes} />);
    fireEvent.click(container.querySelector('.tdt-linha-bt[data-tarefa="t-NOD-1"]')!);
    expect(acoes.abrirTarefa).toHaveBeenCalledWith("ada", "t-NOD-1", "q1");
    fireEvent.click(container.querySelector("button.tdt-cab")!);
    expect(acoes.abrirPagina).toHaveBeenCalledWith("ada", "q1");
    fireEvent.click(container.querySelector(".tdt-nova")!);
    expect(acoes.abrirPagina).toHaveBeenLastCalledWith("ada", "q1");
    act(() => acoes.fonte.trocar({ quadros: QS.slice(1), erro: null }));
    expect(container.querySelectorAll(".tdt-grupo")).toHaveLength(1);
    act(() => acoes.fonte.trocar({ quadros: null, erro: "Não deu para ler os quadros." }));
    fireEvent.click(container.querySelector(".tdt-link")!);
    expect(acoes.fonte.tentarDeNovo).toHaveBeenCalled();
  });
  it("QA-147: a vista, a busca e os filtros ficam ao sair e voltar à tela, como na por string", async () => {
    const api: ApiDasTarefas = {
      quadros: async () => ({ quadros: QS.map((q) => ({ id: q.quadro.id, agenteId: q.quadro.agenteId })) as never }),
      quadroPorId: async (qid) => ({ quadro: QS.find((q) => q.quadro.id === qid)!.quadro }),
      quadrosDoBot: async () => ({ projetos: [{ id: "pj1", nome: "Produto" }] }) as never,
    };
    const controlador = criarTarefasDeTodosNaTela(document, { api: () => api, avatar, abrirTarefa: vi.fn(), abrirPagina: vi.fn(), agora: () => AGORA });
    const acoes: AcoesDasTarefas = { fonte: controlador, avatar, abrirTarefa: vi.fn(), abrirPagina: vi.fn(), agora: () => AGORA };
    controlador.abrir();
    const primeira = render(<TelaTarefasDeTodos acoes={acoes} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click([...primeira.container.querySelectorAll(".tdt-seg-bt")][1]!);
    fireEvent.click(primeira.container.querySelector(".tdt-filtro")!);
    fireEvent.change(primeira.container.querySelector<HTMLInputElement>(".tdt-busca-campo")!, { target: { value: "nod" } });
    // Abrir um card navega para a conversa do dono: a tela desmonta e o controlador fecha; voltar abre de novo.
    primeira.unmount();
    controlador.fechar();
    controlador.abrir();
    const segunda = render(<TelaTarefasDeTodos acoes={acoes} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(segunda.container.querySelector<HTMLInputElement>(".tdt-busca-campo")!.value).toBe("nod");
    expect(normalizar(segunda.container.firstElementChild!)).toBe(normalizar(porString(controlador.dados(), "bot", { busca: "nod", emAberto: false, porPrioridade: false })));
  });
});

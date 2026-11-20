import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DonoDto, EstadoDoDono, PedidoNaFilaDto } from "../../../../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado, type Tela } from "../../../../../web/estado/reducer.ts";
import { renderTelaTarefas } from "../../../../../web/telas/tela-tarefas.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaTarefas, type AcoesDasTarefasDosBots } from "../../../../../web/react/telas/tarefas.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): a tela Tarefas (Por bot e Por estado) em React. O DOM é o da tela por string
 * (sem os `data-act` das ações da tela, que viraram props), nas duas vistas e com os chips.
 */
const MIN = 60_000;
const AGORA = new Date(2026, 9, 11, 18, 33).getTime();
const estadoDono = (extra: Partial<EstadoDoDono> = {}): EstadoDoDono => ({ agenteId: "ze1", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null, ...extra });
const dono = (e: Partial<EstadoDoDono> = {}, fila: PedidoNaFilaDto[] = []): DonoDto => ({ estado: estadoDono(e), esperas: [], fila });
const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "ze1", conversaId: "c-ze1", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 20 * MIN, iniciadoEm: AGORA - 18 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});
const AGENTES = [
  { id: "ze1", nome: "Ze 1", conversaId: "c-ze1", cor: "c-red", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
  { id: "ze2", nome: "Ze 2", conversaId: "c-ze2", cor: "c-teal", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
  { id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-red", forma: "shape-square", ownerId: "p", titulo: "Tech Lead", descricao: "", confirmado: true },
  { id: "nod", nome: "Nod", conversaId: "c-nod", cor: "c-black", forma: "shape-circle", ownerId: "p", titulo: "", descricao: "", confirmado: true, papel: "nod" },
];
const TRABALHOS = [
  trabalho("t1", { titulo: "Migrar relatórios", ultimoPasso: "18 de 42" }),
  trabalho("t2", { estado: "precisa_de_voce", titulo: "Escolher o layout" }),
  trabalho("t3", { estado: "na_fila", titulo: "Dashboard <churn>" }),
  trabalho("t4", { estado: "rodando", titulo: "Outro" }), trabalho("t5", { estado: "rodando", titulo: "Mais um", loteId: "L" } as never), trabalho("t6", { estado: "rodando", titulo: "E mais um", loteId: "L" } as never),
  trabalho("t7", { estado: "terminado", titulo: "Feita hoje", terminadoEm: AGORA - 5 * MIN, agenteId: "leo", conversaId: "c-leo" }),
  trabalho("t8", { estado: "rodando", titulo: "Do quadro", origem: "quadro", agenteId: "ze2", conversaId: "c-ze2" }),
];
const DONOS = [dono({ agenteId: "ze1", principal: "trabalhando", frentes: 5, desde: AGORA - 18 * MIN }, [{ turnoId: "p1", de: "colega", nome: "Leonardo", desde: AGORA - 9 * MIN }]), dono({ agenteId: "ze2", principal: "trabalhando", frentes: 1, desde: AGORA - 70 * MIN })];
const estadoCom = (tela: Tela, extra: Partial<Estado> = {}): Estado => ({
  ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: AGENTES } as never,
  trabalhos: { trabalhos: TRABALHOS, pressao: null, memoriaTotalMb: null, donos: DONOS }, tela,
  suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null }, ...extra,
} as Estado);

const ACOES = new Set(["vista-tarefas", "mostrar-tarefas", "bots-tarefas", "nova-tarefa", "bot-trabalhos", "abrir-trabalho", "abrir-conversa"]);
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-act]")) {
    const act = n.getAttribute("data-act") ?? "";
    if (!ACOES.has(act)) continue;
    n.removeAttribute("data-act");
    // Os ids que só serviam à delegação (a vista e o chip); os das linhas (data-id da tarefa, data-agente) ficam.
    if ((act === "vista-tarefas" && n.classList.contains("tf-vista-op")) || act === "mostrar-tarefas") n.removeAttribute("data-id");
  }
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><");
}
const porString = (e: Estado): Element => { const d = document.createElement("div"); d.innerHTML = renderTelaTarefas(e, e.tela.tipo === "trabalhos" ? e.tela : undefined); return d.firstElementChild!; };
const acoesFalsas = (): { [K in keyof AcoesDasTarefasDosBots]: ReturnType<typeof vi.fn> } =>
  ({ vista: vi.fn(), mostrar: vi.fn(), menuDeBots: vi.fn(), novaTarefa: vi.fn(), alternarBot: vi.fn(), abrirTrabalho: vi.fn(), abrirConversa: vi.fn() });

describe("a tela Tarefas em React", () => {
  const casos: [string, Estado][] = [
    ["carregando", estadoCom({ tipo: "trabalhos" }, { trabalhos: null })],
    ["Por bot", estadoCom({ tipo: "trabalhos" })],
    ["Por bot com um bot aberto (a fila, o + N tarefas)", estadoCom({ tipo: "trabalhos" }, { botAbertoEmTrabalhos: "ze1" })],
    ["Por bot, Feitas, bot aberto", estadoCom({ tipo: "trabalhos", mostrar: "feitas" }, { botAbertoEmTrabalhos: "leo" })],
    ["Por bot, Todas", estadoCom({ tipo: "trabalhos", mostrar: "todas" })],
    ["Por bot, um bot escolhido", estadoCom({ tipo: "trabalhos", bot: "ze2" })],
    ["Por estado, Todas", estadoCom({ tipo: "trabalhos", filtro: "todos", mostrar: "todas" })],
    ["Por estado, vazio", estadoCom({ tipo: "trabalhos", filtro: "todos", mostrar: "feitas", bot: "ze2" })],
    ["sem donos (só Por estado)", estadoCom({ tipo: "trabalhos" }, { trabalhos: { trabalhos: TRABALHOS, pressao: null, memoriaTotalMb: null } })],
  ];
  for (const [nome, e] of casos) {
    it(`o DOM é o da tela por string (${nome})`, () => {
      const { container } = render(<TelaTarefas loja={criarLoja(() => e)} acoes={acoesFalsas()} />);
      expect([...container.querySelectorAll("[data-act]")].map((n) => n.getAttribute("data-act")).filter((a) => ACOES.has(a ?? ""))).toEqual([]);
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(e)));
    });
  }

  it("as ações chegam por prop", () => {
    const acoes = acoesFalsas();
    const e = estadoCom({ tipo: "trabalhos" }, { botAbertoEmTrabalhos: "ze1" });
    const { container } = render(<TelaTarefas loja={criarLoja(() => e)} acoes={acoes} />);
    fireEvent.click(container.querySelectorAll(".tf-vista-op")[1]!);
    expect(acoes.vista).toHaveBeenCalledWith(true);
    fireEvent.click(container.querySelectorAll(".tf-chip")[1]!);
    expect(acoes.mostrar).toHaveBeenCalledWith("feitas");
    const bots = container.querySelector<HTMLElement>(".tf-chip-bots")!;
    fireEvent.click(bots);
    expect(acoes.menuDeBots).toHaveBeenCalledWith(bots);
    const nova = container.querySelector<HTMLElement>(".tf-nova")!;
    fireEvent.click(nova);
    expect(acoes.novaTarefa).toHaveBeenCalledWith(nova);
    fireEvent.click(container.querySelector('.tf-linha-bot[data-agente="ze1"]')!);
    expect(acoes.alternarBot).toHaveBeenCalledWith("ze1");
    fireEvent.click(container.querySelector(".tf-tarefa-bot[data-id]")!);
    expect(acoes.abrirTrabalho).toHaveBeenCalled();
    fireEvent.click(container.querySelector(".tf-mais")!);
    expect(acoes.vista).toHaveBeenLastCalledWith(true, "ze1");
    fireEvent.click(container.querySelector(".tf-abrir-conversa")!);
    expect(acoes.abrirConversa).toHaveBeenCalledWith("c-ze1", "ze1");
  });
});

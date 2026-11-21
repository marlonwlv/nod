import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrabalhoDto } from "../../../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado, type Tela } from "../../../../../web/estado/reducer.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaTarefas } from "../../../../../web/react/telas/tarefas.tsx";

/**
 * QA-160 (a família do foco no `<body>`, QA-157): na tela Tarefas em React, o "+ N tarefas" de um bot troca para a vista
 * Por estado e o botão sai do DOM; e, na Por estado, a tarefa que muda de grupo (rodando → precisa de você) chegando dado
 * novo é desmontada e montada noutra seção. Nos dois casos o foco caía no `<body>` e o próximo Tab voltava ao topo.
 */
const MIN = 60_000;
const AGORA = new Date(2026, 9, 11, 18, 33).getTime();
const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "ze1", conversaId: "c-ze1", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 20 * MIN, iniciadoEm: AGORA - 18 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});
const AGENTES = [{ id: "ze1", nome: "Ze 1", conversaId: "c-ze1", cor: "c-red", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true }];
const TRABALHOS = ["t1", "t2", "t3", "t4", "t5", "t6"].map((id) => trabalho(id, { titulo: `Tarefa ${id}` }));
const DONO = { estado: { agenteId: "ze1", principal: "trabalhando", frentes: 6, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: AGORA - 18 * MIN }, esperas: [], fila: [] };

let desmontar: (() => void) | null = null;
afterEach(() => { desmontar?.(); desmontar = null; document.body.innerHTML = ""; });
function montar(tela: Tela, extra: Partial<Estado> = {}) {
  let e = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: AGENTES } as never,
    trabalhos: { trabalhos: TRABALHOS, pressao: null, memoriaTotalMb: null, donos: [DONO] }, tela, ...extra } as Estado;
  const loja = criarLoja(() => e);
  const mudar = (f: (e: Estado) => Estado) => act(() => { e = f(e); loja.avisar(); });
  const acoes = { vista: vi.fn((porEstado: boolean, bot?: string) => mudar((x) => ({ ...x, tela: { tipo: "trabalhos", ...(porEstado ? { filtro: "todos" } : {}), ...(bot ? { bot } : {}) } as Tela }))),
    mostrar: vi.fn(), menuDeBots: vi.fn(), novaTarefa: vi.fn(), alternarBot: vi.fn(), abrirTrabalho: vi.fn(), abrirConversa: vi.fn() };
  const t = render(<TelaTarefas loja={loja} acoes={acoes} />, { container: document.body.appendChild(document.createElement("div")) });
  desmontar = t.unmount;
  return { ...t, mudar };
}

describe("QA-160: o foco na tela Tarefas quando o elemento focado sai", () => {
  it("o + N tarefas pelo teclado leva à vista Por estado com o foco no título, não no <body>", () => {
    const t = montar({ tipo: "trabalhos" }, { botAbertoEmTrabalhos: "ze1" });
    const mais = t.container.querySelector<HTMLElement>(".tf-mais")!;
    mais.focus();
    mais.click();
    expect(t.container.querySelector(".tela-tarefas")?.getAttribute("data-vista")).toBe("por-estado");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(t.container.querySelector(".tf-cab h1"));
  });

  it("na Por estado, a tarefa focada que muda de grupo com dado novo continua com o foco", () => {
    const t = montar({ tipo: "trabalhos", filtro: "todos" });
    t.container.querySelector<HTMLElement>('.tf-tarefa[data-id="t3"]')!.focus();
    t.mudar((e) => ({ ...e, trabalhos: { ...e.trabalhos!, trabalhos: e.trabalhos!.trabalhos.map((x) => (x.id === "t3" ? { ...x, estado: "precisa_de_voce" } : x)) } }));
    const t3 = t.container.querySelector<HTMLElement>('.tf-tarefa[data-id="t3"]')!;
    expect(t3.dataset.grupo).not.toBe("rodando");
    expect(document.activeElement).toBe(t3);
  });

  it("a tarefa focada que some (terminou, em Abertas) passa o foco à seguinte", () => {
    const t = montar({ tipo: "trabalhos", filtro: "todos" });
    t.container.querySelector<HTMLElement>('.tf-tarefa[data-id="t3"]')!.focus();
    const ordem = [...t.container.querySelectorAll<HTMLElement>(".tf-tarefa")].map((b) => b.dataset.id);
    const seguinte = ordem[ordem.indexOf("t3") + 1];
    t.mudar((e) => ({ ...e, trabalhos: { ...e.trabalhos!, trabalhos: e.trabalhos!.trabalhos.filter((x) => x.id !== "t3") } }));
    expect(document.activeElement).toBe(t.container.querySelector(`.tf-tarefa[data-id="${seguinte}"]`));
  });

  it("foco fora da tela não é mexido", () => {
    const t = montar({ tipo: "trabalhos", filtro: "todos" });
    const fora = document.body.appendChild(document.createElement("button"));
    fora.focus();
    t.mudar((e) => ({ ...e, trabalhos: { ...e.trabalhos!, trabalhos: e.trabalhos!.trabalhos.filter((x) => x.id !== "t1") } }));
    expect(document.activeElement).toBe(fora);
  });
});

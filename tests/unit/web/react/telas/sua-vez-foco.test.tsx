import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../../../src/contracts/api.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaSuaVez } from "../../../../../web/react/telas/sua-vez.tsx";

/**
 * QA-157: na Sua vez em React (padrão desde o #214), decidir um cartão pelo teclado ou usar "Limpar vencidos" tirava o
 * nó focado da lista quando ela voltava do servidor, e o foco caía no <body> (o próximo Tab ia ao topo da página).
 * Aqui a lista perde o item como no main (a ação invalida "sua-vez" e o item some na releitura).
 */
type Item = SuaVezDto["itens"][number];
const AGORA = Date.parse("2026-11-19T12:00:00-03:00");
function item(id: string, estadoColuna: Item["estadoColuna"] = "pendente"): Item {
  return {
    decisao: { tenantId: "t1", id, ownerId: "p1", decisorId: "p1", agenteId: "a1", conversaId: "c1", turnoId: `t-${id}`, tipo: "acesso", estado: estadoColuna === "vencido" ? "vencida" : "pendente",
      prazoDecisaoEm: new Date(AGORA + 86_400_000).toISOString(), prazoExecucaoEm: null, frase: `Conceder leitura (${id})`, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA - 3_600_000).toISOString(), fioId: null },
    estadoColuna, agenteNome: "Cecília", aguardandoHaMs: 1000, recusaAutomaticaEmMs: 86_400_000, gemeas: [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
  } as Item;
}
let desmontar: (() => void) | null = null;
afterEach(() => { desmontar?.(); desmontar = null; document.body.innerHTML = ""; });
function montar(itens: Item[]) {
  let e: Estado = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t1", pessoaId: "p1" },
    frota: { agentes: [{ id: "a1", nome: "Cecília", cor: "c-red", forma: "shape-drop", ownerId: "p1", conversaId: "c1", confirmado: true }] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } };
  const loja = criarLoja(() => e);
  const tirar = (ids: string[]) => act(() => { const r = e.suaVez!.itens.filter((i) => !ids.includes(i.decisao.id)); e = { ...e, suaVez: { ...e.suaVez!, itens: r, vazio: r.length === 0 } }; loja.avisar(); });
  const t = render(<TelaSuaVez loja={loja} acoes={{ limparVencidos: () => {} }} />, { container: document.body.appendChild(document.createElement("div")) });
  desmontar = t.unmount;
  const botao = (id: string) => t.container.querySelector<HTMLElement>(`[data-decisao="${id}"] button`)!;
  return { ...t, tirar, botao };
}

describe("QA-157: o foco na Sua vez quando o cartão sai", () => {
  it("decidido o cartão do meio pelo teclado, o foco vai ao primeiro botão do seguinte", () => {
    const t = montar([item("d1"), item("d2"), item("d3")]);
    t.botao("d2").focus();
    t.tirar(["d2"]);
    expect(document.activeElement).toBe(t.botao("d3"));
  });

  it("no último cartão vai ao anterior; no único, ao título, com tabindex=-1", () => {
    const t = montar([item("d1"), item("d2")]);
    t.botao("d2").focus();
    t.tirar(["d2"]);
    expect(document.activeElement).toBe(t.botao("d1"));
    t.tirar(["d1"]);
    const h1 = t.container.querySelector(".tela-sua-vez h1");
    expect(document.activeElement).toBe(h1);
    expect(h1?.getAttribute("tabindex")).toBe("-1");
  });

  it("não manda o foco a um vencido recolhido: com só vencidos fechados, vai ao título", () => {
    const t = montar([item("d1"), item("v1", "vencido")]);
    t.botao("d1").focus();
    t.tirar(["d1"]);
    expect(document.activeElement).toBe(t.container.querySelector(".tela-sua-vez h1"));
  });

  it("Limpar vencidos pelo teclado: o foco vai ao título, não ao <body>", () => {
    const t = montar([item("d1"), item("v1", "vencido"), item("v2", "vencido")]);
    t.container.querySelector<HTMLElement>(".dec-limpar")!.focus();
    t.tirar(["v1", "v2"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(t.container.querySelector(".tela-sua-vez h1"));
  });

  it("foco fora da tela e redesenho sem saída de item não são mexidos", () => {
    const t = montar([item("d1"), item("d2")]);
    t.botao("d1").focus();
    t.tirar([]);
    expect(document.activeElement).toBe(t.botao("d1"));
    const fora = document.body.appendChild(document.createElement("button"));
    fora.focus();
    t.tirar(["d1"]);
    expect(document.activeElement).toBe(fora);
  });
});

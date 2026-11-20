import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuaVezDto } from "../../../../../src/contracts/api.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderSuaVez } from "../../../../../web/telas/sua-vez.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaSuaVez } from "../../../../../web/react/telas/sua-vez.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): Sua vez em React. A casca é componente; os cartões são os da tela por string
 * (pelo conversor), com a ação deles; o DOM inteiro é o mesmo.
 */
type Item = SuaVezDto["itens"][number];
const AGORA = Date.parse("2026-11-19T12:00:00-03:00");
function item(id: string, p: { tipo?: Item["decisao"]["tipo"]; frase?: string; estadoColuna?: Item["estadoColuna"]; gemeas?: string[]; agenteId?: string; turnoId?: string } = {}): Item {
  return {
    decisao: { tenantId: "t1", id, ownerId: "p1", decisorId: "p1", agenteId: p.agenteId ?? "a1", conversaId: "c1", turnoId: p.turnoId ?? `t-${id}`, tipo: p.tipo ?? "acesso", estado: p.estadoColuna === "vencido" ? "vencida" : "pendente",
      prazoDecisaoEm: new Date(AGORA + 86_400_000).toISOString(), prazoExecucaoEm: null, frase: p.frase ?? `Conceder leitura em gmail (${id})`, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA - 3_600_000).toISOString(), fioId: null },
    estadoColuna: p.estadoColuna ?? "pendente", agenteNome: "Cecília", aguardandoHaMs: 1000, recusaAutomaticaEmMs: 86_400_000, gemeas: p.gemeas ?? [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
  } as Item;
}
const estadoCom = (sv: SuaVezDto | null): Estado => ({
  ...estadoInicial, agora: AGORA, sessao: { tenantId: "t1", pessoaId: "p1" },
  frota: { agentes: [{ id: "a1", nome: "Cecília", cor: "c-red", forma: "shape-drop", ownerId: "p1", conversaId: "c1", confirmado: true }, { id: "a2", nome: "Leo", cor: "c-black", forma: "shape-cloud", ownerId: "p1", conversaId: "c2", confirmado: true }] } as never,
  suaVez: sv,
});
const sv = (itens: Item[], extra: Partial<SuaVezDto> = {}): SuaVezDto => ({ itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null, ...extra });

function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll('[data-act="limpar-vencidos"]')) n.removeAttribute("data-act");
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.name === "class" ? a.value.trim().split(/\s+/).join(" ") : a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/> /g, ">").replace(/ </g, "<");
}
const porString = (e: Estado): Element => { const d = document.createElement("div"); d.innerHTML = renderSuaVez(e); return d.firstElementChild!; };

describe("Sua vez em React", () => {
  const casos: [string, Estado][] = [
    ["carregando", estadoCom(null)],
    ["vazia", estadoCom(sv([], { ultimaDecisaoEm: new Date(AGORA - 7_200_000).toISOString() } as never))],
    ["fora do ar", estadoCom(sv([], { foraDoAr: [{ nome: "Claude", desde: AGORA - 600_000 }] } as never))],
    ["abertos, gêmeas e vencidos", estadoCom(sv([
      item("d1", { gemeas: ["d1b", "d1c"] }), item("d2", { agenteId: "a2", frase: "Rodar a migração" }),
      item("v1", { estadoColuna: "vencido" }), item("v2", { estadoColuna: "vencido", frase: "Outra" }), item("v3", { estadoColuna: "vencido", tipo: "pergunta", frase: "Qual?" }),
    ]))],
  ];
  for (const [nome, e] of casos) {
    it(`o DOM é o da tela por string (${nome})`, () => {
      const { container } = render(<TelaSuaVez loja={criarLoja(() => e)} acoes={{ limparVencidos: vi.fn() }} />);
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(e)));
    });
  }

  it("Limpar vencidos é prop; os botões dos cartões seguem com a ação deles (a delegação do main)", () => {
    const limparVencidos = vi.fn();
    const e = casos[3]![1];
    const { container } = render(<TelaSuaVez loja={criarLoja(() => e)} acoes={{ limparVencidos }} />);
    expect(container.querySelector('[data-act="limpar-vencidos"]')).toBeNull();
    fireEvent.click(container.querySelector(".dec-limpar")!);
    expect(limparVencidos).toHaveBeenCalledWith(["v1", "v2", "v3"].filter((id) => container.querySelector(`.dec-limpar`)?.getAttribute("data-ids")?.split(",").includes(id)));
    expect(container.querySelectorAll("[data-decisao] [data-act]").length).toBeGreaterThan(0);
  });
});

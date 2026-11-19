import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversaNaoLida } from "../../../../../src/contracts/nao-lidos.ts";
import type { Mensagem } from "../../../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderNaoLidos } from "../../../../../web/telas/nao-lidos.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaNaoLidos, type AcoesDeNaoLidos } from "../../../../../web/react/telas/nao-lidos.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): Não lidos em React. O que importa: o DOM é o da tela por string (o teclado, o
 * deslize e o CSS usam as mesmas classes), sem `data-act` — as ações chegam por prop —, e a tela redesenha pela loja.
 */
const AGORA = new Date(2026, 8, 29, 12, 0).getTime();
const AS_8 = new Date(2026, 8, 29, 8, 0).getTime();
const AUTORIA = { sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const mensagem = (id: string, texto: string, extra: Partial<Mensagem> = {}): Mensagem =>
  ({ tenantId: "t", id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AS_8, autoria: { ...AUTORIA, autor_tipo: "agente", autor_id: "a1" }, ...extra });
const naoLida = (extra: Partial<ConversaNaoLida> = {}): ConversaNaoLida =>
  ({ conversaId: "c1", tipo: "propria", agenteId: "a1", salaId: null, total: 2, primeiraId: "m1", desde: AS_8, ultimaEm: AS_8, mensagens: [mensagem("m2", "Os três <b>pareceres</b> estão prontos.")], daRotina: false, ...extra });
const base: Estado = {
  ...estadoInicial,
  agora: AGORA,
  sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "a1", nome: "Dev 1", titulo: "Dev Sr", cor: "c-green", forma: "shape-cloud", ownerId: "p", conversaId: "c1" }, { id: "a2", nome: "Milton", titulo: "PM", cor: "c-black", forma: "shape-drop", ownerId: "p", conversaId: "c2" }] } as never,
};
const comTudo: Estado = {
  ...base,
  suaVez: { itens: [{ decisao: { id: "d1", agenteId: "a2", tipo: "acesso", estado: "pendente" }, estadoColuna: "pendente", gemeas: [] }], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } as never,
  salas: [{ sala: { id: "s1", nome: "geral" }, membros: [] }] as never,
  naoLidos: { conversas: [naoLida({ daRotina: true, total: 1 }), naoLida({ conversaId: "c2", agenteId: "a2", total: 1 }),
    naoLida({ conversaId: "c9", tipo: "sala", agenteId: null, salaId: "s1", total: 1, mensagens: [mensagem("m9", "Subi a revisão do PR #5.", { conversaId: "c9", autoria: { ...AUTORIA, autor_tipo: "agente", autor_id: "a2" } })] })] },
};

const acoesFalsas = (): { [K in keyof AcoesDeNaoLidos]: ReturnType<typeof vi.fn> } => ({ abrirConversa: vi.fn(), abrirSala: vi.fn(), marcarLida: vi.fn(), marcarTudo: vi.fn() });

/** O DOM como texto comparável: sem os `data-act` (e o que só servia a eles) da tela por string e sem espaço entre tags. */
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-act]")) {
    const act = n.getAttribute("data-act");
    n.removeAttribute("data-act");
    if (act === "abrir-conversa" || act === "abrir-sala") for (const a of ["data-conversa", "data-agente", "data-sala"]) n.removeAttribute(a);
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

function desenharPorString(e: Estado): Element {
  const d = document.createElement("div");
  d.innerHTML = renderNaoLidos(e);
  return d.firstElementChild!;
}

describe("Não lidos em React", () => {
  for (const [nome, e] of [["carregando", { ...base, naoLidos: null }], ["vazia", { ...base, naoLidos: { conversas: [] } }], ["com conversas, sala e pedido aberto", comTudo]] as const) {
    it(`o DOM é o da tela por string (${nome}), sem data-act`, () => {
      const loja = criarLoja(() => e as Estado);
      const { container } = render(<TelaNaoLidos loja={loja} acoes={acoesFalsas()} />);
      expect(container.querySelector("[data-act]")).toBeNull();
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(desenharPorString(e as Estado)));
    });
  }

  it("as ações chegam por prop: a linha abre a conversa ou a sala, o ✓ marca, Marcar tudo marca tudo", () => {
    const acoes = acoesFalsas();
    const { container } = render(<TelaNaoLidos loja={criarLoja(() => comTudo)} acoes={acoes} />);
    const linha = (c: string) => container.querySelector(`.nl-item[data-conversa="${c}"]`)!;
    fireEvent.click(linha("c1").querySelector(".nl-abrir")!);
    expect(acoes.abrirConversa).toHaveBeenCalledWith("c1", "a1");
    fireEvent.click(linha("c9").querySelector(".nl-abrir")!);
    expect(acoes.abrirSala).toHaveBeenCalledWith("s1", "c9");
    fireEvent.click(linha("c2").querySelector(".nl-check")!);
    expect(acoes.marcarLida).toHaveBeenCalledWith("c2", "Milton");
    fireEvent.click(container.querySelector(".nl-tudo")!);
    expect(acoes.marcarTudo).toHaveBeenCalledTimes(1);
  });

  it("redesenha pela loja: a conversa lida sai e o mascote das outras fica no mesmo nó", () => {
    let e: Estado = comTudo;
    const loja = criarLoja(() => e);
    const { container } = render(<TelaNaoLidos loja={loja} acoes={acoesFalsas()} />);
    const mascote = container.querySelector('.nl-item[data-conversa="c2"] nod-mascote');
    expect(mascote).toBeTruthy();
    act(() => { e = { ...e, naoLidos: { conversas: e.naoLidos!.conversas.filter((c) => c.conversaId !== "c1") } }; loja.avisar(); });
    expect(container.querySelector('.nl-item[data-conversa="c1"]')).toBeNull();
    expect(container.querySelector('.nl-item[data-conversa="c2"] nod-mascote')).toBe(mascote);
    expect(container.querySelector(".nl-topo p")?.textContent).toBe("2 conversas · desde as 08:00");
  });

  it("um frame que muda outra parte do estado (a conversa aberta) não redesenha a tela", () => {
    let e: Estado = comTudo;
    const loja = criarLoja(() => e);
    let desenhos = 0;
    const Contador = () => { desenhos++; return <TelaNaoLidos loja={loja} acoes={acoesFalsas()} />; };
    render(<Contador />);
    const antes = document.querySelector(".tela-nao-lidos")!.innerHTML;
    act(() => { e = { ...e, tela: { tipo: "rotinas" } }; loja.avisar(); });
    expect(document.querySelector(".tela-nao-lidos")!.innerHTML).toBe(antes);
    expect(desenhos).toBe(1);
  });
});

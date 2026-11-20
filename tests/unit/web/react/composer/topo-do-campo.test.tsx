import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuaVezDto } from "../../../../../src/contracts/api.ts";
import type { Mensagem } from "../../../../../src/contracts/mensagem.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../../../web/estado/reducer.ts";
import { modoDoComposer } from "../../../../../web/lib/perguntas.ts";
import { renderTopoComposer, topoDoComposer } from "../../../../../web/telas/pergunta.ts";
import { criarTopoNoReact } from "../../../../../web/react/composer/topo-do-campo.tsx";

/** ADR-179 (fase 6, pedaço 2): o topo do campo em React — o DOM do desenho por string; Trocar, × e o × da citação por prop. */
type Item = SuaVezDto["itens"][number];
const AGORA = Date.parse("2026-09-24T12:00:00Z");
const H = 3_600_000;
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const item = (id: string, criadoEm: number): Item => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: "t1", tipo: "pergunta", estado: "pendente", prazoDecisaoEm: new Date(criadoEm + 24 * H).toISOString(), prazoExecucaoEm: null,
    frase: `pergunta ${id}`, desfecho: null, vistaEm: null, criadoEm: new Date(criadoEm).toISOString(), fioId: null },
  estadoColuna: "pendente", agenteNome: "Nina", aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 22 * H, gemeas: [], itensAprovacao: [], proposta: null, fio: null, rotinaParada: null,
} as Item);
const fala = (id: string, decisaoId: string, texto: string, criadoEm: number): Mensagem =>
  ({ tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria, kind: "texto", texto, payload: { kind: "pedido_a_pessoa", decisaoId, opcoes: ["Sim", "Não"] }, confianca: "confiavel", parcial: false, criadoEm } as Mensagem);
const conversa = (mensagens: Mensagem[]): ConversaEstado =>
  ({ conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 } as ConversaEstado);
const duas = (extra: Partial<Estado> = {}): Estado => ({
  ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conversa", conversaId: "c", agenteId: "a" },
  frota: { agentes: [{ id: "a", nome: "Nina", cor: "c-black", forma: "quadrado", conversaId: "c", ownerId: "p", confirmado: true }], inventario: null, negacoes: [] } as never,
  suaVez: { itens: [item("d2", AGORA - H), item("d1", AGORA - 3 * H)], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null },
  conversas: { c: conversa([fala("m1", "d1", "O #845 não fica verde. Como sigo?", AGORA - 3 * H), fala("m2", "d2", "Posso apagar a branch b14-rascunho? Ela já está toda no #845 <e no main>.", AGORA - H)]) },
  ...extra,
} as Estado);

function normalizar(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  for (const n of d.querySelectorAll("[data-act]")) n.removeAttribute("data-act");
  for (const e of d.querySelectorAll("*")) {
    const attrs = [...e.attributes].map((x) => [x.name, x.name === "class" ? x.value.trim() : x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return d.innerHTML;
}

describe("o topo do campo em React", () => {
  const casos: [string, Estado][] = [
    ["duas perguntas abertas", duas()],
    ["uma fala citada", duas({ citacoes: { c: { mensagemId: "m9", trecho: "O deploy de <ontem> caiu", autor: "Nina" } } } as never)],
    ["nada", duas({ suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null } })],
  ];
  for (const [nome, e] of casos) {
    it(`o DOM é o do desenho por string (${nome}), sem data-act`, () => {
      document.body.innerHTML = '<div id="topo"></div>';
      const el = document.getElementById("topo")!;
      const modo = modoDoComposer(e, "c");
      criarTopoNoReact({ cancelarCitacao: vi.fn(), trocar: vi.fn(), outro: vi.fn() }).desenhar(el, topoDoComposer(modo, e, "c"));
      expect(el.querySelector("[data-act]")).toBeNull();
      expect(normalizar(el.innerHTML)).toBe(normalizar(renderTopoComposer(modo, e, "c")));
    });
  }

  it("Trocar, o × da pergunta e o × da citação são props; o mesmo campo troca de caixa no lugar", () => {
    document.body.innerHTML = '<div id="topo"></div>';
    const el = document.getElementById("topo")!;
    const acoes = { cancelarCitacao: vi.fn(), trocar: vi.fn(), outro: vi.fn() };
    const topo = criarTopoNoReact(acoes);
    const e = duas();
    topo.desenhar(el, topoDoComposer(modoDoComposer(e, "c"), e, "c"));
    act(() => { fireEvent.click(el.querySelector(".bt.link")!); });
    act(() => { fireEvent.click(el.querySelector(".rp-fechar")!); });
    expect([acoes.trocar.mock.calls.length, acoes.outro.mock.calls.length]).toEqual([1, 1]);
    topo.desenhar(el, { tipo: "citacao", trecho: "uma fala" });
    act(() => { fireEvent.click(el.querySelector(".caixa-citacao .rp-fechar")!); });
    expect(acoes.cancelarCitacao).toHaveBeenCalledTimes(1);
    topo.desenhar(el, null);
    expect(el.innerHTML).toBe("");
  });
});

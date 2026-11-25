import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RotinaDto } from "../../../../../src/contracts/api.ts";
import type { BloqueioRotina } from "../../../../../src/contracts/rotina.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { renderRotinas } from "../../../../../web/telas/rotinas.ts";
import { criarLoja } from "../../../../../web/react/loja.ts";
import { TelaRotinas, type AcoesDeRotinas } from "../../../../../web/react/telas/rotinas.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): Rotinas em React. O DOM é o da tela por string (sem os `data-act` dos botões
 * da rotina, que viraram props); os pedaços de execucao.ts (a parada, a espera) seguem iguais, com a ação deles.
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-24T09:30:00-03:00");
const ONTEM_13 = Date.parse("2026-09-23T13:00:00-03:00");
const ONTEM_18 = Date.parse("2026-09-23T18:00:00-03:00");
const HOJE_8 = Date.parse("2026-09-24T08:00:00-03:00");
const H = 3_600_000;
const bloqueio: BloqueioRotina = { motivo: "sem_acesso", app: "Gmail", slug: "gmail", decisaoId: "d1", rodaNaHora: true, desde: ONTEM_13, naoRodaram: [HOJE_8, ONTEM_18, ONTEM_13], fusoIana: TZ };
const rotina = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "E-mails às 8h, 13h e 18h", cron: "0 8,13,18 * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: true, fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA + H, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null } as const;
const dto = (o: Partial<RotinaDto> & { id?: string } = {}): RotinaDto => ({ rotina: { ...rotina, ...(o.id ? { id: o.id } : {}) }, proximaExecucao: AGORA + H, bloqueio: null, resumo: "todo dia", espera: null, ...o } as RotinaDto);
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Nina <b>", titulo: "E-mails", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;
const base: Estado = { ...estadoInicial, agora: AGORA, frota: { agentes: [agente] } as never };
const comTudo: Estado = {
  ...base,
  rotinas: [
    dto({ bloqueio }),
    dto({ id: "r2", janelasPuladas: 4 } as never),
    dto({ id: "r3", rotina: { ...rotina, id: "r3", estado: "pausada", exigeAprovacao: false } } as never),
    dto({ id: "r4", perguntaPendente: { decisaoId: "d9", desde: ONTEM_13, tipo: "pergunta" } } as never),
  ],
  execucoes: { r2: [{ desfecho: "falhou", motivo: "timeout", instanteAgendado: HOJE_8, em: HOJE_8 + 60_000 }, { desfecho: "passou_em_branco", motivo: null, instanteAgendado: ONTEM_18, em: ONTEM_18 }] as never, r3: [] },
  ocupado: true,
};

const acoesFalsas = (): { [K in keyof AcoesDeRotinas]: ReturnType<typeof vi.fn> } =>
  ({ pausar: vi.fn(), ativar: vi.fn(), testar: vi.fn(), alternarExecucoes: vi.fn(), abrirConversa: vi.fn(), verPergunta: vi.fn(), novaRotina: vi.fn() });

/** Os botões da rotina perdem o `data-act` (e só ele) na versão React; o resto do DOM é comparado igual. */
const ACOES_DA_ROTINA = new Set(["pausar-rotina", "ativar-rotina", "executar-rotina", "ver-execucoes", "abrir-conversa", "navegar", "ver-pergunta-da-rotina"]);
function normalizar(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll("[data-act]")) {
    if (!ACOES_DA_ROTINA.has(n.getAttribute("data-act") ?? "")) continue;
    if (n.getAttribute("data-act") === "navegar") n.removeAttribute("data-tela");
    n.removeAttribute("data-act");
  }
  const ordenar = (e: Element): void => {
    const attrs = [...e.attributes].map((a) => [a.name, a.name === "class" ? a.value.trim().split(/\s+/).join(" ") : a.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
    for (const f of e.children) ordenar(f);
  };
  ordenar(c);
  return c.outerHTML.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/> /g, ">").replace(/ </g, "<");
}
const porString = (e: Estado): Element => { const d = document.createElement("div"); d.innerHTML = renderRotinas(e); return d.firstElementChild!; };

describe("Rotinas em React", () => {
  for (const [nome, e] of [["vazia", { ...base, rotinas: [] }], ["parada, ativa com execuções, pausada e com pergunta", comTudo]] as const) {
    it(`o DOM é o da tela por string (${nome})`, () => {
      const { container } = render(<TelaRotinas loja={criarLoja(() => e as Estado)} acoes={acoesFalsas()} />);
      expect(normalizar(container.firstElementChild!)).toBe(normalizar(porString(e as Estado)));
    });
  }

  it("os botões da rotina não usam data-act; os pedaços de execucao.ts mantêm a ação deles", () => {
    const { container } = render(<TelaRotinas loja={criarLoja(() => comTudo)} acoes={acoesFalsas()} />);
    const acts = [...container.querySelectorAll("[data-act]")].map((n) => n.getAttribute("data-act"));
    expect(acts.filter((a) => ACOES_DA_ROTINA.has(a ?? ""))).toEqual([]);
    expect(acts.length).toBeGreaterThan(0);
  });

  it("as ações chegam por prop", () => {
    const acoes = acoesFalsas();
    const { container, getByText } = render(<TelaRotinas loja={criarLoja(() => ({ ...comTudo, ocupado: false }))} acoes={acoes} />);
    const li = (id: string) => container.querySelector(`li.rotina[data-rotina="${id}"]`)!;
    fireEvent.click(getByText("+ Nova rotina"));
    expect(acoes.novaRotina).toHaveBeenCalled();
    fireEvent.click([...li("r2").querySelectorAll("button")].find((b) => b.textContent === "Pausar")!);
    expect(acoes.pausar).toHaveBeenCalledWith("r2");
    fireEvent.click([...li("r3").querySelectorAll("button")].find((b) => b.textContent === "Ativar")!);
    expect(acoes.ativar).toHaveBeenCalledWith("r3");
    const testar = [...li("r2").querySelectorAll("button")].find((b) => b.textContent === "Testar agora")!;
    fireEvent.click(testar);
    expect(acoes.testar).toHaveBeenCalledWith("r2", "a1", testar);
    fireEvent.click([...li("r2").querySelectorAll("button")].find((b) => b.textContent === "atualizar execuções")!);
    expect(acoes.alternarExecucoes).toHaveBeenCalledWith("r2");
    fireEvent.click([...li("r2").querySelectorAll("button")].find((b) => b.textContent === "conversa")!);
    expect(acoes.abrirConversa).toHaveBeenCalledWith("c1", "a1");
    fireEvent.click(li("r4").querySelector("button.pri")!);
    expect(acoes.verPergunta).toHaveBeenCalledWith("c1", "a1", "d9");
  });

  it("com o app ocupado, Testar agora fica desligado (o clique duplo não roda duas)", () => {
    const { container } = render(<TelaRotinas loja={criarLoja(() => comTudo)} acoes={acoesFalsas()} />);
    const testar = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Testar agora");
    expect(testar.length).toBe(4);
    expect(testar.every((b) => b.disabled)).toBe(true);
  });
});

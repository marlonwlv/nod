import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { criarQuadroNaTela } from "../../../web/lib/quadro-na-tela.ts";

/**
 * Q2, Q3 e Q4 (definido em 2026-11-12, fase 0 da migração do front) na tela do quadro de verdade, sobre um documento falso
 * (o unit não tem DOM; sem #quadro nada é desenhado, então o que se prova é o que vai ao servidor). Importa código de DOM:
 * quem checa os tipos é o tsconfig.web.json.
 */
const ANF = "11111111-1111-4111-8111-111111111111";

const tarefa = (id: string, status: string): TarefaDto => ({
  id, quadroId: "q1", titulo: id, descricao: "", status, voltarPara: null, agenteId: null, ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: id === "t1" ? "turno-t1" : null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: null, numero: null, prioridade: "sem", codigo: `#${id}`, branch: "",
  naFilaDesde: null, motivoFila: null,
});
const quadro = (status: Record<string, string>): QuadroDto => ({
  id: "q1", agenteId: ANF, nome: null, projetoId: null, prefixo: null, modoConversa: "individual", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas: Object.entries(status).map(([id, s]) => tarefa(id, s)), ultimoLote: null, feitas: 0, total: 2,
});

type Ouvinte = (ev: unknown) => void;
function montar() {
  const ouvintes = new Map<string, Ouvinte[]>();
  // O documento e os elementos falsos: aceitam o que o desenho e a troca pedem (qualquer método vira um que não faz nada) e
  // nunca acham nada (querySelector null, querySelectorAll vazio): sem .qd-conteudo, o desenho para cedo.
  const elemento = (base: Record<string, unknown> = {}): unknown => new Proxy(Object.assign(function () { /* chamável */ }, { dataset: {}, style: {}, firstElementChild: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, ...base }), {
    get: (alvo, k) => (k in alvo && k !== "length" && k !== "name" ? (alvo as unknown as Record<string | symbol, unknown>)[k] : k === "querySelector" || k === "closest" || k === "getAttribute" ? () => null : k === "querySelectorAll" ? () => [] : k === "contains" || k === "matches" ? () => false
      : k === "then" || k === "animate" || k === Symbol.toPrimitive || k === Symbol.iterator || (typeof k === "string" && /^[A-Z]/.test(k)) ? undefined : elemento()),
    set: (alvo, k, v) => { (alvo as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
    apply: () => elemento(),
  });
  const vista = elemento();
  const doc = elemento({
    activeElement: null, visibilityState: "visible",
    getElementById: (id: string) => (id === "quadro" ? vista : null),
    createElement: () => elemento(),
    defaultView: elemento({ setInterval: () => 0, innerHeight: 900, matchMedia: () => ({ matches: false, addEventListener: () => {} }) }),
    addEventListener: (tipo: string, f: Ouvinte) => { ouvintes.set(tipo, [...(ouvintes.get(tipo) ?? []), f]); },
  }) as Document;
  let servidor: Record<string, string> = { t1: "revisao", t2: "revisao" };
  const ordem: string[] = [];
  const respostas: Array<() => void> = [];
  const api = {
    quadro: vi.fn(async () => { ordem.push("quadro"); return { quadro: quadro(servidor) }; }),
    quadrosDoBot: vi.fn(async () => { ordem.push("lista"); await Promise.resolve(); ordem.push("lista-voltou"); return { quadros: [], aberto: "q1" }; }),
    mudarTarefa: vi.fn((_de: string, id: string, p: { status: string }) => new Promise((ok) => {
      respostas.push(() => { servidor = { ...servidor, [id]: p.status }; ok({ quadro: quadro(servidor), lote: null }); });
    })),
  };
  const tela = criarQuadroNaTela(doc, { reduzido: () => true, dados: { api: () => api as never, agente: (() => null) as never, hora: () => "10:00" } });
  const disparar = (tipo: string, alvo: unknown) => { for (const f of ouvintes.get(tipo) ?? []) f({ target: alvo, preventDefault: () => {}, dataTransfer: null }); };
  const card = (id: string) => ({ dataset: { tarefa: id }, closest: (s: string) => (s.includes("li.qd-card") ? card(id) : null), addEventListener: () => {}, classList: { add: () => {} } });
  const coluna = (id: string) => ({ dataset: { coluna: id }, closest: (s: string) => (s.includes("section.qd-col") ? coluna(id) : null), classList: { contains: () => true } });
  const arrastar = (id: string, para: string) => { disparar("dragstart", card(id)); disparar("drop", coluna(para)); };
  return { tela, api, ordem, respostas, arrastar, frame: (tipo: string, dados: Record<string, unknown>) => tela.aoFrame({ tipo, dados }) };
}
const esvaziar = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("a tela do quadro: fila de arrastos (Q2), leituras juntas (Q3) e frames só do quadro (Q4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function noQuadro() {
    const m = montar();
    m.tela.sincronizar({ chave: "c-anf", nome: "Ada", agenteId: ANF });
    m.tela.trocar("quadro");
    await vi.advanceTimersByTimeAsync(10);
    await esvaziar();
    return m;
  }

  it("Q3: a lista dos quadros e o quadro saem juntos (o quadro não espera a lista voltar)", async () => {
    const m = await noQuadro();
    expect(m.api.quadro).toHaveBeenCalledTimes(1);
    expect(m.ordem.indexOf("quadro")).toBeLessThan(m.ordem.indexOf("lista-voltou"));
  });

  it("Q3: voltar a um bot já lido não começa de novo do zero (o quadro guardado aparece e é relido por baixo)", async () => {
    const m = await noQuadro();
    m.tela.sincronizar({ chave: "c-outro", nome: "Beto", agenteId: "22222222-2222-4222-8222-222222222222" });
    m.tela.sincronizar({ chave: "c-anf", nome: "Ada", agenteId: ANF });
    m.tela.trocar("quadro");
    await vi.advanceTimersByTimeAsync(10);
    await esvaziar();
    // A lista do bot veio do guardado: só o quadro é relido.
    expect(m.api.quadrosDoBot).toHaveBeenCalledTimes(1);
    expect(m.api.quadro.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Q2: o segundo arrasto com o primeiro no ar entra na fila e sai quando ele volta — os dois chegam ao servidor", async () => {
    const m = await noQuadro();
    m.arrastar("t1", "bloqueado");
    m.arrastar("t2", "bloqueado");
    await esvaziar();
    expect(m.api.mudarTarefa).toHaveBeenCalledTimes(1);
    m.respostas.shift()!();
    await esvaziar();
    expect(m.api.mudarTarefa).toHaveBeenCalledTimes(2);
    expect(m.api.mudarTarefa.mock.calls.map((c) => [c[1], c[2].status])).toEqual([["t1", "bloqueado"], ["t2", "bloqueado"]]);
    m.respostas.shift()!();
    await esvaziar();
  });

  it("Q4: o turno de um bot de fora do quadro não relê; o de uma tarefa do quadro relê", async () => {
    const m = await noQuadro();
    const antes = m.api.quadro.mock.calls.length;
    m.frame("turno.iniciado", { conversaId: "c-fora", turnoId: "x1", agente_id: "33333333-3333-4333-8333-333333333333" });
    m.frame("turno.encerrado", { conversaId: "c-fora", turnoId: "x1" });
    await vi.advanceTimersByTimeAsync(1000);
    await esvaziar();
    expect(m.api.quadro.mock.calls.length).toBe(antes);
    m.frame("turno.encerrado", { conversaId: "c-dev", turnoId: "turno-t1" });
    await vi.advanceTimersByTimeAsync(1000);
    await esvaziar();
    expect(m.api.quadro.mock.calls.length).toBe(antes + 1);
  });
});

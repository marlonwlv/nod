import { describe, expect, it } from "vitest";
import type { ColunaDto, QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { direitaDaTarefa, gruposDasTarefas, haQuanto, quantasPerguntaram, resumoDosQuadros, type QuadroComProjeto } from "../../../web/lib/tarefas-de-todos.ts";
import { renderTarefasDeTodos } from "../../../web/telas/tarefas-de-todos.ts";

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
    tarefa("NOD-8", 8, "backlog"),
  ], 7, 17) },
  { projeto: null, quadro: quadro("q2", "gil", "Site do nod", null, [tarefa("SIT-1", 1, "afazer", { agenteId: null, agenteNome: null, mudadoEm: AGORA - 26 * 36e5 })], 1, 5) },
];

describe("Tarefas de todos os bots (tela 18d do Paper)", () => {
  it("diz o tempo como o Paper: min, h, dia e dias", () => {
    expect(haQuanto(AGORA - 5 * MIN, AGORA)).toBe("há 5 min");
    expect(haQuanto(AGORA - 3 * 36e5, AGORA)).toBe("há 3 h");
    expect(haQuanto(AGORA - 26 * 36e5, AGORA)).toBe("há 1 dia");
    expect(haQuanto(AGORA - 50 * 36e5, AGORA)).toBe("há 2 dias");
  });

  it("a direita da linha: pergunta, trabalho vivo, fila, espera da CI e o tempo", () => {
    const [q] = QS;
    const ts = q!.quadro.tarefas;
    expect(direitaDaTarefa(ts[0]!, AGORA)).toEqual({ texto: "te perguntou", tom: "aguardando" });
    expect(direitaDaTarefa(ts[1]!, AGORA).texto).toBe("Trabalhando · 2 min");
    expect(direitaDaTarefa(ts[2]!, AGORA).texto).toBe("na fila · 3 min");
    expect(direitaDaTarefa(tarefa("X-1", 1, "bloqueado", { estadoLinha: { tipo: "esperando", motivo: null, volta: { quando: "ci", em: null } } } as Partial<TarefaDto>), AGORA).texto).toBe("Esperando a CI");
  });

  it("por quadro: um grupo por quadro, na ordem do quadro, sem Backlog, Feito e Cancelado", () => {
    const gs = gruposDasTarefas(QS, "quadro", { busca: "", emAberto: true, porPrioridade: false }, AGORA);
    expect(gs.map((g) => [g.projeto, g.nome, g.progresso])).toEqual([["Produto", "Quadro NOD", 41], ["Sem projeto", "Site do nod", 20]]);
    expect(gs[0]!.linhas.map((l) => l.codigo)).toEqual(["NOD-1", "NOD-2", "NOD-3"]);
    expect(gs[0]!.linhas.map((l) => l.tom)).toEqual(["andando", "revisao", "andando"]);
  });

  it("status todas traz Backlog e Feito; a prioridade ordena urgente primeiro; a busca acha pelo código", () => {
    const todas = gruposDasTarefas(QS, "quadro", { busca: "", emAberto: false, porPrioridade: true }, AGORA);
    expect(todas[0]!.linhas.map((l) => l.codigo)).toEqual(["NOD-3", "NOD-1", "NOD-2", "NOD-8", "NOD-9"]);
    const busca = gruposDasTarefas(QS, "quadro", { busca: "sit-1", emAberto: true, porPrioridade: false }, AGORA);
    expect(busca.flatMap((g) => g.linhas.map((l) => l.codigo))).toEqual(["SIT-1"]);
  });

  it("por bot agrupa pelo responsável; Minhas traz o que perguntou e o que é da pessoa", () => {
    const porBot = gruposDasTarefas(QS, "bot", { busca: "", emAberto: true, porPrioridade: false }, AGORA);
    expect(porBot.map((g) => [g.nome, g.linhas.length])).toEqual([["Dante", 2], ["Chico", 1], ["Você", 1]]);
    const minhas = gruposDasTarefas(QS, "minhas", { busca: "", emAberto: true, porPrioridade: false }, AGORA);
    expect(minhas[0]!.linhas.map((l) => l.codigo).sort()).toEqual(["NOD-2", "SIT-1"]);
  });

  it("resume os quadros e conta quem perguntou", () => {
    expect(resumoDosQuadros(QS)).toBe("2 quadros, 1 projeto");
    expect(quantasPerguntaram(QS, AGORA)).toBe(1);
  });

  it("desenha o topo, os filtros, o chip e as linhas abrindo a tarefa no quadro do dono", () => {
    const grupos = gruposDasTarefas(QS, "quadro", { busca: "", emAberto: true, porPrioridade: false }, AGORA);
    const html = renderTarefasDeTodos({ carga: { tipo: "pronto", grupos, resumo: resumoDosQuadros(QS), perguntaram: 1, total: 2 }, vista: "quadro", filtros: { busca: "", emAberto: true, porPrioridade: false }, avatar: () => "<i></i>" });
    expect(html).toContain("Os quadros de todos os seus bots num lugar só · 2 quadros, 1 projeto");
    expect(html).toContain('data-vista="quadro" aria-pressed="true"');
    expect(html).toContain("Status: em aberto");
    expect(html).toContain("1 te perguntou");
    expect(html).toContain('data-act="tdt-abrir" data-tarefa="t-NOD-1" data-quadro="q1" data-dono="ada"');
    expect(html).toContain("página Tarefas de ada");
  });

  it("sem quadro nenhum, diz como começar", () => {
    const html = renderTarefasDeTodos({ carga: { tipo: "pronto", grupos: [], resumo: "0 quadros", perguntaram: 0, total: 0 }, vista: "quadro", filtros: { busca: "", emAberto: true, porPrioridade: false }, avatar: () => "" });
    expect(html).toContain("Nenhum bot tem quadro ainda");
  });
});

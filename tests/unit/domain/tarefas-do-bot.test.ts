import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { reduzirTarefas, SEM_TAREFAS, TETO_TAREFAS, type AcompanhamentoDeTarefas } from "../../../src/domain/tarefas-do-bot.ts";

const uso = (id: string, nome: string, input: unknown): EventoStream => ({ tipo: "tool_use", id, nome, input });
const resultado = (toolUseId: string, texto: string, isError = false): EventoStream => ({ tipo: "tool_result", toolUseId, isError, texto });

function aplicar(eventos: EventoStream[]): { final: AcompanhamentoDeTarefas; mudancas: number } {
  let a = SEM_TAREFAS;
  let mudancas = 0;
  for (const ev of eventos) {
    const r = reduzirTarefas(a, ev);
    a = r.acompanhamento;
    if (r.mudou) mudancas += 1;
  }
  return { final: a, mudancas };
}

describe("lista de tarefas do bot (formato medido no CLI 2.1.284)", () => {
  it("a sequência medida: criar três, andar com duas, listar", () => {
    const { final, mudancas } = aplicar([
      uso("u1", "TaskCreate", { subject: "Ler o diff", description: "Ler o diff do código" }), resultado("u1", "Task #1 created successfully: Ler o diff"),
      uso("u2", "TaskCreate", { subject: "Checar SQL", description: "Checar SQL" }), resultado("u2", "Task #2 created successfully: Checar SQL"),
      uso("u3", "TaskCreate", { subject: "Escrever o relatório", description: "x" }), resultado("u3", "Task #3 created successfully: Escrever o relatório"),
      uso("u4", "TaskUpdate", { taskId: "1", status: "in_progress" }), resultado("u4", "Updated task #1 status"),
      uso("u5", "TaskUpdate", { taskId: "1", status: "completed" }), resultado("u5", "Updated task #1 status"),
      uso("u6", "TaskUpdate", { taskId: "2", status: "in_progress" }), resultado("u6", "Updated task #2 status"),
      uso("u7", "TaskList", {}), resultado("u7", "#1 [completed] Ler o diff\n#2 [in_progress] Checar SQL\n#3 [pending] Escrever o relatório"),
    ]);
    expect(final.tarefas).toEqual([
      { id: "1", titulo: "Ler o diff", estado: "feita" },
      { id: "2", titulo: "Checar SQL", estado: "andamento" },
      { id: "3", titulo: "Escrever o relatório", estado: "pendente" },
    ]);
    // A listagem igual ao que já se sabia não conta como mudança: o adaptador não republica à toa.
    expect(mudancas).toBe(6);
    expect(final.pendentes).toEqual({});
  });

  it("resultado com erro não mexe na lista; ferramenta que não é de tarefa passa direto", () => {
    const { final, mudancas } = aplicar([
      uso("u1", "TaskCreate", { subject: "A" }), resultado("u1", "falhou", true),
      uso("b1", "Bash", { command: "ls" }), resultado("b1", "a.txt"),
      uso("u2", "TaskUpdate", { taskId: "9", status: "completed", subject: "Feita sem criar" }), resultado("u2", "Updated task #9 status"),
    ]);
    expect(final.tarefas).toEqual([{ id: "9", titulo: "Feita sem criar", estado: "feita" }]);
    expect(mudancas).toBe(1);
  });

  it("tetos: no máximo TETO_TAREFAS tarefas, título cortado em 200", () => {
    const eventos: EventoStream[] = [];
    for (let i = 1; i <= TETO_TAREFAS + 5; i++) eventos.push(uso(`u${i}`, "TaskCreate", { subject: "x".repeat(300) }), resultado(`u${i}`, `Task #${i} created successfully: x`));
    const { final } = aplicar(eventos);
    expect(final.tarefas).toHaveLength(TETO_TAREFAS);
    expect(final.tarefas[0]!.titulo).toHaveLength(200);
  });

  it("id inexistente (\"Task not found\" sem is_error, CLI 2.1.312) não cria tarefa fantasma", () => {
    const { final, mudancas } = aplicar([
      uso("u1", "TaskCreate", { subject: "A", description: "a" }), resultado("u1", "Task #1 created successfully: A"),
      uso("u2", "TaskUpdate", { taskId: "999", status: "completed" }), resultado("u2", "Task not found"),
      uso("u3", "TaskUpdate", { taskId: "998", status: "deleted" }), resultado("u3", "Task not found"),
    ]);
    expect(final.tarefas).toEqual([{ id: "1", titulo: "A", estado: "pendente" }]);
    expect(mudancas).toBe(1);
    expect(final.pendentes).toEqual({});
  });

  it("listagem com bloqueio não cola \"[blocked by #1]\" no título", () => {
    const { final, mudancas } = aplicar([
      uso("u1", "TaskCreate", { subject: "A", description: "a" }), resultado("u1", "Task #1 created successfully: A"),
      uso("u2", "TaskCreate", { subject: "B", description: "b" }), resultado("u2", "Task #2 created successfully: B"),
      uso("u3", "TaskUpdate", { taskId: "2", addBlockedBy: ["1"] }), resultado("u3", "Updated task #2 blockedBy"),
      uso("u4", "TaskList", {}), resultado("u4", "#1 [pending] A\n#2 [pending] B [blocked by #1, #3]"),
    ]);
    expect(final.tarefas).toEqual([
      { id: "1", titulo: "A", estado: "pendente" },
      { id: "2", titulo: "B", estado: "pendente" },
    ]);
    expect(mudancas).toBe(2);
  });

  it("o teto do título não parte emoji ao meio", () => {
    const titulo = "x".repeat(199) + "👨‍👩‍👧";
    const { final } = aplicar([uso("u1", "TaskCreate", { subject: titulo }), resultado("u1", "Task #1 created successfully: x")]);
    const t = final.tarefas[0]!.titulo;
    expect(Array.from(t)).toHaveLength(200);
    expect(t.endsWith("👨")).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(t)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { htmlDoMenuDeBots, renderTelaTarefas } from "../../../web/telas/tela-tarefas.ts";

/**
 * QA-171: na tela Tarefas com "só o Davi" escolhido, o Davi é excluído (outra aba, pelo chat, link antigo). Na main o
 * chip voltava a "Todos os bots" (aria-pressed=false), a lista seguia filtrada pelo bot que saiu e o menu não marcava
 * nenhum item. Agora o filtro de um bot que saiu vale como "Todos os bots" nos três lugares.
 */
const AGORA = new Date(2026, 10, 18, 15, 0).getTime();
const bot = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({ id, nome, conversaId: `c-${id}`, cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "", descricao: "", confirmado: true, ...extra });
const tarefa = (id: string, agenteId: string) => ({
  id, agenteId, conversaId: `c-${agenteId}`, titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60_000, iniciadoEm: AGORA - 60_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: "t", esperandoComputadorDe: null,
});

function estado(davi: Record<string, unknown>, frota = true): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: frota ? ({ agentes: [bot("lia", "Lia"), bot("davi", "Davi", davi)] } as never) : null,
    trabalhos: { trabalhos: [tarefa("Migração da Lia", "lia"), tarefa("Deploy do Davi", "davi")], pressao: null, memoriaTotalMb: null } as never,
    tela: { tipo: "trabalhos", bot: "davi" },
  } as Estado;
}

describe("QA-171: filtro de bot que foi excluído", () => {
  it("com o Davi vivo, o filtro vale (controle)", () => {
    const html = renderTelaTarefas(estado({}), { tipo: "trabalhos", bot: "davi" });
    expect(html).toContain('aria-pressed="true">Davi');
    expect(html).toContain("Deploy do Davi");
    expect(html).not.toContain("Migração da Lia");
  });

  it("Davi excluído: o chip, a lista e o menu dizem a mesma coisa (Todos os bots)", () => {
    const e = estado({ excluidoEm: new Date(AGORA).toISOString() });
    const html = renderTelaTarefas(e, { tipo: "trabalhos", bot: "davi" });
    expect(html).toContain('aria-pressed="false">Todos os bots');
    expect(html).toContain("Migração da Lia");
    expect(html).not.toContain("Nada com este filtro agora.");
    expect(htmlDoMenuDeBots(e, "davi")).toContain('data-bot="" aria-checked="true"');
  });

  it("com a frota ainda carregando, o filtro fica (a lista não pisca inteira)", () => {
    const html = renderTelaTarefas(estado({}, false), { tipo: "trabalhos", bot: "davi" });
    expect(html).not.toContain("Migração da Lia");
  });
});

import { describe, expect, it } from "vitest";
import type { RotinaDto } from "../../../src/contracts/api.ts";
import { AGENDA_INICIAL, reduzirAgenda } from "../../../web/estado/agenda.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { janelaDaLista, inicioDoDia } from "../../../web/lib/agenda.ts";
import { renderAgendaRotinas } from "../../../web/telas/agenda-rotinas.ts";

/**
 * QA-172 (família do QA-171): em Configurações › Rotinas com "Ada" escolhida no "Filtrar por bot", a Ada é excluída
 * (outra aba, pelo chat) ou a última rotina dela sai. As rotinas dela somem da lista do servidor; na main o select ficava
 * sem opção marcada (o navegador mostra "Todos os bots") e a lista dizia "Nenhuma rotina aqui de Ada.", com as rotinas
 * dos outros escondidas. Agora o filtro de um bot que não tem mais rotina vale como "Todos os bots".
 */
const HOJE = "2026-10-29";
const AGORA = new Date(2026, 9, 29, 10, 30).getTime();
const bot = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({ id, nome, cor: "#3355ff", forma: "shape-circle", conversaId: `c-${id}`, ...extra });
const rotina = (id: string, agenteId: string) =>
  ({
    rotina: { id, agenteId, conversaId: `c-${agenteId}`, ownerId: "p", estado: "ativa", instrucao: `Instrução da ${id}`, fusoIana: "America/Sao_Paulo", exigeAprovacao: false, gatilho: "horario" },
    proximaExecucao: AGORA + 3_600_000, resumo: "Todo dia às 09:00", bloqueio: null, espera: null,
  }) as unknown as RotinaDto;
const janela = janelaDaLista(HOJE);

function estado(rotinas: RotinaDto[], ada: Record<string, unknown> = {}): Estado {
  const base = reduzirAgenda(AGENDA_INICIAL, { tipo: "agenda-abrir", hoje: HOJE });
  const dto = { de: inicioDoDia(janela.de), ate: inicioDoDia(janela.ate), agora: AGORA, fuso: "America/Sao_Paulo", rotinas: [], itens: [] };
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [bot("b-otto", "Otto"), bot("b-lia", "Lia"), bot("b-ada", "Ada", ada)] } as never,
    rotinas, agenda: { ...base, dto: dto as never, ui: { ...base.ui, bots: ["b-ada"] } },
  } as Estado;
}

describe("QA-172: filtro da Agenda com bot que não tem mais rotina", () => {
  it("com a Ada viva e com rotina, o filtro vale (controle)", () => {
    const h = renderAgendaRotinas(estado([rotina("r1", "b-otto"), rotina("r2", "b-lia"), rotina("r3", "b-ada")]));
    expect(h).toContain('<option value="b-ada" selected>Ada</option>');
    expect(h).toContain("Instrução da r3");
    expect(h).not.toContain("Instrução da r1");
  });

  it("Ada excluída: o select, a lista e o vazio dizem a mesma coisa (Todos os bots)", () => {
    const h = renderAgendaRotinas(estado([rotina("r1", "b-otto"), rotina("r2", "b-lia")], { excluidoEm: AGORA }));
    expect(h).not.toContain("Nenhuma rotina aqui de Ada.");
    expect(h).toContain("Instrução da r1");
    expect(h).toContain("Instrução da r2");
    expect(h).not.toContain(" selected>");
  });

  it("a última rotina da Ada saiu (bot vivo): mesmo resultado", () => {
    const h = renderAgendaRotinas(estado([rotina("r1", "b-otto"), rotina("r2", "b-lia")]));
    expect(h).not.toContain("Nenhuma rotina aqui de Ada.");
    expect(h).toContain("Instrução da r1");
  });
});

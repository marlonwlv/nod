import { describe, expect, it } from "vitest";
import { atividadeDaTarefa, atividadeNoObjetivo, atividadesEsperadasDoLegado, divergenciaDaAtividade, type AtividadeDaTarefa, type FatosDaAtividade } from "../../../src/domain/atividade-da-tarefa.ts";
import { estadoDoTrabalho, type FatosTrabalho } from "../../../src/domain/trabalho.ts";

const base: FatosDaAtividade = { despachando: 0, pendentes: 0, parando: 0, esperandoOutro: false, decisaoPendente: false, aguardandoColega: false, ultimo: null };

describe("atividadeDaTarefa (ADR-192: decisão > turno vivo > espera > interrupção > ausente)", () => {
  it.each<[string, Partial<FatosDaAtividade>, AtividadeDaTarefa | null]>([
    ["sem turno nem sinal", {}, null],
    ["turno despachando", { despachando: 1 }, "trabalhando"],
    ["turno pendente elegível", { pendentes: 1 }, "trabalhando"],
    ["pendente esperando outro trabalho (Fazer depois)", { pendentes: 1, esperandoOutro: true }, "em_espera"],
    ["decisão pendente sem turno vivo", { decisaoPendente: true }, "precisa_de_voce"],
    ["decisão pendente com o turno vivo parado nela", { despachando: 1, decisaoPendente: true }, "precisa_de_voce"],
    ["decisão pendente ganha da espera", { decisaoPendente: true, aguardandoColega: true }, "precisa_de_voce"],
    ["pedido a colega aberto", { aguardandoColega: true }, "em_espera"],
    ["volta marcada", { aguardandoDespertar: true }, "em_espera"],
    ["comando esperando", { aguardandoComando: true }, "em_espera"],
    ["turno vivo ganha da espera", { despachando: 1, aguardandoColega: true }, "trabalhando"],
    ["último turno interrompido sem retomada", { ultimo: { estado: "interrompido", motivo: "maquina_sem_contato" } }, "interrompida"],
    ["parado pela pessoa", { ultimo: { estado: "interrompido", motivo: "parado_pela_pessoa" } }, "interrompida"],
    ["Parar pedido, processo acabando", { parando: 1 }, "interrompida"],
    // Emenda 5: o Parar que só cancelou a espera de um comando (o último turno já tinha concluído) também é interrupção.
    ["trabalho parado pela pessoa, último turno concluído", { paradoPelaPessoa: true, ultimo: { estado: "concluido", motivo: null } }, "interrompida"],
    ["parado, mas a pessoa já mandou continuar (turno na fila)", { paradoPelaPessoa: true, pendentes: 1 }, "trabalhando"],
    ["pergunta vencida", { perguntaVencida: true, ultimo: { estado: "concluido", motivo: null } }, "interrompida"],
    ["interrompido, mas a retomada já está na fila", { pendentes: 1, ultimo: { estado: "interrompido", motivo: "maquina_sem_contato" } }, "trabalhando"],
    ["interrompido, mas espera um colega", { aguardandoColega: true, ultimo: { estado: "interrompido", motivo: "maquina_sem_contato" } }, "em_espera"],
    // Conclusão é do turno; resolução é da Tarefa: o turno concluído não produz atividade.
    ["último turno concluído", { ultimo: { estado: "concluido", motivo: null } }, null],
  ])("%s", (_nome, fatos, esperado) => {
    expect(atividadeDaTarefa({ ...base, ...fatos })).toBe(esperado);
  });
});

describe("shadow read: atividade nova × estado legado (etapa 0)", () => {
  const legado: FatosTrabalho = { estadoAtual: "na_fila", iniciado: false, parando: 0, despachando: 0, pendentes: 0, esperandoOutro: false, decisaoPendente: false, aguardandoColega: false, ultimo: null };

  // Os mesmos fatos alimentam as duas projeções; nos casos comuns elas concordam e nada vai ao log.
  it.each<[string, Partial<FatosTrabalho>]>([
    ["criado", {}],
    ["na fila", { pendentes: 1 }],
    ["rodando", { despachando: 1, iniciado: true }],
    ["precisa de você no meio do turno", { despachando: 1, decisaoPendente: true }],
    ["precisa de você sem turno", { iniciado: true, decisaoPendente: true }],
    ["fechado ocioso", { iniciado: true, decisaoPendente: true, estadoAtual: "fechado_ocioso" }],
    ["esperando colega", { iniciado: true, aguardandoColega: true }],
    ["terminado", { iniciado: true, ultimo: { estado: "concluido", motivo: null } }],
    ["parado pela pessoa", { iniciado: true, ultimo: { estado: "interrompido", motivo: "parado_pela_pessoa" } }],
    ["parado e o turno acabou concluído depois do Parar", { iniciado: true, estadoAtual: "parado", ultimo: { estado: "concluido", motivo: null } }],
    ["falhou", { iniciado: true, ultimo: { estado: "interrompido", motivo: "executor_indisponivel" } }],
    ["pergunta vencida", { iniciado: true, perguntaVencida: true, ultimo: { estado: "concluido", motivo: null } }],
  ])("%s: sem divergência", (_nome, fatos) => {
    const f = { ...legado, ...fatos };
    expect(divergenciaDaAtividade(estadoDoTrabalho(f), atividadeDaTarefa(f))).toBeNull();
  });

  it("a decisão que sobrou numa tarefa parada é divergência (o legado segue parado; a atividade diz precisa de você)", () => {
    const f: FatosTrabalho = { ...legado, iniciado: true, estadoAtual: "parado", decisaoPendente: true, ultimo: { estado: "interrompido", motivo: "parado_pela_pessoa" } };
    expect(estadoDoTrabalho(f)).toBe("parado");
    expect(divergenciaDaAtividade("parado", atividadeDaTarefa(f))).toEqual({ estado: "parado", atividade: "precisa_de_voce" });
  });

  it("terminado com turno vivo é divergência", () => {
    expect(divergenciaDaAtividade("terminado", "trabalhando")).toEqual({ estado: "terminado", atividade: "trabalhando" });
  });

  it("todo estado legado tem ao menos uma atividade esperada", () => {
    for (const e of ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso", "terminado", "parado", "falhou"] as const) expect(atividadesEsperadasDoLegado(e).length).toBeGreaterThan(0);
  });
});

describe("atividadeNoObjetivo (emenda 5): resolvida ou arquivada só mostram o 'trabalhando'", () => {
  it.each<[Parameters<typeof atividadeNoObjetivo>[0], AtividadeDaTarefa | null, AtividadeDaTarefa | null]>([
    ["resolvida", "interrompida", null],
    ["resolvida", "precisa_de_voce", null],
    ["resolvida", "trabalhando", "trabalhando"],
    ["arquivada", "em_espera", null],
    ["entregue", "precisa_de_voce", "precisa_de_voce"],
    ["em_andamento", "interrompida", "interrompida"],
  ])("%s + %s → %s", (estado, atividade, esperado) => {
    expect(atividadeNoObjetivo(estado, atividade)).toBe(esperado);
  });
});

import { describe, expect, it } from "vitest";
import type { TarefaNoTrabalho } from "../../../src/contracts/tarefa.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { passoDaTarefa, prontas, trabalhosDaTela } from "../../../web/telas/tela-tarefas.ts";
import { campoDaTarefa, htmlObjetivoDaTarefa, linhaDoFim, rotuloDoObjetivo } from "../../../web/telas/tarefa-detalhada.ts";

/**
 * ADR-192 (etapa 3, definido em 2026-11-22): a web mostra o estado do objetivo separado da atividade e oferece as ações da
 * pessoa. "Entregue" nunca aparece como "Resolvida"; com execução viva, Resolver e Arquivar pedem a escolha explícita.
 */
const AGORA = new Date(2026, 10, 22, 15, 10).getTime();
const objetivo = (extra: Partial<TarefaNoTrabalho> = {}): TarefaNoTrabalho => ({ id: "o1", estado: "entregue", atividade: null, versao: 3, entregueEm: AGORA - 1000, resolvidaEm: null, ...extra });
const trabalho = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "t1", agenteId: "b1", conversaId: "c1", titulo: "Landing", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "terminado",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60_000, iniciadoEm: AGORA - 60_000, terminadoEm: AGORA - 1000, pedidoPorNome: null, rotinaNome: null, ultimoPasso: "pronto",
  turnoVivoId: null, esperandoComputadorDe: null, forma: "frente", loteId: "l1", lote: null, ...extra,
});

describe("rótulo do objetivo", () => {
  it.each<[Partial<TarefaNoTrabalho>, string]>([
    [{ estado: "entregue", atividade: "precisa_de_voce" }, "Entregue · precisa de você"],
    [{ estado: "em_andamento", atividade: "trabalhando" }, "Em andamento · trabalhando"],
    [{ estado: "entregue", atividade: null }, "Entregue"],
    [{ estado: "resolvida", atividade: null }, "Resolvida"],
    [{ estado: "arquivada", atividade: "trabalhando" }, "Arquivada"],
    [{ estado: "em_andamento", atividade: "interrompida" }, "Em andamento · interrompida"],
  ])("%o → %s", (o, esperado) => {
    expect(rotuloDoObjetivo(objetivo(o))).toBe(esperado);
  });
});

describe("as ações da pessoa no fim da tarefa", () => {
  const botoes = (html: string) => [...html.matchAll(/data-act="([^"]+)"[^>]*?(?:data-turno-vivo="([^"]+)")?>([^<]+)</g)].map((m) => `${m[1]}${m[2] ? `:${m[2]}` : ""} ${m[3]}`);

  it("entregue sem execução viva: Marcar como resolvida e Arquivar, com a versão lida", () => {
    const html = htmlObjetivoDaTarefa(trabalho({ tarefa: objetivo() }));
    expect(botoes(html)).toEqual(["tarefa-resolver Marcar como resolvida", "tarefa-arquivar Arquivar"]);
    expect(html).toContain('data-versao="3"');
    // A linha do fim já diz "Entregue · hora": o bloco não repete; com atividade (o bot voltou a trabalhar), diz.
    expect(html).not.toContain(">Entregue<");
    expect(htmlObjetivoDaTarefa(trabalho({ estado: "precisa_de_voce", terminadoEm: null, tarefa: objetivo({ atividade: "precisa_de_voce" }) }))).toContain("Entregue · precisa de você");
  });

  it("com execução viva: a escolha é explícita (parar ou deixar terminar), nunca inferida", () => {
    const html = htmlObjetivoDaTarefa(trabalho({ estado: "rodando", turnoVivoId: "x", terminadoEm: null, tarefa: objetivo({ estado: "em_andamento", atividade: "trabalhando" }) }));
    expect(botoes(html)).toEqual(["tarefa-resolver:parar Resolver e parar", "tarefa-resolver:manter Resolver e deixar terminar", "tarefa-arquivar:parar Arquivar e parar"]);
  });

  it("resolvida: Reabrir e Arquivar; arquivada: só Desarquivar; sem Tarefa ligada: nada", () => {
    expect(botoes(htmlObjetivoDaTarefa(trabalho({ tarefa: objetivo({ estado: "resolvida", resolvidaEm: AGORA }) })))).toEqual(["tarefa-reabrir Reabrir", "tarefa-arquivar Arquivar"]);
    expect(botoes(htmlObjetivoDaTarefa(trabalho({ tarefa: objetivo({ estado: "arquivada" }) })))).toEqual(["tarefa-desarquivar Desarquivar"]);
    expect(htmlObjetivoDaTarefa(trabalho())).toBe("");
  });
});

describe("o fim e o campo da tarefa com a Tarefa ligada", () => {
  it("o trabalho que terminou é ENTREGUE, não 'feita'; a resolvida diz Resolvida", () => {
    expect(linhaDoFim(trabalho({ tarefa: objetivo() }), "Ada")).toContain("Entregue ·");
    expect(linhaDoFim(trabalho({ tarefa: objetivo({ estado: "resolvida", resolvidaEm: AGORA }) }), "Ada")).toContain("Resolvida ·");
    // Sem Tarefa (rotina, colega, os de antes): o texto de antes.
    expect(linhaDoFim(trabalho(), "Ada")).toContain("Tarefa feita");
  });

  it("o campo é o Continuar", () => {
    expect(campoDaTarefa(trabalho({ tarefa: objetivo() }), "Ada")).toMatchObject({ placeholder: "Continuar tarefa…", nota: expect.stringContaining("Marque como resolvida") });
    expect(campoDaTarefa(trabalho({ tarefa: objetivo({ estado: "resolvida" }) }), "Ada").nota).toContain("Resolvida");
    expect(campoDaTarefa(trabalho(), "Ada").placeholder).toBe("Pedir mais alguma coisa nesta tarefa…");
  });
});

describe("a lista Tarefas separa o estado do objetivo da atividade", () => {
  const estado: Estado = { ...estadoInicial, agora: AGORA };
  it("fechada: o estado do objetivo no lugar do último passo", () => {
    expect(passoDaTarefa(trabalho({ tarefa: objetivo() }), [], estado).passo).toBe("Entregue");
    expect(passoDaTarefa(trabalho({ tarefa: objetivo({ estado: "resolvida" }) }), [], estado).passo).toBe("Resolvida");
    expect(passoDaTarefa(trabalho(), [], estado).passo).toBe("pronto");
  });
  it("a contagem do bot separa entregues de resolvidas (e as sem Tarefa seguem prontas)", () => {
    const lista = [trabalho({ id: "a", tarefa: objetivo() }), trabalho({ id: "b", tarefa: objetivo({ estado: "resolvida" }) }), trabalho({ id: "c" })];
    expect(prontas(lista, AGORA - 3_600_000)).toBe("1 pronta · 1 entregue · 1 resolvida");
  });
  it("aberta depois de entregue: o estado do objetivo vem antes do passo de agora", () => {
    const t = trabalho({ estado: "rodando", turnoVivoId: "x", terminadoEm: null, ultimoPasso: "lendo a planilha", tarefa: objetivo({ atividade: "trabalhando" }) });
    expect(passoDaTarefa(t, [t], estado).passo.startsWith("Entregue · ")).toBe(true);
  });
});

describe("a virada da leitura (etapa 5, NOD_TAREFAS_LEITURA_NOVA)", () => {
  const lista = [trabalho({ id: "a", tarefa: objetivo() }), trabalho({ id: "b", tarefa: objetivo({ estado: "arquivada" }) }), trabalho({ id: "c" })];
  const dto = (leituraNova: boolean): Pick<Estado, "trabalhos"> => ({ trabalhos: { trabalhos: lista, pressao: null, memoriaTotalMb: null, ...(leituraNova ? { leituraNovaDasTarefas: true as const } : {}) } as Estado["trabalhos"] });
  it("desligada: a lista de trabalhos de antes, inteira", () => {
    expect(trabalhosDaTela(dto(false)).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
  it("ligada: a Tarefa decide — a arquivada sai da lista padrão; trabalho sem Tarefa segue", () => {
    expect(trabalhosDaTela(dto(true)).map((t) => t.id)).toEqual(["a", "c"]);
  });
});

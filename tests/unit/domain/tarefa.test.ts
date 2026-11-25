import { describe, expect, it } from "vitest";
import { ESTADOS_TAREFA, type EstadoTarefa } from "../../../src/contracts/tarefa.ts";
import { AUTOR_DO_COMANDO, estadoInicialDaTarefa, ROTULO_ESTADO_TAREFA, tarefaVisivelNaLista, transicaoDaTarefa, type AutorDaTransicao, type ComandoTarefa, type LinhaTarefa } from "../../../src/domain/tarefa.ts";

const PESSOA: AutorDaTransicao = { tipo: "pessoa", id: "00000000-0000-4000-8000-000000000001" };
const AGENTE: AutorDaTransicao = { tipo: "agente", id: "00000000-0000-4000-8000-000000000002" };
const SISTEMA: AutorDaTransicao = { tipo: "sistema", id: "00000000-0000-4000-8000-000000000001" };
const AGORA = 1_700_000_000_000;

function linha(estado: EstadoTarefa, extra: Partial<LinhaTarefa> = {}): LinhaTarefa {
  return {
    estado,
    estadoAntesDeArquivar: null,
    entregueEm: estado === "entregue" ? AGORA - 1000 : null,
    entreguePorTipo: estado === "entregue" ? "agente" : null,
    entreguePorId: estado === "entregue" ? AGENTE.id : null,
    resolvidaEm: estado === "resolvida" ? AGORA - 500 : null,
    resolvidaPor: estado === "resolvida" ? PESSOA.id : null,
    arquivadaEm: null,
    versao: 3,
    ...extra,
  };
}
const arquivadaDe = (antes: Exclude<EstadoTarefa, "arquivada">) => ({ ...linha(antes), estado: "arquivada" as const, estadoAntesDeArquivar: antes, arquivadaEm: AGORA - 100 });
const autorDe = (c: ComandoTarefa) => (c === "entregar" ? AGENTE : c === "iniciar" ? SISTEMA : PESSOA);

describe("transicaoDaTarefa (ADR-192, a tabela da especificação)", () => {
  it.each<[EstadoTarefa | "arquivada←entregue" | "arquivada←resolvida", ComandoTarefa, EstadoTarefa | "sem_mudanca" | "estado_invalido", string[]]>([
    ["nao_iniciada", "iniciar", "em_andamento", ["iniciada"]],
    ["em_andamento", "iniciar", "sem_mudanca", []],
    ["em_andamento", "entregar", "entregue", ["entregue"]],
    ["nao_iniciada", "entregar", "entregue", ["iniciada", "entregue"]],
    ["entregue", "entregar", "entregue", ["entregue"]],
    ["resolvida", "entregar", "sem_mudanca", []],
    ["arquivada←entregue", "entregar", "sem_mudanca", []],
    ["entregue", "continuar", "em_andamento", ["reaberta"]],
    ["resolvida", "continuar", "em_andamento", ["reaberta"]],
    ["nao_iniciada", "continuar", "em_andamento", ["iniciada"]],
    ["em_andamento", "continuar", "sem_mudanca", []],
    ["arquivada←entregue", "continuar", "estado_invalido", []],
    ["entregue", "resolver", "resolvida", ["resolvida"]],
    ["em_andamento", "resolver", "resolvida", ["resolvida"]],
    ["resolvida", "resolver", "sem_mudanca", []],
    ["arquivada←entregue", "resolver", "estado_invalido", []],
    ["resolvida", "reabrir", "em_andamento", ["reaberta"]],
    ["entregue", "reabrir", "em_andamento", ["reaberta"]],
    ["em_andamento", "reabrir", "sem_mudanca", []],
    ["arquivada←resolvida", "reabrir", "resolvida", ["desarquivada"]],
    ["entregue", "arquivar", "arquivada", ["arquivada"]],
    ["resolvida", "arquivar", "arquivada", ["arquivada"]],
    ["arquivada←entregue", "arquivar", "sem_mudanca", []],
    ["arquivada←entregue", "desarquivar", "entregue", ["desarquivada"]],
    ["entregue", "desarquivar", "sem_mudanca", []],
  ])("%s + %s → %s", (de, comando, esperado, eventos) => {
    const atual = de === "arquivada←entregue" ? arquivadaDe("entregue") : de === "arquivada←resolvida" ? arquivadaDe("resolvida") : linha(de);
    const r = transicaoDaTarefa(atual, comando, autorDe(comando), AGORA);
    if (esperado === "sem_mudanca") return expect(r).toEqual({ ok: true, mudou: false });
    if (esperado === "estado_invalido") return expect(r).toEqual({ ok: false, erro: "estado_invalido" });
    if (!r.ok || !r.mudou) throw new Error(`esperava mudança, veio ${JSON.stringify(r)}`);
    expect(r.linha.estado).toBe(esperado);
    expect(r.linha.versao).toBe(atual.versao + 1);
    expect(r.eventos.map((e) => e.tipo)).toEqual(eventos);
  });

  it("só a pessoa resolve, continua, reabre e arquiva; só o bot entrega; só o sistema inicia", () => {
    for (const [comando, autores] of Object.entries(AUTOR_DO_COMANDO) as [ComandoTarefa, readonly string[]][]) {
      for (const autor of [PESSOA, AGENTE, SISTEMA]) {
        const r = transicaoDaTarefa(linha("entregue"), comando, autor, AGORA);
        if (autores.includes(autor.tipo)) expect(r.ok).toBe(true);
        else expect(r).toEqual({ ok: false, erro: "autor_invalido" });
      }
    }
  });

  it("resolver grava a pessoa e a hora; reabrir tira a resolução da linha (a história fica no evento)", () => {
    const r = transicaoDaTarefa(linha("entregue"), "resolver", PESSOA, AGORA);
    if (!r.ok || !r.mudou) throw new Error("resolver");
    expect(r.linha).toMatchObject({ estado: "resolvida", resolvidaEm: AGORA, resolvidaPor: PESSOA.id, entregueEm: AGORA - 1000 });
    const reaberta = transicaoDaTarefa(r.linha, "reabrir", PESSOA, AGORA + 1);
    if (!reaberta.ok || !reaberta.mudou) throw new Error("reabrir");
    expect(reaberta.linha).toMatchObject({ estado: "em_andamento", resolvidaEm: null, resolvidaPor: null, entregueEm: AGORA - 1000 });
  });

  it("entregar grava autoria e hora; a nova entrega substitui a vigente e marca o evento", () => {
    const r = transicaoDaTarefa(linha("entregue"), "entregar", AGENTE, AGORA);
    if (!r.ok || !r.mudou) throw new Error("entregar");
    expect(r.linha).toMatchObject({ entregueEm: AGORA, entreguePorTipo: "agente", entreguePorId: AGENTE.id });
    expect(r.eventos).toEqual([{ tipo: "entregue", dados: { substitui: true } }]);
  });

  it("arquivar guarda o estado de antes; desarquivar volta a ele, e sem ele volta a em_andamento", () => {
    const r = transicaoDaTarefa(linha("resolvida"), "arquivar", PESSOA, AGORA);
    if (!r.ok || !r.mudou) throw new Error("arquivar");
    expect(r.linha).toMatchObject({ estado: "arquivada", estadoAntesDeArquivar: "resolvida", arquivadaEm: AGORA, resolvidaEm: AGORA - 500 });
    const volta = transicaoDaTarefa(r.linha, "desarquivar", PESSOA, AGORA + 1);
    if (!volta.ok || !volta.mudou) throw new Error("desarquivar");
    expect(volta.linha).toMatchObject({ estado: "resolvida", estadoAntesDeArquivar: null, arquivadaEm: null });
    const semAntes = transicaoDaTarefa({ ...linha("em_andamento"), estado: "arquivada", estadoAntesDeArquivar: null, arquivadaEm: AGORA }, "desarquivar", PESSOA, AGORA);
    expect(semAntes.ok && semAntes.mudou && semAntes.linha.estado).toBe("em_andamento");
  });

  it("nenhum comando do sistema ou do bot leva a resolvida (invariante 4)", () => {
    for (const estado of ESTADOS_TAREFA) {
      const atual = estado === "arquivada" ? arquivadaDe("entregue") : linha(estado);
      for (const [comando, autor] of [["iniciar", SISTEMA], ["entregar", AGENTE]] as const) {
        const r = transicaoDaTarefa(atual, comando, autor, AGORA);
        if (r.ok && r.mudou) expect(r.linha.estado).not.toBe("resolvida");
      }
    }
  });
});

describe("apoios", () => {
  it("estado inicial: em_andamento com o primeiro turno junto, senão nao_iniciada", () => {
    expect(estadoInicialDaTarefa(true)).toBe("em_andamento");
    expect(estadoInicialDaTarefa(false)).toBe("nao_iniciada");
  });
  it("a lista padrão esconde as arquivadas", () => {
    expect(tarefaVisivelNaLista("arquivada", false)).toBe(false);
    expect(tarefaVisivelNaLista("arquivada", true)).toBe(true);
    expect(tarefaVisivelNaLista("entregue", false)).toBe(true);
  });
  it("'Entregue' nunca aparece como 'Resolvida'", () => {
    expect(ROTULO_ESTADO_TAREFA.entregue).toBe("Entregue");
    expect(ROTULO_ESTADO_TAREFA.resolvida).toBe("Resolvida");
  });
});

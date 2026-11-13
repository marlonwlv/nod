import { describe, expect, it } from "vitest";
import { CORES_AGENTE, FORMAS_AGENTE } from "../../../src/contracts/agente.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE, avatarNaConversa, estadoMascoteNaConversa, htmlMascote } from "../../../web/lib/mascote.ts";
import { ATIVIDADE_VAZIA } from "../../../web/lib/atividade.ts";

describe("mascote temporário", () => {
  it("mantém as opções da web alinhadas ao contrato aceito pelo servidor", () => {
    expect(FORMAS_MASCOTE).toEqual(FORMAS_AGENTE);
    expect(CORES_MASCOTE).toEqual(CORES_AGENTE);
  });

  it("renderiza forma, cor e estado sem interpolar o nome como HTML", () => {
    const html = htmlMascote({ nome: '<bot "novo">', forma: "shape-cloud", cor: "c-amber" }, "xl", "aguardando_aprovacao");
    expect(html).toContain('class="icon mascote c-amber shape-cloud xl"');
    expect(html).toContain('data-estado="aguardando_aprovacao"');
    expect(html).toContain("aguardando sua aprovação");
    expect(html).toContain("&lt;bot &quot;novo&quot;&gt;");
    expect(html).toContain('state="blocked"');
  });

  it("traduz fila e execução para estados visuais usando a conversa", () => {
    const base = { ...estadoInicial, turnosVivos: { t1: { turnoId: "t1", conversaId: "c1", estado: "na_fila" as const, executor: null, machineId: null, desde: 0 } } };
    expect(estadoMascoteNaConversa(base, "c1")).toBe("pensando");
    expect(estadoMascoteNaConversa({ ...base, turnosVivos: { t1: { ...base.turnosVivos.t1!, estado: "rodando" } } }, "c1")).toBe("pensando");
    expect(estadoMascoteNaConversa(base, "outra")).toBe("disponivel");
    expect(estadoMascoteNaConversa({ ...base, turnosVivos: {
      ...base.turnosVivos, t2: { ...base.turnosVivos.t1!, turnoId: "t2", estado: "rodando" },
    } }, "c1")).toBe("pensando");
  });

  it("usa o mesmo estado na barra e nos espelhos; terminal entra em Executando", () => {
    const rodando = { ...estadoInicial, turnosVivos: { t1: { turnoId: "t1", conversaId: "c1", estado: "rodando" as const, executor: null, machineId: null, desde: 0 } } };
    expect(avatarNaConversa(rodando, "c1")).toBe("pensando");
    expect(estadoMascoteNaConversa(rodando, "c1")).toBe("pensando");
    const comFerramenta = { ...rodando, atividades: { c1: { t1: { ...ATIVIDADE_VAZIA, emUso: { texto: "Rodando um comando", frentes: false } } } } };
    expect(avatarNaConversa(comFerramenta, "c1")).toBe("executando");
    expect(avatarNaConversa({ ...rodando, turnosVivos: {} }, "c1")).toBe("disponivel");
  });

  it("mantém a aprovação acima do turno vivo e mostra término e sono pelos fatos do app", () => {
    const rodando = { ...estadoInicial, agora: 20_000, frota: { agentes: [{ id: "a1", conversaId: "c1" }] } as never, turnosVivos: { t1: { turnoId: "t1", conversaId: "c1", estado: "rodando" as const, executor: null, machineId: null, desde: 0 } } };
    const aprovacao = { ...rodando, suaVez: { itens: [{ decisao: { conversaId: "c1", tipo: "aprovacao" }, estadoColuna: "aberto" }] } as never };
    expect(estadoMascoteNaConversa(aprovacao, "c1")).toBe("aguardando_aprovacao");
    expect(estadoMascoteNaConversa({ ...rodando, turnosVivos: {}, falasSaindo: { c1: { t1: { em: 10_000 } } } as never }, "c1")).toBe("terminou");
    const mensagem = { kind: "texto", autoria: { autor_tipo: "agente" }, fimDoTurno: true, origemTurno: "conversa", criadoEm: 10_000 };
    expect(estadoMascoteNaConversa({ ...rodando, turnosVivos: {}, conversas: { c1: { mensagens: [mensagem] } } as never }, "c1")).toBe("terminou");
    expect(estadoMascoteNaConversa({ ...rodando, turnosVivos: {}, agora: 23_001, conversas: { c1: { mensagens: [mensagem] } } as never }, "c1")).toBe("disponivel");
    expect(estadoMascoteNaConversa({ ...rodando, turnosVivos: {}, computadorVisto: { a1: "dormindo" } }, "c1")).toBe("pausado");
  });
});

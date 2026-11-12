import { describe, expect, it } from "vitest";
import type { ComentarioDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { RunDaTarefa } from "../../../src/contracts/quadro-comentarios.ts";
import { prazoDaLateral, campoDePrazo } from "../../../web/telas/campos-da-tarefa.ts";
import { chipTrabalhando, entregas, registroDeExecucao } from "../../../web/telas/lado-da-tarefa.ts";
import { linhaDoTempo, quandoNaLinha, type DadosDaLinha } from "../../../web/telas/linha-do-tempo.ts";
import { pedidaPor } from "../../../web/telas/quadro-real.ts";
import { confiar } from "../../../web/telas/quadro.ts";

/** Rodada 4 (tela 18b do Paper, à risca): a lateral e a linha do tempo da tarefa aberta. */
const local = (h: number, m: number, diasAtras = 0) => new Date(2026, 10, 12 - diasAtras, h, m).getTime();
const agora = local(10, 20);
const agente = (id: string) => (id === "dante" ? { avatar: confiar('<span class="av">D</span>'), nome: "Dante", cor: "c-orange", trabalhando: confiar('<span class="av orbit">D</span>') } : id === "gil" ? { avatar: confiar('<span class="av">G</span>'), nome: "Gil" } : null);
const t = { id: "t1", quadroId: "q", titulo: "T", descricao: "", status: "fazendo", agenteId: "dante", movimentos: [], linhas: [] } as unknown as TarefaDto;
const com = (id: string, o: Partial<ComentarioDto> = {}): ComentarioDto => ({ id, quadroId: "q", tarefaId: "t1", autor: { tipo: "pessoa" }, texto: `texto ${id}`, deFora: false, criadoEm: local(10, 9), autorNome: null, acionados: [], paiId: null, ...o });
const run = (n: number, estado: RunDaTarefa["estado"]): RunDaTarefa => ({ turnoId: `r${n}`, agenteId: "dante", agenteNome: "Dante", comentarioId: null, execucao: n, estado, turnoAtual: `r${n}`, criadoEm: local(10, 2), comecouEm: local(10, 2), terminouEm: estado === "rodando" ? null : local(10, 4), custoUsd: 0.05, tokens: null, ultimaFrase: null, motivo: null });
const dados = (o: Partial<DadosDaLinha>): DadosDaLinha => ({ t, colunas: [{ id: "afazer", nome: "A fazer" }, { id: "fazendo", nome: "Fazendo" }] as never, comentarios: [], runs: [], agente, agora, nomes: ["Dante", "Gil"], respondendo: null, editando: null, abertos: new Set(), passos: () => null, chips: () => "", pendente: null, criadaPor: null, criadaEm: null, carga: "ok", ...o });

describe("tela 18b do Paper (rodada 4)", () => {
  it("Pedida por: quem pediu e o bot que criou ('Você, pela Ada'); sem quem pediu, nada", () => {
    expect(pedidaPor({ pedidoPorNome: "você" }, "Ada", ["Ada", "Dante"])).toEqual({ quem: "Você", via: "Ada", voce: true });
    expect(pedidaPor({ pedidoPorNome: null }, "Você, pela Ada", ["Ada"])).toEqual({ quem: "Você", via: "Ada", voce: true });
    expect(pedidaPor({ pedidoPorNome: "Ana" }, "Ana, pela Ada", [])).toEqual({ quem: "Ana", via: "Ada", voce: false });
    // "Ana" criou pela tela: não é bot, não vira "pela Ana".
    expect(pedidaPor({ pedidoPorNome: "você" }, "Ana", ["Ada"])).toEqual({ quem: "Você", via: null, voce: true });
    expect(pedidaPor({ pedidoPorNome: null }, "Ada", ["Ada"])).toBeNull();
  });

  it("o prazo da lateral: '14 nov' e quanto falta; o campo de data fica por cima", () => {
    const hoje = Date.parse("2026-11-12T15:00:00Z");
    expect(prazoDaLateral("2026-11-14", hoje, "America/Sao_Paulo")).toEqual({ data: "14 nov", falta: "em 2 dias", tom: "normal" });
    expect(prazoDaLateral("2026-11-13", hoje, "America/Sao_Paulo").falta).toBe("amanhã");
    expect(prazoDaLateral("2026-11-12", hoje, "America/Sao_Paulo")).toMatchObject({ falta: "hoje", tom: "hoje" });
    expect(prazoDaLateral("2026-11-11", hoje, "America/Sao_Paulo")).toMatchObject({ falta: "venceu ontem", tom: "vencida" });
    expect(prazoDaLateral("2026-11-02", hoje, "America/Sao_Paulo").falta).toBe("venceu há 10 dias");
    expect(prazoDaLateral("2027-01-05", hoje, "America/Sao_Paulo").data).toBe("5 jan 2027");
    const h = campoDePrazo({ id: "t1", prazoEm: "2026-11-14" }, { agora: hoje, fuso: "America/Sao_Paulo", onde: "lado" });
    expect(h).toContain('<span class="ta-prazo-data">14 nov</span><span class="qd-prazo-tom" data-tom="normal">em 2 dias</span>');
    expect(h).toContain('type="date" id="qd-t-prazo-em-lado" class="qd-data ta-prazo-in" data-campo="prazo-tarefa" data-id="t1" value="2026-11-14"');
    expect(h).toContain("Prazo da tarefa: 14 nov, em 2 dias");
    // No celular segue o campo de data com o rótulo de antes.
    expect(campoDePrazo({ id: "t1", prazoEm: "2026-11-14" }, { agora: hoje, fuso: "America/Sao_Paulo", onde: "cel" })).not.toContain("ta-prazo-vista");
  });

  it("a hora da linha do tempo é a do relógio: '10:02', 'ontem 9:14', '10/11 8:05'", () => {
    expect(quandoNaLinha(local(10, 2), agora)).toBe("10:02");
    expect(quandoNaLinha(local(9, 14, 1), agora)).toBe("ontem 9:14");
    expect(quandoNaLinha(local(8, 5, 2), agora)).toBe("10/11 8:05");
  });

  it("a linha do tempo: 'Atividade N', o evento do quadro com 'acionou', a criação e o 'Você' com as iniciais", () => {
    const tt = { ...t, movimentos: [{ id: "m1", tarefaId: "t1", tipo: "mover", de: "afazer", para: "fazendo", agenteAntes: "dante", agenteDepois: "dante", autor: { tipo: "pessoa" }, motivo: null, loteId: "l", acionou: true, desfeitoEm: null, criadoEm: local(10, 2), autorNome: null, agenteAntesNome: "Dante", agenteDepoisNome: "Dante" }] } as unknown as TarefaDto;
    const h = linhaDoTempo(dados({ t: tt, comentarios: [com("c1", { texto: "@Gil olha", acionados: ["gil"] })], criadaPor: "Você, pela Ada", criadaEm: local(9, 14, 1), criadaResumo: "criou a tarefa a partir das notas da call", voceIniciais: "MW" }));
    expect(h).toContain('Atividade <span class="ta-sec-n">3</span>');
    expect(h).toContain('<p class="ta-ev-txt">Ada criou a tarefa a partir das notas da call.</p>');
    expect(h).toContain('<p class="ta-ev-txt">Moveu de A fazer para Fazendo.</p><p class="ta-ev-sub">acionou Dante</p>');
    expect(h).toContain(">ontem 9:14</time>");
    expect(h).toContain('<span class="qd-anel" role="img" aria-label="Você">MW</span>');
    expect(h).toContain('<p class="ta-com-acao">acionou Gil</p>');
    expect(h).toContain('placeholder="Comentar… @nome chama outro bot"');
    expect(h).not.toContain("ta-aguarda");
  });

  it("o mascote em órbita no chip e no run que roda; 'Nada entregue ainda.'", () => {
    const runs = [run(1, "concluido"), run(2, "rodando")];
    expect(chipTrabalhando(runs, agente)).toContain('<span class="ta-pilha-av"><span class="av orbit">D</span></span>');
    const reg = registroDeExecucao({ runs, agente, agora, aberto: true });
    expect(reg).toContain('<span class="ta-reg-av" aria-hidden="true"><span class="av orbit">D</span></span>');
    expect(entregas({ comentarios: [], todas: false, aberto: true })).toContain("Nada entregue ainda.");
  });
});

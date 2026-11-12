import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comTexto } from "../../../web/lib/atividade.ts";
import { FALA_ORFA_MS, FALA_SAINDO_MS } from "../../../web/lib/fala-viva.ts";
import { blocosAoVivo, blocosDoHistorico } from "../../../web/telas/conversa.ts";

/**
 * C1 e C2 (definido em 2026-11-12, fase 0 da migração do front): a fala do meio do turno não troca de chave nem de região
 * enquanto não vira gravada (o nó é o mesmo, nada anima de novo), e o retrato só sai quando a gravada está na conversa.
 */
const C = "c1";
const AGORA = Date.parse("2026-11-12T12:00:00Z");
const conversa = (mensagens: Mensagem[]): ConversaDto => ({
  conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
  mensagens, turnosPendentes: [], turnosEmCurso: [{ id: "t1" }] as never, turnosCancelados: [], propostas: [], fios: [],
});
const gravada = (texto: string): Mensagem => ({ tenantId: "t", id: `m-${texto}`, conversaId: C, turnoId: "t1", autoria: { autor_tipo: "agente", autor_id: "a" } as Mensagem["autoria"], kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA + 1 });

function comTurno(): Estado {
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: conversa([]), agora: AGORA - 1000 });
  return {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never,
    turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA - 5000 } },
    atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Primeira parte.") } },
  };
}
const fala = (e: Estado, agora: number): Estado => reduzir(e, { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: "t1", conversaId: C } } as never, agora });
const chaves = (e: Estado): string[] => blocosAoVivo(e.conversas[C]!, e).map((b) => b.chave);
const relida = (e: Estado, ms: Mensagem[], agora: number): Estado => reduzir(e, { tipo: "hidratar-conversa", conversa: conversa(ms), agora });

describe("C1: a fala do meio fica com a chave até virar gravada", () => {
  it("o retrato herda a chave (e o nó) da fala viva; a fala que recomeça é o único bloco novo", () => {
    const e = comTurno();
    expect(chaves(e)).toEqual(["vivo:t1"]);
    const meio = fala(e, AGORA);
    // O texto "Primeira parte." continua no bloco vivo:t1 (o mesmo nó): nem troca de região nem anima de novo.
    const blocos = blocosAoVivo(meio.conversas[C]!, meio);
    expect(blocos.map((b) => b.chave)).toEqual(["vivo:t1", "vivo:t1:1"]);
    expect(blocos[0]!.html).toContain("Primeira parte.");
    // A fala viva seguinte escreve no bloco novo, e a chave do retrato não muda com ela.
    const depois = { ...meio, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Segunda parte.") } } };
    expect(chaves(depois)).toEqual(["vivo:t1", "vivo:t1:1"]);
    expect(blocosAoVivo(depois.conversas[C]!, depois)[1]!.html).toContain("Segunda parte.");
  });

  it("a releitura que traz a gravada tira só o retrato: a fala viva segue com a chave dela (o nó não troca)", () => {
    const meio = fala(comTurno(), AGORA);
    const com = relida(meio, [gravada("Primeira parte.")], AGORA + 300);
    expect(chaves(com)).toEqual(["vivo:t1:1"]);
    expect(blocosDoHistorico(com.conversas[C]!, com).map((b) => b.chave)).toContain("m-Primeira parte.");
  });
});

describe("C2: o retrato só sai quando a gravada está na conversa", () => {
  it("com o turno vivo, o retrato não vence aos 15 s (nem com o tick, nem desenhando)", () => {
    const meio = fala(comTurno(), AGORA);
    const tarde = reduzir(meio, { tipo: "tick", agora: AGORA + FALA_SAINDO_MS * 4 });
    expect(chaves(tarde)).toEqual(["vivo:t1", "vivo:t1:1"]);
  });

  it("a releitura que saiu antes da gravada não tira o retrato; a que a traz, tira", () => {
    const meio = fala(comTurno(), AGORA);
    const semEla = relida(meio, [], AGORA + 20_000);
    expect(chaves(semEla)).toEqual(["vivo:t1", "vivo:t1:1"]);
    expect(chaves(relida(semEla, [gravada("Primeira parte.")], AGORA + 21_000))).toEqual(["vivo:t1:1"]);
  });

  it("lê primeiro a conversa da tela: com a gravada já nela, uma resposta velha (sem ela) também tira o retrato", () => {
    const meio = fala(comTurno(), AGORA);
    // A gravada chegou por outra leitura (a tela já a tem) e o retrato ficou de um instante antes.
    const naTela: Estado = { ...meio, conversas: { ...meio.conversas, [C]: { ...meio.conversas[C]!, mensagens: [gravada("Primeira parte.")] } } };
    expect(chaves(reduzir(naTela, { tipo: "tick", agora: AGORA + 100 }))).toEqual(["vivo:t1:1"]);
  });

  it("o órfão (turno acabado, nenhuma gravada) sai em FALA_ORFA_MS", () => {
    const meio = fala(comTurno(), AGORA);
    const fim = reduzir(meio, { tipo: "frame", frame: { tipo: "turno.interrompido", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA + 100 });
    expect(Object.keys(reduzir(fim, { tipo: "tick", agora: AGORA + FALA_ORFA_MS - 1 }).falasSaindo?.[C] ?? {})).not.toHaveLength(0);
    expect(reduzir(fim, { tipo: "tick", agora: AGORA + FALA_ORFA_MS + 200 }).falasSaindo?.[C]).toBeUndefined();
  });
});

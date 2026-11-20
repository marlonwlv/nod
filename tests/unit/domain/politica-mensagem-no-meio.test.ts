import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { CAPACIDADES_HARNESS, SEM_CAPACIDADES } from "../../../src/contracts/harness.ts";
import { criarRastreadorDaVolta, decidirMensagemNoMeio, extrairMarcaDeRetomada, MARCA_DE_RETOMADA, molduraDaInterrupcao, TRECHO_DA_PARCIAL_MAX } from "../../../src/domain/mensagem-no-meio.ts";

const RESULT = { tipo: "result", sucesso: true, subtype: "success", sessaoCli: null, texto: "", custoUsd: null, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [] } as unknown as EventoStream;
const delta = (texto: string): EventoStream => ({ tipo: "delta", texto });
const COM = { interrompeVolta: true, parcialNoHistorico: true };

describe("ADR-186: o estado da volta sai dos eventos normalizados (qualquer harness)", () => {
  it("escrevendo → ação aberta → escrevendo → entre voltas; o texto da volta zera no result", () => {
    const r = criarRastreadorDaVolta();
    expect(r.estado()).toBe("entre_voltas");
    r.evento(delta("A história"));
    expect([r.estado(), r.textoDaVolta()]).toEqual(["escrevendo", "A história"]);
    r.evento({ tipo: "tool_use", id: "t1", nome: "Bash", input: {} });
    expect(r.estado()).toBe("acao_aberta");
    r.evento({ tipo: "tool_result", toolUseId: "t1", isError: false, texto: "" });
    expect(r.estado()).toBe("escrevendo");
    r.evento(RESULT);
    expect([r.estado(), r.textoDaVolta()]).toEqual(["entre_voltas", ""]);
  });

  it("trabalho em segundo plano segura o estado até terminar; subagente em primeiro plano não conta", () => {
    const r = criarRastreadorDaVolta();
    r.evento(delta("x"));
    r.evento({ tipo: "tarefa_fundo", id: "b1", estado: "iniciada" } as EventoStream);
    expect(r.estado()).toBe("segundo_plano");
    r.evento({ tipo: "tarefa_fundo", id: "b1", estado: "terminada" } as EventoStream);
    r.evento({ tipo: "tarefa_fundo", id: "s1", estado: "iniciada", emFundo: false } as EventoStream);
    expect(r.estado()).toBe("escrevendo");
  });
});

describe("ADR-186: uma regra para todo harness", () => {
  const base = { estado: "escrevendo" as const, textoDaVolta: "1. Origens", jaInterrompeu: false, daConversa: true, capacidades: COM };

  it("só escrevendo, na conversa, com harness que para a volta: interrompe", () => {
    expect(decidirMensagemNoMeio(base)).toEqual({ tipo: "interromper_e_entregar", trechoDaParcial: null });
  });

  it("ação aberta, segundo plano, entre voltas, frente/rotina, harness sem a capacidade, ou já interrompida: só entrega", () => {
    for (const estado of ["acao_aberta", "segundo_plano", "entre_voltas"] as const) expect(decidirMensagemNoMeio({ ...base, estado }).tipo).toBe("entregar");
    expect(decidirMensagemNoMeio({ ...base, daConversa: false }).tipo).toBe("entregar");
    expect(decidirMensagemNoMeio({ ...base, capacidades: { ...COM, interrompeVolta: false } }).tipo).toBe("entregar");
    expect(decidirMensagemNoMeio({ ...base, jaInterrompeu: true }).tipo).toBe("entregar");
  });

  it("harness que não guarda a parcial (Codex): o trecho vai na moldura, cortado no teto", () => {
    const d = decidirMensagemNoMeio({ ...base, textoDaVolta: "x".repeat(2000), capacidades: { interrompeVolta: true, parcialNoHistorico: false } });
    // O começo (o assunto) e o FIM (onde parou), para o modelo continuar dali.
    const longa = `${"a".repeat(1000)}${"b".repeat(1000)}`;
    const t = decidirMensagemNoMeio({ ...base, textoDaVolta: longa, capacidades: { interrompeVolta: true, parcialNoHistorico: false } });
    expect(t.tipo === "interromper_e_entregar" && t.trechoDaParcial).toMatch(/^a+ \[…\] b+$/);
    expect(t.tipo === "interromper_e_entregar" && t.trechoDaParcial!.length).toBeLessThanOrEqual(TRECHO_DA_PARCIAL_MAX + 10);
    expect(d.tipo).toBe("interromper_e_entregar");
    expect(molduraDaInterrupcao("só 3 frases", "1. Origens «x»")).toContain("«1. Origens ‹x›»");
    expect(molduraDaInterrupcao("só 3 frases", null)).toContain("A mensagem dela: «só 3 frases»");
  });

  it("a moldura deixa o modelo decidir: correção segue o novo; à parte ou acréscimo continua de onde parou, com a marca", () => {
    const m = molduraDaInterrupcao("quanto é 2+2?", null);
    expect(m).toContain("se ela mudou ou corrigiu o pedido, siga o pedido novo");
    expect(m).toContain("Se é uma pergunta ou um assunto à parte, responda curto e depois continue a resposta anterior exatamente de onde parou");
    expect(m).toContain("Se ela acrescentou algo ao pedido, continue de onde parou e inclua o acréscimo");
    expect(m).toContain(MARCA_DE_RETOMADA);
  });

  it("a marca de retomada sai do texto (no começo ou depois de uma linha) e diz que houve", () => {
    expect(extrairMarcaDeRetomada("[[continua]] Dois mais dois é 4.\n\n2. Segundo Reinado")).toEqual({ texto: "Dois mais dois é 4.\n\n2. Segundo Reinado", retomou: true });
    expect(extrairMarcaDeRetomada("Dois mais dois é 4.\n[[CONTINUA]]\n2. Segundo Reinado")).toEqual({ texto: "Dois mais dois é 4.\n2. Segundo Reinado", retomou: true });
    expect(extrairMarcaDeRetomada("A revolução em uma frase.")).toEqual({ texto: "A revolução em uma frase.", retomou: false });
  });

  it("as capacidades medidas: Claude e Codex param a volta; só o Claude guarda a parcial; harness sem medição, nada", () => {
    expect(CAPACIDADES_HARNESS["claude-cli"]).toMatchObject({ interrompeVolta: true, parcialNoHistorico: true });
    expect(CAPACIDADES_HARNESS["codex-cli"]).toMatchObject({ interrompeVolta: true, parcialNoHistorico: false });
    expect(CAPACIDADES_HARNESS["cursor-cli"]).toMatchObject({ interrompeVolta: false });
    expect(SEM_CAPACIDADES).toMatchObject({ interrompeVolta: false, parcialNoHistorico: false });
  });
});

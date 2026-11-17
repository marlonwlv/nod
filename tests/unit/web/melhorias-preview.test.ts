import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { renderMensagem, situacaoNaFila } from "../../../web/telas/conversa.ts";
import { renderFaixaParada } from "../../../web/telas/faixa-parada.ts";

const css = (f: string) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8");

describe("o Parar é uma linha discreta, não uma caixa vermelha", () => {
  it("o caso comum diz só 'Parado por você', sem contagens nem ×", () => {
    const h = renderFaixaParada({ interrompidas: 2, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(h).toContain("<span>Parado por você</span>");
    expect(h).not.toMatch(/interrompida\(s\)|não interrompida|já entregue|Nada foi reenviado|fechar-faixa/);
  });

  it("os números só aparecem quando contam algo inesperado, com o detalhe no title", () => {
    const h = renderFaixaParada({ interrompidas: 1, naoInterrompidas: [{ turnoId: "abcdef1234", motivo: "em outra máquina" }], jaEntregues: [{ id: "m1", em: Date.UTC(2026, 10, 16, 22, 0) }], nadaRodando: false });
    expect(h).toContain("1 continuou rodando");
    expect(h).toContain('title="abcdef12: em outra máquina"');
    expect(h).toContain("1 resposta já tinha saído");
  });

  it("'Nada estava rodando' continua escrito", () => {
    expect(renderFaixaParada({ interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true })).toContain("Nada estava rodando.");
  });

  it("na conversa: sem caixa e sem vermelho, cinza em corpo 2; some com a próxima mensagem", () => {
    const c = css("casca.css");
    expect(c).toMatch(/\.timeline \.faixa\.faixa-parada \{[^}]*border: 0;[^}]*background: none; color: var\(--ink-3\); font-size: var\(--fs-corpo-2\);/);
    const m = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(m).toContain('if (estado.faixaParada) dispatch({ tipo: "faixa", faixa: null });');
  });
});

describe("ADR-185: o selo da fala que o turno vivo absorveu", () => {
  const C = "c1";
  const mensagem = { tenantId: "t", id: "m2", conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto: "resume em 3", payload: null, confianca: "confiavel", parcial: false, criadoEm: 2 } as unknown as Mensagem;
  const comSessao = (lidoEm: number | null) => {
    const conversa: ConversaDto = {
      conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
      mensagens: [mensagem], turnosPendentes: [], turnosEmCurso: [{ id: "t1", estado: "despachando", desde: 1, mensagemId: "m1" }], turnosCancelados: [], propostas: [], fios: [],
      turnosNaSessao: [{ id: "t2", mensagemId: "m2", absorvidoPor: "t1", lidoEm }],
    };
    const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 3 });
    return { ...e, frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C }] } as never };
  };

  it("escrita e não lida: 'Entregue · <bot> lê ao fim do passo atual', sem Cancelar (ela já está na sessão)", () => {
    const s = situacaoNaFila(mensagem, comSessao(null));
    expect(s).toMatchObject({ tipo: "na_sessao", texto: "Entregue · Nina lê ao fim do passo atual", turnoId: "t2" });
    expect(s?.botao).toBeUndefined();
    expect(renderMensagem(mensagem, comSessao(null))).toContain('data-fila="na_sessao"');
  });

  it("lida: 'Lida'", () => {
    expect(situacaoNaFila(mensagem, comSessao(5))).toMatchObject({ tipo: "lida", texto: "Lida" });
  });
});


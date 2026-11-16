import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, situacaoNaFila } from "../../../web/telas/conversa.ts";

const C = "c1";
const AGORA = 1_000_000;

function mensagem(id: string): Mensagem {
  return { tenantId: "t", id, conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto: "fazer novamente", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA } as unknown as Mensagem;
}

function comConversa(dto: Partial<ConversaDto>): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    ...dto,
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...e, frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C }] } as never };
}

/**
 * COP-14 (item 1, definido em 2026-11-12): a mensagem mandada com o bot trabalhando entra como qualquer balão — sem chip
 * "Na fila", sem relógio, sem Cancelar/Desfazer e sem "Cancelada · não rodou". Fica só a linha da exceção do nod (máquina
 * desligada, acordando ou sem IA), sem botão.
 */
describe("fila da conversa: a mensagem entra como qualquer balão (COP-14)", () => {
  const emCurso = (id: string, estado: "pendente" | "despachando", mensagemId: string | null) => ({ id, estado, desde: AGORA, mensagemId });

  it("uma ou duas na fila, com a máquina em ordem: nenhuma linha, nenhum chip, nenhum Cancelar", () => {
    const uma = comConversa({ turnosEmCurso: [emCurso("rodando", "despachando", "m1"), emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), uma)).toBeNull();
    expect(situacaoNaFila(mensagem("m1"), uma)).toBeNull();
    const duas = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2"), emCurso("t3", "pendente", "m3")] });
    expect(situacaoNaFila(mensagem("m3"), duas)).toBeNull();
    const html = renderMensagem(mensagem("m3"), duas);
    for (const fora of ["fila-chip", "fila-relogio", "fila-linha", 'data-act="cancelar-turno"', "Na fila"]) expect(html).not.toContain(fora);
  });

  it("NOD-402: a rotina na fila dos bastidores também não gera linha", () => {
    const e = comConversa({ turnosEmCurso: [{ ...emCurso("r1", "pendente", null), origem: "rotina", bastidores: true } as never, emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), e)).toBeNull();
  });

  it("sem Cancelando/Desfazer nem 'Cancelada · não rodou'", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] });
    const cancelando = reduzir(e, { tipo: "cancelando-turno", turnoId: "t2", agora: AGORA });
    expect(situacaoNaFila(mensagem("m2"), cancelando)).toBeNull();
    expect(renderMensagem(mensagem("m2"), cancelando)).not.toContain('data-act="desfazer-cancelamento"');
    const cancelada = comConversa({ turnosCancelados: [{ id: "t2", mensagemId: "m2" }] });
    expect(situacaoNaFila(mensagem("m2"), cancelada)).toBeNull();
    expect(renderMensagem(mensagem("m2"), cancelada)).not.toContain("não rodou");
  });

  it("mensagem cujo turno já rodou (ou foi lido junto com outro) não tem linha", () => {
    const e = comConversa({});
    expect(situacaoNaFila(mensagem("m1"), e)).toBeNull();
    expect(renderMensagem(mensagem("m1"), e)).not.toContain("fila-");
  });
});

describe("fila da conversa com a máquina do bot fora do ar (exceção do nod, COP-14)", () => {
  const emCurso = (id: string, mensagemId: string) => ({ id, estado: "pendente" as const, desde: AGORA, mensagemId });
  const maquina = (id: string, nome: string, conectada: boolean) => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: Date.UTC(2026, 9, 9, 14, 32), conectada, plataforma: conectada ? ("darwin" as const) : null, ias: (conectada ? { "claude-cli": "pronto" } : {}) as MaquinaDto["ias"], gh: false });
  function com(maquinaIdDoBot: string | null, maquinas: ReturnType<typeof maquina>[], padraoId: string | null = null): Estado {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "m2")] });
    return { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: maquinaIdDoBot }] } as never, maquinas: { maquinas, padraoId } };
  }

  it("máquina desligada: '{Bot} lê quando a máquina ligar', numa linha sem botão", () => {
    const e = com("vm", [maquina("vm", "vm-sp", false), maquina("mac", "MacBook", true)]);
    expect(situacaoNaFila(mensagem("m2"), e)).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Ze 1 lê quando a máquina ligar" });
    const html = renderMensagem(mensagem("m2"), e);
    expect(html).toContain('<div class="fila-linha" role="status">Ze 1 lê quando a máquina ligar</div>');
    for (const fora of ["rodar-desta-vez", "secao-espaco", "cancelar-turno", "fila-chip"]) expect(html).not.toContain(fora);
  });

  it("vale também pelo padrão da pessoa", () => {
    const e = com(null, [maquina("vm", "vm-sp", false)], "vm");
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ tipo: "na_fila", turnoId: "t2", texto: "Ze 1 lê quando a máquina ligar" });
    expect(renderMensagem(mensagem("m2"), e)).not.toContain("rodar-desta-vez");
  });

  it("máquina do bot conectada mas sem IA pronta: '{Bot} está sem IA configurada'", () => {
    const e = com("vm", [{ ...maquina("vm", "vm-sp", true), ias: { "claude-cli": "nao_autenticado" as const } }]);
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ texto: "Ze 1 está sem IA configurada" });
  });

  it("sem IA NESTE computador: a mesma linha, sem pedir terminal", () => {
    const e = { ...com("vm", [{ ...maquina("vm", "Windows de Marlon", true), ias: { "claude-cli": "ausente" as const } }]), estaMaquina: { id: "vm", nome: "Windows de Marlon", plataforma: "win32" as const } };
    const s = situacaoNaFila(mensagem("m2"), e);
    expect(s?.texto).toBe("Ze 1 está sem IA configurada");
    expect(s?.texto).not.toContain("nod-motor");
  });

  it("máquina do bot conectada: nenhuma linha", () => {
    const e = com("vm", [maquina("vm", "vm-sp", true)]);
    expect(situacaoNaFila(mensagem("m2"), e)).toBeNull();
  });

  it("QA do NOD-314 (achado 7): o turno mandado 'desta vez' para outra máquina espera ESSA máquina, não a do bot", () => {
    const e = comConversa({ turnosEmCurso: [{ ...emCurso("t2", "m2"), maquinaDestaVez: "mac" }] });
    const fora = { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: "vm" }] } as never, maquinas: { maquinas: [maquina("vm", "vm-sp", true), maquina("mac", "MacBook", false)], padraoId: null } };
    expect(situacaoNaFila(mensagem("m2"), fora)).toMatchObject({ texto: "Ze 1 lê quando a máquina ligar" });
    // A do bot fora do ar, mas a desta vez conectada: nenhuma linha (não acusa a do bot).
    const viva = { ...fora, maquinas: { maquinas: [maquina("vm", "vm-sp", false), maquina("mac", "MacBook", true)], padraoId: null } };
    expect(situacaoNaFila(mensagem("m2"), viva)).toBeNull();
  });
});

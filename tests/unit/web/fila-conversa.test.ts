import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, situacaoNaFila } from "../../../web/telas/conversa.ts";

const C = "c1";
/** Só a linha da fila (as ações da mensagem no hover também têm `data-act`). */
const linha = (html: string): string => /<div class="fila-linha"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
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
 * Acessos · fila (revisto em 2026-11-16, revê o item 1 da COP-14): a mensagem na fila é um balão comum com `data-na-fila`
 * e `aria-busy`, e embaixo a linha pequena "Na fila · Cancelar". O Cancelar vai ao servidor na hora; a linha segue a fase.
 */
describe("fila da conversa: balão comum e a linha 'Na fila · Cancelar'", () => {
  const emCurso = (id: string, estado: "pendente" | "despachando", mensagemId: string | null) => ({ id, estado, desde: AGORA, mensagemId });

  it("(a) turno pendente e na fila: a linha 'Na fila' com Cancelar do turno, e o balão em voo", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("rodando", "despachando", "m1"), emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ tipo: "na_fila", texto: "Na fila", turnoId: "t2" });
    const html = renderMensagem(mensagem("m2"), e);
    expect(html).toContain('class="fila-linha" role="status"');
    expect(html).toMatch(/data-act="cancelar-turno" data-id="t2"[^>]*aria-label="Cancelar só esta mensagem">Cancelar</);
    expect(html).toContain('data-na-fila aria-busy="true"');
    // Sem chip, sem relógio, sem vermelho e sem apagar a cor do balão.
    for (const fora of ["fila-chip", "fila-relogio", "perigo", "fila-na_fila", "lê quando terminar"]) expect(html).not.toContain(fora);
  });

  it("(b) o turno que já roda e a fala do bot não têm linha", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("rodando", "despachando", "m1")] });
    expect(situacaoNaFila(mensagem("m1"), e)).toBeNull();
    expect(renderMensagem(mensagem("m1"), e)).not.toContain("fila-linha");
    const doBot = { ...mensagem("m1"), autoria: { autor_tipo: "agente", autor_id: "a" } } as unknown as Mensagem;
    expect(situacaoNaFila(doBot, comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m1")] }))).toBeNull();
  });

  it("NOD-402: a rotina na fila dos bastidores não gera linha; a fala da pessoa ao lado dela sim", () => {
    const e = comConversa({ turnosEmCurso: [{ ...emCurso("r1", "pendente", null), origem: "rotina", bastidores: true } as never, emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ tipo: "na_fila", turnoId: "t2" });
  });

  it("(d) Cancelando…, depois 'Cancelada · não rodou · Desfazer' e, passados os 5 s, sem Desfazer", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] });
    const cancelando = reduzir(e, { tipo: "cancelando-turno", turnoId: "t2", conversaId: C, mensagemId: "m2", agora: AGORA });
    expect(situacaoNaFila(mensagem("m2"), cancelando)).toMatchObject({ tipo: "cancelando", texto: "Cancelando…" });
    const htmlCancelando = renderMensagem(mensagem("m2"), cancelando);
    expect(linha(htmlCancelando)).not.toContain("data-act=");
    expect(htmlCancelando).toContain("aria-busy");

    // O servidor cancelou e a releitura já trouxe o turno em `turnosCancelados`: a fase local manda.
    const ok = reduzir(reduzir(cancelando, { tipo: "turno-cancelado", turnoId: "t2", agora: AGORA + 300 }), { tipo: "hidratar-conversa", conversa: { ...cancelando.conversas[C]!, turnosEmCurso: [], turnosCancelados: [{ id: "t2", mensagemId: "m2" }] } as never, agora: AGORA + 400 });
    const html = renderMensagem(mensagem("m2"), ok);
    expect(html).toContain("Cancelada · não rodou");
    expect(html).toMatch(/data-act="desfazer-cancelamento" data-id="t2"[^>]*>Desfazer</);
    expect(html).toContain("message you");
    expect(html).toContain("fila-cancelada");
    expect(html).not.toContain("aria-busy");

    const depois = reduzir(ok, { tipo: "desfazer-expirou", turnoId: "t2" });
    const htmlDepois = renderMensagem(mensagem("m2"), depois);
    expect(htmlDepois).toContain("Cancelada · não rodou");
    expect(htmlDepois).not.toContain("desfazer-cancelamento");
  });

  it("a cancelada sem fase local (recarregou a página) mostra só 'Cancelada · não rodou'", () => {
    const e = comConversa({ turnosCancelados: [{ id: "t2", mensagemId: "m2" }] });
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ tipo: "cancelada", texto: "Cancelada · não rodou" });
    expect(linha(renderMensagem(mensagem("m2"), e))).not.toContain("data-act=");
  });

  it("(e) 409: 'Já entrou no turno · não deu para cancelar', sem botão; erro de rede: 'Não consegui cancelar · Tentar de novo'", () => {
    const e = reduzir(comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] }), { tipo: "cancelando-turno", turnoId: "t2", conversaId: C, mensagemId: "m2", agora: AGORA });
    const tarde = reduzir(e, { tipo: "cancelamento-recusado", turnoId: "t2", fase: "tarde", agora: AGORA });
    const htmlTarde = renderMensagem(mensagem("m2"), tarde);
    expect(htmlTarde).toContain("Já entrou no turno · não deu para cancelar");
    expect(linha(htmlTarde)).not.toContain("data-act=");
    const erro = reduzir(e, { tipo: "cancelamento-recusado", turnoId: "t2", fase: "erro", agora: AGORA });
    const htmlErro = renderMensagem(mensagem("m2"), erro);
    expect(htmlErro).toContain("Não consegui cancelar");
    expect(htmlErro).toMatch(/data-act="cancelar-turno" data-id="t2"[^>]*>Tentar de novo</);
  });

  it("o Desfazer que reenviou esconde o balão cancelado; o que devolveu ao campo diz 'voltou para o campo'", () => {
    const base = reduzir(comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] }), { tipo: "cancelando-turno", turnoId: "t2", conversaId: C, mensagemId: "m2", agora: AGORA });
    const ok = reduzir(base, { tipo: "turno-cancelado", turnoId: "t2", agora: AGORA });
    expect(renderMensagem(mensagem("m2"), reduzir(ok, { tipo: "desfazer-cancelamento", turnoId: "t2", como: "desfeita" }))).toBe("");
    const voltou = renderMensagem(mensagem("m2"), reduzir(ok, { tipo: "desfazer-cancelamento", turnoId: "t2", como: "voltou" }));
    expect(voltou).toContain("Cancelada · voltou para o campo");
    expect(linha(voltou)).not.toContain("data-act=");
  });

  it("(f) na sala e na tela da task não há Cancelar", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] });
    expect(renderMensagem(mensagem("m2"), e, true)).not.toContain("cancelar-turno");
    expect(renderMensagem(mensagem("m2"), e, false, { chipDaFala: "" })).not.toContain("cancelar-turno");
    const sala = { ...e, conversas: { [C]: { ...e.conversas[C]!, conversa: { ...e.conversas[C]!.conversa, salaId: "s1" } } } };
    expect(situacaoNaFila(mensagem("m2"), sala)).toBeNull();
  });
});

describe("fila da conversa com a máquina do bot fora do ar (exceção do nod, COP-14)", () => {
  const emCurso = (id: string, mensagemId: string) => ({ id, estado: "pendente" as const, desde: AGORA, mensagemId });
  const maquina = (id: string, nome: string, conectada: boolean) => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: Date.UTC(2026, 9, 9, 14, 32), conectada, plataforma: conectada ? ("darwin" as const) : null, ias: (conectada ? { "claude-cli": "pronto" } : {}) as MaquinaDto["ias"], gh: false });
  function com(maquinaIdDoBot: string | null, maquinas: ReturnType<typeof maquina>[], padraoId: string | null = null): Estado {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "m2")] });
    return { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: maquinaIdDoBot }] } as never, maquinas: { maquinas, padraoId } };
  }

  it("(c) máquina desligada: '{Bot} lê quando a máquina ligar · Cancelar'", () => {
    const e = com("vm", [maquina("vm", "vm-sp", false), maquina("mac", "MacBook", true)]);
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ tipo: "na_fila", turnoId: "t2", texto: "Ze 1 lê quando a máquina ligar" });
    const html = renderMensagem(mensagem("m2"), e);
    expect(html).toContain("<span>Ze 1 lê quando a máquina ligar</span>");
    expect(html).toContain('data-act="cancelar-turno" data-id="t2"');
    for (const fora of ["rodar-desta-vez", "secao-espaco", "fila-chip"]) expect(html).not.toContain(fora);
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

  it("máquina do bot conectada: a linha comum 'Na fila'", () => {
    const e = com("vm", [maquina("vm", "vm-sp", true)]);
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ texto: "Na fila" });
  });

  it("QA do NOD-314 (achado 7): o turno mandado 'desta vez' para outra máquina espera ESSA máquina, não a do bot", () => {
    const e = comConversa({ turnosEmCurso: [{ ...emCurso("t2", "m2"), maquinaDestaVez: "mac" }] });
    const fora = { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: "vm" }] } as never, maquinas: { maquinas: [maquina("vm", "vm-sp", true), maquina("mac", "MacBook", false)], padraoId: null } };
    expect(situacaoNaFila(mensagem("m2"), fora)).toMatchObject({ texto: "Ze 1 lê quando a máquina ligar" });
    // A do bot fora do ar, mas a desta vez conectada: a linha comum (não acusa a do bot).
    const viva = { ...fora, maquinas: { maquinas: [maquina("vm", "vm-sp", false), maquina("mac", "MacBook", true)], padraoId: null } };
    expect(situacaoNaFila(mensagem("m2"), viva)).toMatchObject({ texto: "Na fila" });
  });
});

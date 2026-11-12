import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto, comVigia, type VigiaDaAtividade } from "../../../web/lib/atividade.ts";
import { blocosAoVivo, botoesDoCampo, htmlComposer, pararNoCampoDaConversa, pararNoCampoDaTela, renderCabecalhoConversa } from "../../../web/telas/conversa.ts";

/** NOD-73: o aviso do vigia na tela (protótipo do Gil) — só aviso, com o Parar que já existe. */
const C = "c1";
const AGORA = Date.parse("2026-10-05T14:00:00Z");
const MIN = 60_000;

function cenario(vigia: VigiaDaAtividade | null, comCartao = true): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const atividade = comCartao ? comFerramenta(comTexto(ATIVIDADE_VAZIA, "Rodando os testes."), "Rodou um comando") : ATIVIDADE_VAZIA;
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never, tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never,
    turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA - 30 * MIN } },
    atividades: { [C]: { t1: vigia ? comVigia(atividade, vigia) : atividade } },
  };
  return { e, c: e.conversas[C]! };
}

const corpo = (e: Estado, c: ConversaEstado) => blocosAoVivo(c, e).find((b) => b.chave === "vivo:t1")!.html;

/**
 * COP-14 (item 2, definido em 2026-11-12): a fala viva é só a linha do indicador. O aviso âmbar do vigia saiu dela; o
 * silêncio aparece no rótulo ("Ainda trabalhando · N min") e no cabeçalho, e o Parar mora só no campo.
 */
describe("vigia do turno na tela (NOD-73, revisto no COP-14)", () => {
  it("sem aviso: o rótulo é o da ferramenta, sem bloco âmbar", () => {
    const { e, c } = cenario(null);
    expect(corpo(e, c)).not.toContain("atividade-vigia");
    expect(corpo(e, c)).not.toContain("Ainda trabalhando");
    expect(renderCabecalhoConversa(e, "a")).not.toContain("sem novidade");
  });

  it("silêncio com ferramenta aberta: o indicador diz 'Ainda trabalhando · N min', sem aviso nem Parar; o cabeçalho conta", () => {
    const { e, c } = cenario({ mudoDesde: AGORA - 12 * MIN, aberta: "Terminal", emFundo: 0, repeticao: null });
    const html = corpo(e, c);
    expect(html).toContain('<span class="indicador-rotulo brilho" data-parte="rotulo-mudo">Ainda trabalhando · 12 min</span>');
    expect(html).toContain('aria-label="Ada está ainda trabalhando · 12 min"');
    for (const fora of ["atividade-vigia", "vigia-ic", "Sem novidade", "Terminal", 'data-act="parar-conversa"', "<details"]) expect(html).not.toContain(fora);
    expect(renderCabecalhoConversa(e, "a")).toContain("sem novidade há 12 min");
    // O relógio da tela anda sem frame novo.
    expect(corpo({ ...e, agora: AGORA + 5 * MIN }, c)).toContain("Ainda trabalhando · 17 min");
  });

  it("segundo plano e nada aberto: o mesmo rótulo (o que espera fica na Atividade)", () => {
    const fundo = cenario({ mudoDesde: AGORA - 10 * MIN, aberta: null, emFundo: 2, repeticao: null });
    expect(corpo(fundo.e, fundo.c)).toContain("Ainda trabalhando · 10 min");
    expect(corpo(fundo.e, fundo.c)).not.toContain("segundo plano");
    const nada = cenario({ mudoDesde: AGORA - 10 * MIN, aberta: null, emFundo: 0, repeticao: null });
    expect(corpo(nada.e, nada.c)).toContain("Ainda trabalhando · 10 min");
    expect(corpo(nada.e, nada.c)).not.toContain("O bot não responde.");
  });

  it("repetição: não entra na linha do indicador; sem silêncio, o rótulo segue o da ferramenta", () => {
    const { e, c } = cenario({ mudoDesde: AGORA - 10 * MIN, aberta: null, emFundo: 0, repeticao: { rotulo: "Terminal", vezes: 10 } });
    const html = corpo(e, c);
    expect(html).toContain("Ainda trabalhando · 10 min");
    expect(html).not.toContain("Repetiu a mesma ação");
    expect(html).not.toContain('data-act="parar-conversa"');
    const so = cenario({ mudoDesde: null, aberta: null, emFundo: 0, repeticao: { rotulo: "Gmail", vezes: 5 } });
    expect(corpo(so.e, so.c)).not.toContain("Repetiu a mesma ação");
    expect(corpo(so.e, so.c)).not.toContain("Ainda trabalhando");
  });

  it("sem ferramenta: o mesmo rótulo do silêncio, sem aviso nem Parar", () => {
    const { e, c } = cenario({ mudoDesde: AGORA - 20 * MIN, aberta: null, emFundo: 0, repeticao: null }, false);
    const html = corpo(e, c);
    expect(html).toContain("Ainda trabalhando · 20 min");
    expect(html).not.toContain('data-parte="vigia"');
    expect(html).not.toContain('data-act="parar-conversa"');
  });
});

describe("um Parar só na tela (NOD-354, revisto no COP-14: o Parar mora só no campo)", () => {
  const MUDO: VigiaDaAtividade = { mudoDesde: AGORA - 12 * MIN, aberta: "Terminal", emFundo: 0, repeticao: null };
  /** Os `parar-conversa` à vista: o do campo (a mesma função que o main.ts usa em atualizarParar) mais os da fala viva. */
  const visiveis = (e: Estado, c: ConversaEstado, campo: { temConteudo?: boolean; ditando?: boolean } = {}) => {
    const trabalhando = pararNoCampoDaTela(e);
    const noCampo = botoesDoCampo({ trabalhando, temConteudo: !!campo.temConteudo, ditando: !!campo.ditando }).parar ? 1 : 0;
    return noCampo + (corpo(e, c).match(/data-act="parar-(?:conversa|sala)"/g) ?? []).length;
  };

  it("conversa própria em silêncio: campo vazio, 1 Parar (o do campo); com texto ou ditado, o campo mostra Enviar e nenhum Parar", () => {
    const { e, c } = cenario(MUDO);
    expect(htmlComposer("x", [], { aprovacao: true, bot: "Ada" })).toContain('data-act="parar-conversa" aria-label="Parar Ada"');
    expect(pararNoCampoDaConversa(e, C)).toBe(true);
    expect(visiveis(e, c)).toBe(1);
    for (const [temConteudo, ditando] of [[true, false], [false, true], [true, true]] as const) expect(visiveis(e, c, { temConteudo, ditando })).toBe(0);
    // Também na repetição sem silêncio.
    const rep = cenario({ mudoDesde: null, aberta: null, emFundo: 0, repeticao: { rotulo: "Gmail", vezes: 5 } });
    expect(visiveis(rep.e, rep.c)).toBe(1);
  });

  it("a tela é outra conversa do bot (não a dele na frota): o campo segue a conversa da tela — segue 1 Parar", () => {
    const { e: base, c } = cenario(MUDO);
    const e: Estado = { ...base, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: "outra", cor: "blue", forma: "square" }] } as never };
    expect(pararNoCampoDaConversa(e, C)).toBe(true);
    expect(visiveis(e, c)).toBe(1);
    // Turno vivo só na conversa do bot na frota: o campo da tela não mostra Parar (o clique pararia a da tela).
    const e2: Estado = { ...e, turnosVivos: { t2: { turnoId: "t2", conversaId: "outra", estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
    expect(pararNoCampoDaConversa(e2, C)).toBe(false);
  });

  it("a tela não é esta conversa (a fala viva renderizada fora da tela dela): a linha do indicador não tem Parar", () => {
    const { e: base, c } = cenario(MUDO);
    const e: Estado = { ...base, tela: { tipo: "conversa", conversaId: "outra", agenteId: "a" } };
    expect(corpo(e, c)).not.toContain('data-act="parar-conversa"');
    expect(corpo(e, c)).toContain("Ainda trabalhando · 12 min");
  });

  it("bot desconhecido na frota (conversa sem o bot): segue 1 Parar, o do campo", () => {
    const { e: base, c } = cenario(MUDO);
    const e: Estado = { ...base, frota: { agentes: [] } as never };
    expect(visiveis(e, c)).toBe(1);
  });

  it("sala: a linha do indicador não tem Parar (o da sala fica no cabeçalho dela)", () => {
    const { e: base, c: c0 } = cenario(MUDO);
    const c: ConversaEstado = { ...c0, conversa: { ...c0.conversa, salaId: "s1", agenteId: null } as never };
    const e: Estado = { ...base, conversas: { ...base.conversas, [C]: c }, tela: { tipo: "sala", salaId: "s1", conversaId: C } as never };
    const html = corpo(e, c);
    expect(html).not.toContain('data-act="parar-sala"');
    expect(html).not.toContain('data-act="parar-conversa"');
  });

  it("fim do turno: sem turno vivo, o campo não mostra o Parar; fora da conversa, nunca", () => {
    const { e } = cenario(MUDO);
    expect(pararNoCampoDaTela({ ...e, turnosVivos: {} })).toBe(false);
    expect(pararNoCampoDaTela({ ...e, tela: { tipo: "inicio" } as never })).toBe(false);
  });
});

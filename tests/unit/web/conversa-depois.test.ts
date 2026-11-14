import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comFimDaAcao, comTexto, comVigia } from "../../../web/lib/atividade.ts";
import { blocosAoVivo, blocosDoHistorico, renderCabecalhoConversa, renderMensagem, renderResumoDasAcoes, renderTimeline, tomarTrocaDoIndicador } from "../../../web/telas/conversa.ts";
import { renderCardArtefato } from "../../../web/telas/card-artefato.ts";
import { renderTopoComposer } from "../../../web/telas/pergunta.ts";
import { acaoHumana, previaDoItem } from "../../../web/telas/sua-vez.ts";

/** O canvas "Uma conversa de verdade · depois" (2026-10-03), item a item. */

const C = "c1";
const AGORA = Date.parse("2026-10-03T14:45:00Z");
const msg = (id: string, autor: "pessoa" | "agente", criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, ...extra,
} as Mensagem);

const itemAprovacao = (id: string, argumentos: Record<string, unknown> = {}): SuaVezDto["itens"][number]["itensAprovacao"][number] => ({
  tenantId: "t", id, decisaoId: "d", idx: 0, textoOriginal: "Atualizar metas", textoFinal: "Atualizar metas", destino: { conector: "googlesheets", ferramenta: "update_values", argumentos },
  selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null,
});

const pedido = (id: string, extra: { turnoId?: string | null; criadoEm?: string; tipo?: "aprovacao" | "pergunta"; itens?: ReturnType<typeof itemAprovacao>[] } = {}): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: C, turnoId: extra.turnoId ?? null, tipo: extra.tipo ?? "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-04T14:00:00Z", prazoExecucaoEm: null, frase: "Atualizar a planilha de metas com a receita de setembro", desfecho: null, vistaEm: null, criadoEm: extra.criadoEm ?? "2026-10-03T14:40:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: 5 * 60_000, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], itensAprovacao: extra.itens ?? [itemAprovacao(`${id}-i`)], proposta: null, fio: null, rotinaParada: null,
});

const SHEETS = { slug: "googlesheets", nome: "Google Sheets", habilitado: true, ownerId: "p", catalogo: [{ nome: "update_values", descricao: "", schema: {}, readOnlyHint: false, grupo: "alterar" as const }] };

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = [], extra: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...extra,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never,
    conectores: [SHEETS] as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

/** As falas paradas de um turno na conversa (a chave é por fala, revisão 4 do #508). */
const paradas = (e: Estado, turnoId: string) => Object.values(e.falasSaindo?.[C] ?? {}).filter((s) => s.turno.turnoId === turnoId);

describe("1. o balão de quem escreve", () => {
  it("continua .message.you (o azul mora no CSS) e o chip de comando fica dentro do balão", () => {
    const html = renderMensagem(msg("m1", "pessoa", 1, { texto: "/uso agora" }), cenario([]).e);
    expect(html).toContain('class="message you');
    expect(html).toContain('class="chip-comando"');
  });
});

describe("2. a parte ao vivo é o indicador da Ada (COP-14, item 2)", () => {
  /**
   * O rótulo fica ≥ 800 ms na tela, guardado por turno (permanência): cada caso tem o seu turno, para o rótulo de um não
   * segurar o do outro; dentro do caso, o estado novo do mesmo turno chega com o relógio adiantado em `PASSOU`.
   */
  let T = "tc0";
  let casos = 0;
  beforeEach(() => { T = `tc${++casos}`; });
  const PASSOU = 800;
  /** O turno rodando da Ada, com a atividade dada. */
  const rodando = (base: Estado, a?: ReturnType<typeof comTexto>, desde = AGORA - 60_000, extra: Record<string, unknown> = {}): Estado => ({
    ...base, turnosVivos: { [T]: { turnoId: T, conversaId: C, estado: "rodando", executor: "catcher", machineId: null, desde, ...extra } as never }, atividades: a ? { [C]: { [T]: a } } : {},
  });
  /** O turno.encerrado da Ada. */
  const encerrar = (e: Estado): Estado => reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });

  it("com ferramenta: uma linha só, o personagem de 28 e o verbo da ferramenta; sem nome, pensamento, narração nem balão", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const atividade = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Lendo o PR https://github.com/acme/loja/pull/481."), "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const e = rodando(base, atividade);
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual([`vivo:${T}`]);
    const html = blocos[0]!.html;
    // A cor do bot (a classe c-* do perfil; "blue" na frota de teste) segue na raiz; o aria-live anuncia o rótulo.
    expect(html).toMatch(/^<article class="message bot fala-viva ao-vivo indicador blue" data-turno="tc\d+" data-morfar aria-live="polite" aria-label="Ada está usando GitHub"><nod-mascote [^>]*\bsm\b[^>]*data-parte="mascote"/);
    expect(html).toContain('state="orbit"');
    expect(html).toContain(`data-turno="${T}"`);
    expect(html).toContain('<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado brilho" data-chave="ferramenta-Usando-GitHub">Usando GitHub</span></span>');
    // Sem o nome da IA, sem nome do bot, sem a narração, sem pensamento e sem balão.
    for (const fora of ["catcher", "Claude", "msg-autor", "Lendo o PR", "fala-narracao", 'class="pensar"', "data-desde"]) expect(html).not.toContain(fora);
    expect(html).not.toMatch(/class="bubble[ "]/);
    expect(blocos[0]!.morfar!.partes.map((p) => p.chave)).toEqual(["rotulo"]);
    // O HTML não muda quando o tempo anda (sem vigia).
    expect(blocosAoVivo(c, { ...e, agora: AGORA + 120_000 })[0]!.html).toBe(html);
    expect(blocos[0]!.morfar?.mascote).toMatchObject({ state: "orbit", "data-estado": "trabalhando", "aria-label": "Ada está usando GitHub" });
    // Texto chegando depois da ferramenta: "Digitando…", cinza fixo (sem brilho), e o texto não aparece.
    const narrando = blocosAoVivo(c, { ...e, agora: AGORA + 120_000 + PASSOU, atividades: { [C]: { [T]: { ...atividade, atual: "Abrindo https://github.com/acme/loja/pull/481 agora" } } } })[0]!;
    expect(narrando.html).toContain('<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado" data-chave="digitando">Digitando…</span></span>');
    expect(narrando.html).toContain('aria-label="Ada está digitando"');
    expect(narrando.html).not.toContain("Abrindo https://");
    expect(narrando.morfar?.partes.map((p) => p.chave)).toEqual(["rotulo"]);
  });

  it("cada rótulo fica no mínimo 800 ms: o novo que chega antes espera, e o render diz quando ele pode entrar", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const usando = comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const em = (a: ReturnType<typeof comTexto>, agora: number) => blocosAoVivo(c, { ...rodando(base, a), agora })[0]!;
    tomarTrocaDoIndicador();
    expect(em(usando, AGORA).html).toContain('<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado brilho" data-chave="ferramenta-Usando-GitHub">Usando GitHub</span></span>');
    expect(tomarTrocaDoIndicador()).toBeNull();
    // 500 ms depois o texto chega: o rótulo antigo fica, e a troca fica marcada para os 800 ms da entrada dele.
    const cedo = em(comTexto(usando, "Fechei o PR."), AGORA + 500);
    expect(cedo.html).toContain('<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado brilho" data-chave="ferramenta-Usando-GitHub">Usando GitHub</span></span>');
    expect(cedo.html).not.toContain(">Digitando…</span>");
    expect(cedo.html).not.toContain("data-estado-pendente");
    expect(cedo.morfar!.mascote).toMatchObject({ "aria-label": "Ada está usando GitHub" });
    expect(tomarTrocaDoIndicador()).toBe(AGORA + PASSOU);
    // Aos 799 ms ainda espera; aos 800 ms o novo entra, com outra `data-chave` (o rótulo é refeito e sobe).
    expect(em(comTexto(usando, "Fechei o PR."), AGORA + 799).html).toContain(">Usando GitHub</span>");
    const depois = em(comTexto(usando, "Fechei o PR."), AGORA + PASSOU);
    expect(depois.html).toContain('<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado" data-chave="digitando">Digitando…</span></span>');
    tomarTrocaDoIndicador();
    // A troca rápida não pisca: a ferramenta seguinte, 300 ms depois, espera de novo (contada desde a entrada do "Digitando…").
    const outra = em(comFerramenta(ATIVIDADE_VAZIA, "Consultou Linear", { texto: "Usando Linear", frentes: false }), AGORA + PASSOU + 300);
    expect(outra.html).toContain(">Digitando…</span>");
    expect(tomarTrocaDoIndicador()).toBe(AGORA + PASSOU + PASSOU);
  });

  it("revisão do #508: o nome do bot com $&, $` e $' não abre atributo no mascote (replace com função)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    for (const nome of ['Ada$&" onmouseover="x', "Ada$`", "Ada$'"]) {
      const e: Estado = { ...base, frota: { agentes: [{ id: "a", nome, cor: "blue", forma: "square", conversaId: C }] } as never, turnosVivos: { [T]: { turnoId: T, conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
      const mascote = /<nod-mascote [^>]*>/.exec(blocosAoVivo(c, e)[0]!.html)![0];
      expect(mascote).not.toMatch(/ onmouseover="/);
      expect(mascote.match(/ aria-label="/g)).toHaveLength(1);
      expect(mascote.match(/ title="/g)).toHaveLength(1);
      // Cada atributo do mascote aparece uma vez só: nada foi aberto pelo nome.
      const nomes = [...mascote.matchAll(/ ([\w-]+)=("[^"]*")/g)].map((m) => m[1]);
      expect(new Set(nomes).size).toBe(nomes.length);
    }
  });

  it("revisão do #508: cada data-parte do HTML é uma parte do morph, na mesma ordem (senão o morph cai na recriação)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const mudo = comVigia(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), { mudoDesde: AGORA - 4 * 60_000, aberta: null, emFundo: 0, repeticao: null });
    for (const [i, a] of [undefined, comTexto(ATIVIDADE_VAZIA, "Olá"), mudo].entries()) {
      const b = blocosAoVivo(c, { ...rodando(base, a, AGORA - 5 * 60_000), agora: AGORA + i * PASSOU })[0]!;
      const noWrap = b.html.slice(b.html.indexOf('<div class="bubble-wrap">'));
      const filhas = [...noWrap.matchAll(/<(?:div|details|span)[^>]* data-parte="([^"]+)"/g)].map((m) => m[1]);
      expect(filhas).toEqual(b.morfar!.partes.map((p) => p.chave));
      for (const p of b.morfar!.partes) expect(noWrap).toContain(p.html);
    }
  });

  it("sem novidade há mais de 2 min: o rótulo segue o verbo da ferramenta (o silêncio não muda o rótulo), sem o aviso do vigia", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const mudo = comVigia(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), { mudoDesde: AGORA - 4 * 60_000, aberta: null, emFundo: 0, repeticao: null });
    const e = rodando(base, mudo, AGORA - 5 * 60_000);
    const b = blocosAoVivo(c, e)[0]!;
    expect(b.html).toContain('>Usando GitHub</span></span>');
    expect(b.html).toContain('aria-label="Ada está usando GitHub"');
    expect(b.morfar!.partes.map((p) => p.chave)).toEqual(["rotulo"]);
    for (const fora of ["Ainda trabalhando", "Sem novidade", "vigia", "parar-conversa"]) expect(b.html).not.toContain(fora);
    // Sem o silêncio, o mesmo rótulo e o mesmo HTML.
    const ativo = blocosAoVivo(c, { ...e, atividades: { [C]: { [T]: { ...mudo, vigia: null } } } })[0]!;
    expect(ativo.html).toBe(b.html);
    expect(ativo.morfar!.mascote).toMatchObject({ state: "orbit", "data-estado": "trabalhando" });
  });

  it("sem ferramenta e sem texto: 'Trabalhando' (5 variantes, 5 s) antes de tudo; depois de uma ação, 'Refletindo' (3 variantes, 2,5 s)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const comeco = blocosAoVivo(c, rodando(base, undefined, AGORA))[0]!;
    expect(comeco.html).toContain(`<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado brilho" data-chave="trabalhando" data-variantes="Trabalhando|Cuidando disso|Organizando|Seguindo com isso|Ainda nisso" data-periodo="5000" data-variantes-desde="${AGORA}">Trabalhando</span></span>`);
    expect(comeco.morfar!.mascote).toMatchObject({ state: "orbit", "data-estado": "trabalhando", "aria-label": "Ada está trabalhando" });
    expect(comeco.html).not.toContain("Cuidando disso<");
    // A variante da vez conta desde que o rótulo entrou (o relógio da tela troca no lugar; o render já sai com a da vez).
    expect(blocosAoVivo(c, { ...rodando(base, undefined, AGORA), agora: AGORA + 5_000 })[0]!.html).toContain(">Cuidando disso</span>");
    // Já fez uma ação e não está com ferramenta em uso nem texto chegando (ex.: depois de um turno.fala): "Refletindo".
    const fez = { ...comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), emUso: null };
    const depois = blocosAoVivo(c, { ...rodando(base, fez, AGORA), agora: AGORA + 10_000 })[0]!;
    expect(depois.html).toContain(`<span class="indicador-rotulo-lugar" data-parte="rotulo" data-no-lugar><span class="indicador-rotulo fala-viva-estado brilho" data-chave="refletindo" data-variantes="Refletindo|Pensando|Ponderando" data-periodo="2500" data-variantes-desde="${AGORA + 10_000}">Refletindo</span></span>`);
    expect(depois.morfar!.mascote).toMatchObject({ state: "thinking", "data-estado": "pensando", "aria-label": "Ada está refletindo" });
    expect(depois.html).not.toContain("catcher");
  });

  it("sem texto ao vivo: curto, longo ou formatado, nada da resposta aparece durante o turno — só 'Digitando…'", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const longo = `${"Fechei setembro, conta por conta, com os ajustes combinados. ".repeat(6)}\n\n` + "Fechei **setembro**:\n- Sul\n- Norte\n\n| Região | R$ |\n|---|---|\n| Sul | 98 |";
    for (const texto of ["Olhando", longo]) {
      const b = blocosAoVivo(c, rodando(base, comTexto(ATIVIDADE_VAZIA, texto)))[0]!;
      expect(b.morfar!.partes.map((p) => p.chave)).toEqual(["rotulo"]);
      expect(b.html).toContain(">Digitando…</span>");
      for (const fora of ["Olhando", "Fechei", "<strong>", "md-lista", "md-tabela", "com-texto"]) expect(b.html).not.toContain(fora);
      expect(b.html).not.toMatch(/class="bubble[ "]/);
    }
  });

  it("abrindo frentes: 'Abrindo frentes' com o personagem trabalhando", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const b = blocosAoVivo(c, rodando(base, comFerramenta(ATIVIDADE_VAZIA, "Abriu frentes", { texto: "Abrindo frentes", frentes: true }), AGORA))[0]!;
    expect(b.html).toContain(">Abrindo frentes</span>");
    expect(b.morfar!.mascote).toMatchObject({ "data-estado": "trabalhando" });
  });

  it("na sala, o indicador é do bot do turno (agenteId), não do bot da conversa", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const frota = { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }, { id: "g", nome: "Gil", conversaId: "c2", cor: "teal", forma: "shape-hex" }] } as never;
    const html = blocosAoVivo(c, { ...rodando(base, undefined, AGORA, { agenteId: "g" }), frota })[0]!.html;
    expect(html).toContain('aria-label="Gil está trabalhando"');
    expect(html).not.toContain("Ada");
  });

  it("no fim do turno o indicador sai e a resposta entra inteira, num balão só (saindo:), até a releitura trazer a gravada", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const comVivo = rodando(base, comTexto(ATIVIDADE_VAZIA, "Pronto, fechei setembro."), AGORA - 12_000);
    expect(blocosAoVivo(c, comVivo).map((b) => b.chave)).toEqual([`vivo:${T}`]);
    const fim = encerrar(comVivo);
    expect(fim.turnosVivos[T]).toBeUndefined();
    const saindo = blocosAoVivo(fim.conversas[C]!, fim);
    expect(saindo.map((b) => b.chave)).toEqual([`saindo:${T}`]);
    const html = saindo[0]!.html;
    expect(html).toMatch(/^<article class="message bot fala-chegou" data-turno="tc\d+"><div class="bubble-wrap"><span class="sr-only">Mensagem de Ada<\/span><div class="bubble balao-chega">/);
    expect(html).toContain("Pronto, fechei setembro.");
    expect(html.match(/class="bubble[ "]/g)).toHaveLength(1);
    for (const fora of ["indicador", "nod-mascote", "msg-autor", 'class="pensar"', "data-desde"]) expect(html).not.toContain(fora);
    // A releitura (com a fala gravada) tira a fala que saía; e ela também some sozinha se a releitura não vier.
    const relida = reduzir(fim, { tipo: "hidratar-conversa", conversa: { ...(c as unknown as ConversaDto), mensagens: [msg("m1", "pessoa", 1), msg("m2", "agente", 2)] } as ConversaDto, agora: AGORA + 500 });
    expect(relida.falasSaindo?.[C]).toBeUndefined();
    const semAGravada = reduzir(fim, { tipo: "hidratar-conversa", conversa: { ...(c as unknown as ConversaDto), mensagens: [msg("m1", "pessoa", 1), msg("m2", "agente", 2)] } as ConversaDto, agora: AGORA + 500 });
    expect(paradas(semAGravada, "t1")).toHaveLength(1);
    expect(blocosAoVivo(fim.conversas[C]!, { ...fim, agora: AGORA + 15_000 }).map((b) => b.chave)).toEqual(antes.map((b) => b.chave));
    // Revisão 3: a releitura que saiu ANTES do fim (sem a fala gravada) não a tira; o tick a limpa depois de 15 s.
    const velha = reduzir(fim, { tipo: "hidratar-conversa", conversa: c as unknown as ConversaDto, agora: AGORA - 200 });
    expect(paradas(velha, T)).toHaveLength(1);
    // QA 3 / QA do #534: é a gravada, não o instante, que decide; a releitura de OUTRA conversa não tira as desta.
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: c as unknown as ConversaDto, agora: AGORA }), T)).toHaveLength(1);
    const comGravada = { ...(c as unknown as ConversaDto), mensagens: [msg("m1", "pessoa", 1), msg("m2", "agente", 2, { turnoId: T, texto: "Pronto, fechei setembro." })] } as ConversaDto;
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: comGravada, agora: AGORA }), T)).toHaveLength(0);
    const dto = c as unknown as ConversaDto;
    const outra = { ...dto, conversa: { ...dto.conversa, id: "outra-conversa" }, mensagens: [] } as ConversaDto;
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: outra, agora: AGORA + 500 }), T)).toHaveLength(1);
    expect(paradas(reduzir(fim, { tipo: "tick", agora: AGORA + 14_000 }), T)).toHaveLength(1);
    expect(reduzir(fim, { tipo: "tick", agora: AGORA + 15_000 }).falasSaindo).toEqual({});
  });

  it("com ferramenta: durante o turno só 'Digitando…'; no fim, o balão único sem o bloco 'Usou N ferramentas'", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const comVivo = rodando(base, comTexto(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Fechei o PR."), AGORA - 9_000);
    const vivo = blocosAoVivo(c, comVivo)[0]!;
    expect(vivo.morfar!.partes.map((p) => p.chave)).toEqual(["rotulo"]);
    expect(vivo.html).not.toContain("Fechei o PR");
    const parada = blocosAoVivo(encerrar(comVivo).conversas[C]!, encerrar(comVivo))[0]!;
    expect(parada.html).toContain("Fechei o PR.");
    for (const fora of ['class="pensar"', "Usou 1 ferramenta", "Usando GitHub"]) expect(parada.html).not.toContain(fora);
  });

  it("revisão 3 do #508: turno.fala no meio do turno deixa o balão da fala antes do indicador do mesmo turno", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const comVivo = rodando(base, comTexto(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Primeira parte."), AGORA);
    const meio = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });
    const blocos = blocosAoVivo(meio.conversas[C]!, meio);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:${T}:${AGORA}:0`, `vivo:${T}`]);
    expect(blocos[0]!.html).toContain('class="message bot fala-chegou"');
    expect(blocos[0]!.html).toContain("Primeira parte.");
    // Duas mensagens na mesma rodada: o indicador volta a aparecer depois da primeira.
    expect(blocos[1]!.html).toContain("indicador-rotulo");
    expect(blocos[1]!.html).not.toContain("Primeira parte.");
    expect(blocos.map((b) => b.html).join("")).not.toContain('class="pensar"');
  });

  it("QA do #508: sem atividade o indicador fica parado; o interrompido fica (QA do #534); o turno de outro bot não a tira", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: T, conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const frame = (tipo: string, dados: Record<string, unknown>, e: Estado) => reduzir(e, { tipo: "frame", frame: { tipo, dados } as never, agora: AGORA });
    // Chat (polimento, 13/11): sem atividade (o normal sem `turno.delta`), o indicador fica parado até a resposta chegar.
    const semTexto = frame("turno.encerrado", { turnoId: T, conversaId: C }, { ...base, turnosVivos: { [T]: vivo } });
    expect(paradas(semTexto, T)).toHaveLength(1);
    const comVivo: Estado = { ...base, turnosVivos: { [T]: vivo }, atividades: { [C]: { [T]: comTexto(ATIVIDADE_VAZIA, "Olá") } } };
    // QA do #534 (27/10): o Parar também deixa a fala parada até a gravada (parcial) chegar — antes a viva sumia num quadro.
    expect(paradas(frame("turno.interrompido", { turnoId: T, conversaId: C }, comVivo), T)).toHaveLength(1);
    const fim = frame("turno.encerrado", { turnoId: T, conversaId: C }, comVivo);
    expect(paradas(fim, T)).toHaveLength(1);
    // Revisão 3: na sala, o turno de outro bot (que começa ou é interrompido) não tira a fala parada deste.
    expect(paradas(frame("turno.iniciado", { turnoId: "t2", conversaId: C }, fim), T)).toHaveLength(1);
    expect(paradas(frame("turno.interrompido", { turnoId: "t2", conversaId: C }, fim), T)).toHaveLength(1);
  });

  it("QA 2 do #508: só fica parada a fala do turno rodando, da conversa aberta e fora de task (sem texto, o indicador)", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: T, conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const fim = (e: Estado) => reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });
    const com = (t: Record<string, unknown>, a = comTexto(ATIVIDADE_VAZIA, "Olá"), extra: Partial<Estado> = {}): Estado => ({ ...base, turnosVivos: { [T]: { ...vivo, ...t } as never }, atividades: { [C]: { [T]: a } }, ...extra });
    expect(paradas(fim(com({})), T)).toHaveLength(1);
    expect(fim(com({ estado: "na_fila" })).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({ trabalhoId: "w1" })).falasSaindo?.[C]).toBeUndefined();
    // Só espaço em branco é como sem texto: o indicador parado (Chat, polimento de 13/11).
    expect(paradas(fim(com({}, comTexto(ATIVIDADE_VAZIA, "  \n "))), T)).toHaveLength(1);
    expect(fim(com({}, undefined, { conversas: {} })).falasSaindo?.[C]).toBeUndefined();
  });

  it("QA 2 do #508: na sala, o balão da fala parada é do bot do turno, não do bot da conversa", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const frota = { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }, { id: "g", nome: "Gil", conversaId: "c2", cor: "teal", forma: "shape-hex" }] } as never;
    const fim = encerrar({ ...rodando(base, comTexto(ATIVIDADE_VAZIA, "Feito."), AGORA, { agenteId: "g" }), frota });
    const html = blocosAoVivo(fim.conversas[C]!, fim)[0]!.html;
    expect(html).toContain('<span class="sr-only">Mensagem de Gil</span>');
    expect(html).not.toContain("Ada");
  });

  it("a narração curta nunca aparece; no fim o balão traz o texto definitivo, inteiro e num balão só", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const comA = (a: ReturnType<typeof comTexto>, agora = AGORA): Estado => ({ ...rodando(base, a, AGORA), agora });
    const primeira = comTexto(ATIVIDADE_VAZIA, "Vou olhar o PR.");
    const usando = comFerramenta(primeira, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const segunda = comTexto(usando, "Está aprovado.");
    const html = (e: Estado) => blocosAoVivo(c, e)[0]!.html;
    expect(html(comA(primeira))).toContain(">Digitando…</span>");
    expect(html(comA(usando, AGORA + PASSOU))).toContain(">Usando GitHub</span>");
    for (const a of [primeira, usando, segunda]) {
      expect(html(comA(a))).not.toContain("Vou olhar o PR.");
      expect(html(comA(a))).not.toContain("Está aprovado.");
    }
    // No fim, a parada segue a fala gravada (`comporFala`): o texto final entra no balão; a narração curta fica de fora.
    const fim = encerrar(comA(segunda));
    const balao = blocosAoVivo(fim.conversas[C]!, fim)[0]!.html;
    expect(balao).toContain("Está aprovado.");
    expect(balao).not.toContain("Vou olhar o PR.");
    // O relatório longo e o parágrafo final entram juntos, num balão só (saiu a divisão por parágrafo).
    const relatorio = `Relatório: ${"setembro fechou acima da meta. ".repeat(12)}`;
    const longa = comTexto(comFerramenta(comTexto(ATIVIDADE_VAZIA, relatorio), "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Está aprovado.");
    expect(html(comA(longa))).not.toContain("setembro fechou");
    const fimLonga = encerrar(comA(longa));
    const blocos = blocosAoVivo(fimLonga.conversas[C]!, fimLonga);
    expect(blocos).toHaveLength(1);
    expect(blocos[0]!.html.match(/class="bubble[ "]/g)).toHaveLength(1);
    expect(blocos[0]!.html).toContain("setembro fechou acima da meta.");
    expect(blocos[0]!.html).toContain("Está aprovado.");
    expect(blocos[0]!.html).not.toContain("data-balao");
    // O turno.fala no meio leva o texto e a fala viva recomeça sem ele.
    const meio = reduzir(comA(segunda), { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });
    expect(meio.atividades[C]![T]).toMatchObject({ atual: "", antes: [] });
  });

  it("revisão 4 do #508: dois turno.fala antes da releitura ficam os dois, na ordem; o interrompido não os tira", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const frame = (tipo: string, e: Estado, agora: number) => reduzir(e, { tipo: "frame", frame: { tipo, dados: { turnoId: T, conversaId: C } } as never, agora });
    const com = (e: Estado, texto: string): Estado => ({ ...e, atividades: { [C]: { [T]: comTexto(e.atividades[C]?.[T], texto) } } });
    let e = rodando(base, ATIVIDADE_VAZIA, AGORA);
    e = frame("turno.fala", com(e, "Primeira."), AGORA);
    e = frame("turno.fala", com(e, "Segunda."), AGORA + 100);
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:${T}:${AGORA}:0`, `saindo:${T}:${AGORA + 100}:1`, `vivo:${T}`]);
    expect(blocos[0]!.html).toContain("Primeira.");
    expect(blocos[1]!.html).toContain("Segunda.");
    expect(blocos[2]!.html).toContain("indicador-rotulo");
    const parado = frame("turno.interrompido", e, AGORA + 200);
    expect(paradas(parado, T)).toHaveLength(2);
    // Sem indicador, os dois balões ficam, cada um com a sua chave de fala parada.
    const depois = blocosAoVivo(c, parado);
    expect(depois.map((b) => b.chave).every((k) => k.startsWith("saindo:"))).toBe(true);
    expect(depois.map((b) => b.html).join("")).not.toContain("indicador");
  });

  it("revisão 4 do #508: o balão do turno que acabou vem antes dos indicadores vivos (sala, turno novo)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = (turnoId: string) => ({ turnoId, conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA });
    const e: Estado = { ...base, turnosVivos: { [T]: vivo(T), t2: vivo("t2") }, atividades: { [C]: { [T]: comTexto(ATIVIDADE_VAZIA, "Feito."), t2: ATIVIDADE_VAZIA } } };
    expect(blocosAoVivo(c, e).map((b) => b.chave)).toEqual([`vivo:${T}`, "vivo:t2"]);
    const fim = encerrar(e);
    const blocos = blocosAoVivo(fim.conversas[C]!, fim);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:${T}`, "vivo:t2"]);
    expect(blocos[0]!.html).toContain('<div class="bubble balao-chega">');
    expect(blocos[0]!.html).toContain("Feito.");
  });

  it("COP-14 (item 1): na fila, nenhuma linha 'na fila', nenhum indicador e nada do nome da IA", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { [T]: { turnoId: T, conversaId: C, estado: "na_fila", executor: "claude", machineId: null, desde: AGORA - 120_000 } } };
    const html = blocosAoVivo(c, e).map((b) => b.html).join("");
    for (const fora of ["na fila", "msg-sistema", "claude", "fala-viva", "indicador"]) expect(html).not.toContain(fora);
  });
});

describe("3. o pedido fica junto do turno que o pediu", () => {
  it("logo depois da última fala do turno; as mensagens seguintes vêm depois dele, e a seção do fim some", () => {
    const mensagens = [msg("m1", "pessoa", 1), msg("m2", "agente", 2, { turnoId: "t1" }), msg("m3", "pessoa", 3), msg("m4", "agente", 4, { turnoId: "t2" })];
    const { e, c } = cenario(mensagens, [pedido("d1", { turnoId: "t1" })]);
    const chaves = blocosDoHistorico(c, e).map((b) => b.chave);
    expect(chaves).toEqual(["sep:m1", "m1", "m2", "decisao:d1", "m3", "m4"]);
    expect(renderTimeline(c, e)).not.toContain("Preciso da sua decisão para continuar");
  });

  it("sem turno, fica depois da última mensagem anterior ao pedido; sem mensagem nenhuma, na seção do fim", () => {
    // COP-14: a pausa que abre divisor é de 15 min; as duas falas ficam a 10 min, no mesmo bloco, com o pedido no meio.
    const mensagens = [msg("m1", "pessoa", Date.parse("2026-10-03T14:35:00Z")), msg("m2", "agente", Date.parse("2026-10-03T14:45:00Z"))];
    const { e, c } = cenario(mensagens, [pedido("d1")]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "decisao:d1", "m2"]);
    const vazio = cenario([], [pedido("d1")]);
    expect(renderTimeline(vazio.c, vazio.e)).toContain('<section class="decisoes-chat"');
  });

  // definido em 2026-10-07 (#191, chat limpo): o pedido de uma execução de rotina que virou linha fica logo depois da
  // linha (a chave do bloco é `linha:<primeira mensagem>`), e não volta para depois da fala anterior.
  it("o pedido de uma rotina recolhida numa linha fica depois da linha", () => {
    const rotina = (id: string, criadoEm: number) => msg(id, "agente", criadoEm, { turnoId: "tr1", origemTurno: "rotina", trabalhoId: "tb-r1", fimDoTurno: true });
    const mensagens = [msg("m1", "pessoa", 1, { origemTurno: null, trabalhoId: null, fimDoTurno: false }), rotina("r1", 2), msg("m3", "pessoa", 3, { origemTurno: null, trabalhoId: null, fimDoTurno: false })];
    const { e, c } = cenario(mensagens, [pedido("d1", { turnoId: "tr1" })]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "linha:r1", "decisao:d1", "m3"]);
  });

  it("com o turno ainda rodando, fica embaixo da mensagem que o disparou", () => {
    const { e, c } = cenario([msg("m1", "pessoa", 1), msg("m2", "pessoa", 2)], [pedido("d1", { turnoId: "t9" })], { turnosEmCurso: [{ id: "t9", estado: "despachando", desde: 1, mensagemId: "m1" }] as never });
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "decisao:d1", "m2"]);
  });
});

describe("4–6. o card da aprovação de um item", () => {
  it("quem pede, ONDE como chip, a prévia em tabela, Pode fazer e o prazo no rodapé; sem a tag de lista", () => {
    const valores = [["Sudeste", "R$ 210 mil"], ["Sul", "R$ 98 mil"], ["Total", "R$ 482 mil"]];
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1", itens: [itemAprovacao("i1", { spreadsheetId: "abc", range: "Setembro!A1", values: valores })] })]);
    const html = renderTimeline(c, e);
    // Tela 06 do Paper: o topo com o mascote e a frase da decisão; a pergunta em negrito; onde, numa linha; o prazo no Esc.
    expect(html).toContain('<span class="aprov-av"><nod-mascote');
    expect(html).toContain('<span class="aprov-quem">Atualizar a planilha de metas com a receita de setembro</span>');
    expect(html).toContain("pedido há 5 min");
    expect(html).toContain('<p class="aprov-onde">No Google Sheets</p>');
    expect(html).toContain("O que vai ser enviado");
    expect(html).toContain("<td>R$ 482 mil</td>");
    expect(html).toContain("Sem resposta, recusa automática em 23h");
    expect(html).toContain('data-act="decidir-aprovacao"');
    expect(html).not.toContain("aprovação em lista");
    // 6: o botão diz a ação em português; o slug continua no "Ver detalhes".
    expect(html).toContain(">Sempre permitir editar no Google Sheets<");
    expect(html).toContain("<dd>googlesheets.update_values</dd>");
    // main.ts lê o texto final e o data-decisao.
    expect(html).toContain('data-item-texto="i1"');
    expect(html).toContain('data-decisao="d1"');
  });

  it("NOD-443 (revisão 7 do PR #628, achado 4): o cartão do turno a pedido de quem participa do quadro diz de quem é o pedido", () => {
    const comPedido = { ...pedido("d1", { turnoId: "t1" }), aPedidoDe: "Ana <b>" };
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [comPedido]);
    const html = renderTimeline(c, e);
    expect(html).toContain("</span><span class=\"aprov-pedido-de\">· a pedido de Ana &lt;b&gt;</span>");
    // O pedido da própria dona não ganha a linha.
    const daDona = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1" })]);
    expect(renderTimeline(daDona.c, daDona.e)).not.toContain("a pedido de");
  });

  it("5. vencido com um item só diz 'aprovação', nunca 'aprovação em lista'", () => {
    const vencido = { ...pedido("d1"), estadoColuna: "vencido" as const, decisao: { ...pedido("d1").decisao, estado: "vencida" as const } };
    const { e, c } = cenario([], [vencido]);
    const html = renderTimeline(c, e);
    expect(html).toContain(">aprovação<");
    expect(html).not.toContain("aprovação em lista");
  });

  it("a prévia: campos de texto viram linhas rotuladas; objetos ficam só no 'Ver detalhes'", () => {
    const html = previaDoItem({ destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas", text: "Fechamos <setembro>", blocks: [{ a: 1 }] } } });
    expect(html).toContain("<dt>channel</dt><dd>#vendas</dd>");
    expect(html).toContain("Fechamos &lt;setembro&gt;");
    expect(html).not.toContain("blocks");
    expect(previaDoItem({ destino: { conector: "x", ferramenta: "y", argumentos: {} } })).toBe("");
  });

  it("a ação em português vem do grupo do catálogo; sem catálogo, o nome da ferramenta sem sublinhados", () => {
    expect(acaoHumana([SHEETS] as never, "googlesheets", "update_values")).toBe("editar no Google Sheets");
    expect(acaoHumana([], "slack", "send_message")).toBe("send message no slack");
  });
});

describe("revisão de 2026-10-03: o card da lista, o artefato e os recibos", () => {
  it("aprovação com vários itens usa o mesmo card: quem pede, o app uma vez só, linhas marcáveis e o prazo", () => {
    const slack = (id: string, texto: string) => ({ ...itemAprovacao(id), textoFinal: texto, destino: { conector: "slack", ferramenta: "send_message", argumentos: {} } });
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1", itens: [slack("i1", "Avisar o comercial"), slack("i2", "Parabenizar o Sudeste")] })]);
    const html = renderTimeline(c, e);
    expect(html).toContain("aprov-card");
    expect(html).toContain('<span class="aprov-quem">');
    expect(html).toContain('class="aprov-itens"');
    expect(html.match(/data-item="i[12]"/g)).toHaveLength(2);
    expect(html).not.toContain("no slack</small>");
    expect(html).toContain("Sem resposta, recusa automática em 23h");
    expect(html).not.toContain("aprovação em lista");
  });

  it("o artefato vem com o mascote, o nome e a hora do bot", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("m1", "agente", 1, { kind: "artefato", payload: { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" } as never }), e);
    expect(html).toContain('class="message bot com-artefato"');
    expect(html).toContain('<b title="Ada">Ada</b>');
    expect(html).toContain('data-artefato="art"');
  });

  it("resultado da aprovação vira o cartão encolhido (chat limpo, PR 4): o pedido e o resultado; o detalhe por item fica recolhido", () => {
    const { e } = cenario([]);
    const resultado = (itens: { idx: number; desfecho: string; texto?: string }[], frase = "Atualizar a planilha de metas") => renderMensagem(msg("r", "pessoa", Date.parse("2026-10-03T14:44:00Z"), { kind: "resultado_aprovacao", texto: "Marlon aprovou 0 de 1; não enviado: … (falhou na execução).", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase, itens } as never }), e);
    const falhou = resultado([{ idx: 0, desfecho: "falhou_na_execucao", texto: "Atualizar metas" }]);
    expect(falhou).toContain('class="cp-linha cp-falha cartao-encolhido"');
    expect(falhou).toContain('tabindex="-1">Atualizar a planilha de metas</span>');
    expect(falhou).toContain('<span class="ce-resultado">Aprovado · não saiu</span><span class="sr-only"> (não saiu)</span>');
    expect(falhou).toContain('<span class="ce-link">detalhes</span></summary>');
    expect(falhou).toContain("falhou ao executar");
    const feito = resultado([{ idx: 0, desfecho: "executado", texto: "Atualizar metas" }]);
    expect(feito).toMatch(/class="cp-linha cp-ok cartao-encolhido"[^>]*><svg class="cp-ic"[^]*?<span class="ce-resultado">Permitido uma vez<\/span>/);
    expect(feito).not.toContain("<details");
    const varios = resultado([{ idx: 0, desfecho: "executado", texto: "a" }, { idx: 1, desfecho: "retirado_pela_pessoa", texto: "b" }, { idx: 2, desfecho: "executado", texto: "c" }]);
    expect(varios).toContain(">Permitido · 2 de 3 feitas<");
    expect(varios).toContain("você tirou");
    const parcial = resultado([{ idx: 0, desfecho: "executado", texto: "a" }, { idx: 1, desfecho: "falhou_na_execucao", texto: "b" }, { idx: 2, desfecho: "executado", texto: "c" }]);
    expect(parcial).toContain(">Aprovado · 1 de 3 não saiu<");
    const recusado = resultado([{ idx: 0, desfecho: "retirado_pela_pessoa", texto: "a" }, { idx: 1, desfecho: "retirado_pela_pessoa", texto: "b" }], "Posso mandar estes 2 avisos?");
    expect(recusado).toContain('tabindex="-1">Posso mandar estes 2 avisos?</span>');
    expect(recusado).toContain('class="cp-linha cp-recusado cartao-encolhido"');
    expect(recusado).toContain('<span class="ce-resultado">Negado</span>');
    expect(recusado).not.toContain("<details");
  });

  it("'permitiu para sempre' antigo (sem payload) continua a linha 'Regra nova · sempre permitir editar no Google Sheets'", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("r", "pessoa", 1, { kind: "consentimento", texto: "Marlon permitiu para sempre: googlesheets.update_values. Vale já, para qualquer destino destas ferramentas, enquanto o bot não tiver lido conteúdo de fora na tarefa." }), e);
    expect(html).toContain("<b>Regra nova</b> · sempre permitir editar no Google Sheets");
    expect(html).toContain('class="recibo recibo-regra"');
    expect(html).not.toContain("cartao-encolhido");
  });

  it("a regra nova com payload (regra_permanente) encolhe como a tela 06 do Paper: 'Permitido sempre: editar no Google Sheets', com o registro", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("r", "pessoa", 1, { kind: "consentimento", texto: "Marlon permitiu para sempre: googlesheets.update_values. Vale já…", payload: { kind: "regra_permanente", decisaoId: "d1", turnoId: "t1", acoes: ["googlesheets.update_values"] } }), e);
    expect(html).toContain('data-cartao-encolhido="d1"');
    expect(html).toContain('tabindex="-1">editar no Google Sheets</span>');
    expect(html).toContain('class="cp-linha cp-regra cartao-encolhido"');
    expect(html).toContain('<span class="ce-resultado">Permitido sempre:</span>');
    expect(html).toContain('<span class="ce-link">Ver registro de autorização</span></summary>');
    expect(html).toContain('data-anuncio="Permitido sempre: editar no Google Sheets"');
  });
});

describe("7. a linha da memória", () => {
  it("'Anotei uma preferência' com 'Ver na memória'; a linha antiga, sem acento, é lida na frase nova", () => {
    const { e } = cenario([]);
    const nova = renderMensagem(msg("m1", "agente", 1, { kind: "sistema", texto: "Anotei uma preferência: relatórios em reais" }), e);
    expect(nova).toContain("Anotei uma preferência: relatórios em reais");
    expect(nova).toContain('data-act="ir-memoria" data-id="a"');
    const antiga = renderMensagem(msg("m2", "agente", 1, { kind: "sistema", texto: "Anotei como preferencia: sem centavos" }), e);
    expect(antiga).toContain("Anotei uma preferência: sem centavos");
    expect(antiga).not.toContain("como preferencia");
  });
});

describe("8. o cabeçalho com uma regra só", () => {
  it("a aprovação troca o estado mesmo durante o turno; sem turno, os pedidos seguem aguardando", () => {
    const { e } = cenario([], [pedido("d1"), pedido("d2")]);
    const vivo: Estado = { ...e, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
    expect(renderCabecalhoConversa(vivo, "a")).toContain(">Aguardando sua aprovação<");
    expect(renderCabecalhoConversa(e, "a")).toContain(">Aguardando sua aprovação<");
  });
});

describe("9. nada de 'N coisas esperam você' acima do campo (Paper, rodada 2: a faixa repetia os cartões)", () => {
  it("com pergunta e outros pedidos, o topo do campo não lista os pedidos: cada um está no seu cartão", () => {
    const pergunta = { ...pedido("q1", { tipo: "pergunta", criadoEm: "2026-10-03T14:30:00Z", itens: [] }), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const, frase: "Posso mandar o painel?", criadoEm: "2026-10-03T14:30:00Z" } };
    const gate = { ...pedido("g1"), decisao: { ...pedido("g1").decisao, tipo: "gate_rotina" as const } };
    const { e } = cenario([], [pergunta, pedido("d1"), gate]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toBe("");
    expect(html).not.toContain("esperam você");
    expect(html).not.toContain('data-act="ver-decisao"');
  });
});

describe("12. artefato: abrir em nova aba", () => {
  it("o botão vem antes de 'Tela cheia' e 'Baixar .html'", () => {
    const m = msg("m1", "agente", 1, { kind: "artefato" });
    const html = renderCardArtefato(m, { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" }, 1);
    const ordem = ["artefato-nova-aba", "artefato-tela-cheia", "artefato-baixar"].map((a) => html.indexOf(`data-act="${a}"`));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain("Abrir em nova aba");
  });
});

describe("NOD-353: o resumo das ações na fala (viva, parada e gravada)", () => {
  const T = "22222222-2222-4222-8222-222222222222";
  const usa = (a: ReturnType<typeof comTexto> | undefined, rotulo: string, emUso: string, id: string) => comFerramenta(a, rotulo, { texto: emUso, frentes: false }, id);
  const vivoCom = (base: Estado, a: ReturnType<typeof comTexto>): Estado => ({ ...base, turnosVivos: { [T]: { turnoId: T, conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { [T]: a } } });
  const resumoDe = (html: string) => /<details class="pensar"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  it("revisão do #523: payload de ações fora da forma não quebra a fala gravada", () => {
    const ruim = { ...msg("mr", "agente", 9), turnoId: T, payload: { kind: "acoes_do_turno", acoes: "x" } } as unknown as Mensagem;
    expect(() => renderMensagem(ruim, cenario([]).e)).not.toThrow();
    expect(renderMensagem(ruim, cenario([]).e)).not.toContain('class="pensar"');
  });
  it("Parte 2: o pensamento é um <details> fechado por padrão, com o trilho e a faixa definidos no CSS", () => {
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    expect(css).toContain(".pensar > summary {");
    expect(css).toContain(".pensar-meta > span:not(:empty) ~ span:not(:empty)::before { content: \"·\";");
    expect(css).toContain(".pensar-corpo { display: grid; grid-template-rows: 0fr;");
  });

  it("COP-14 (decisão c): o bloco 'Pensou por N s · Usou N ferramentas' saiu da conversa — nem ao vivo, nem na parada, nem na gravada", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    let a = usa(undefined, "Leu um arquivo", "Lendo um arquivo", "r1");
    a = comFimDaAcao(a, "r1", false)!;
    a = usa(a, "Rodou um comando", "Rodando um comando", "b1");
    expect(blocosAoVivo(c, vivoCom(base, a))[0]!.html).not.toContain('class="pensar"');
    a = comFimDaAcao(a, "b1", true)!;
    a = comTexto(a, "Pronto.");
    const fim = reduzir(vivoCom(base, a), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });
    const parada = blocosAoVivo(fim.conversas[C]!, fim)[0]!.html;
    expect(parada).toContain("Pronto.");
    expect(resumoDe(parada)).toBe("");
    const gravada = renderMensagem(msg("m2", "agente", 2, { turnoId: T, texto: "Pronto.", payload: { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo", vezes: 5 }, { rotulo: "Rodou um comando", falhou: true }], duracaoMs: 9_400 } } as Partial<Mensagem>), fim);
    expect(gravada).toContain("Pronto.");
    for (const fora of ['class="pensar"', "Usou", "Pensou por", "pensar-vezes"]) expect(gravada).not.toContain(fora);
    expect(gravada).toContain('<span class="sr-only">Mensagem de Ada</span>');
  });

  it("escapa rótulo e id; nada terminado, nada desenhado", () => {
    expect(renderResumoDasAcoes("t", [{ rotulo: "Rodou um comando", estado: "rodando", emUso: "Rodando" }])).toBe("");
    const html = renderResumoDasAcoes('x"><b>', [{ rotulo: "Consultou <img src=x>", estado: "feita", emUso: null }]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('x"><b>');
    expect(html).toContain("&lt;img");
  });
});

describe("NOD-353 (QA do #523): a frase do resumo não sai cortada e o balão fica do tamanho do texto", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
  it("o recuo do summary não é margem negativa (que tirava 6px da largura pedida e cortava a frase com reticências)", () => {
    const summary = /\.pensar > summary \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(summary).not.toMatch(/margin-left:\s*-/);
    expect(summary).toMatch(/position: relative; left: -6px/);
  });
  it("com o resumo mais largo que a resposta, o balão não estica (a resposta fica igual à de hoje)", () => {
    expect(css).toContain(".bubble-wrap:has(> .pensar) > .bubble { width: fit-content; max-width: 100%; box-sizing: border-box; }");
  });
});

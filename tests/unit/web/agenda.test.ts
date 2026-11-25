import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgendaDto, ItemAgenda, RotinaNaAgenda } from "../../../src/contracts/agenda.ts";
import type { RotinaDto } from "../../../src/contracts/api.ts";
import { AGENDA_INICIAL, AGENDA_UI_INICIAL, agendaPorLer, escNaAgenda, reduzirAgenda, type EstadoAgenda } from "../../../web/estado/agenda.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import {
  diaDe, diaValido, fraseDaUltima, inicioDoDia, janelaDaLista, lerLinkDaAgenda, linhaDaPassagem, montarLista, passagensPorRotina, proximaVez, somarDias, tituloDaRotina,
  type BotDaAgenda,
} from "../../../web/lib/agenda.ts";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";
import { datasDePausa, introDasRotinas, renderAgendaRotinas, valorDaAgenda } from "../../../web/telas/agenda-rotinas.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";

/** Configurações › Rotinas em lista. As datas são do fuso local (o do navegador), por isso tudo sai de `new Date(a, m, d, h, min)`. */
const em = (dia: string, h = 0, min = 0): number => {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(a, m - 1, d, h, min).getTime();
};
const HOJE = "2026-10-29"; // quinta
const AGORA = em(HOJE, 10, 30);
/** A rotina e a leitura no fuso de quem roda o teste: a coluna "Próxima vez" sai no fuso da rotina (PR #333). */
const FUSO_LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone;

const BOTS: BotDaAgenda[] = [
  { id: "b-otto", nome: "Otto", cor: "#3355ff", forma: "shape-circle" } as unknown as BotDaAgenda,
  { id: "b-ada", nome: "Ada", cor: "#ff5533", forma: "shape-circle" } as unknown as BotDaAgenda,
];
const naAgenda = (id: string, agenteId: string, extra: Partial<RotinaNaAgenda> = {}): RotinaNaAgenda => ({
  id, agenteId, conversaId: `c-${agenteId}`, instrucao: `Instrução da ${id}`, resumo: "Todo dia às 09:00", fusoIana: FUSO_LOCAL, estado: "ativa", registroDesde: null, cortado: false, minha: true, ...extra,
});
const exec = (rotinaId: string, dia: string, h: number, desfecho: Extract<ItemAgenda, { tipo: "execucao" }>["desfecho"] = "executou", motivo: string | null = null): ItemAgenda => ({
  tipo: "execucao", rotinaId, dia, instante: em(dia, h), desfecho, motivo, problema: ["falhou", "interrompida", "bloqueada", "nao_rodou"].includes(desfecho), turnoId: null, em: em(dia, h) + 5_000,
});

const janela = janelaDaLista(HOJE);
const dto = (rotinas: RotinaNaAgenda[], itens: ItemAgenda[]): AgendaDto => ({ de: inicioDoDia(janela.de), ate: inicioDoDia(janela.ate), agora: AGORA, fuso: FUSO_LOCAL, rotinas, itens });

const ONTEM = somarDias(HOJE, -1);
const BASE_DTO = dto([naAgenda("r1", "b-otto"), naAgenda("r2", "b-ada")], [exec("r1", ONTEM, 9, "falhou"), exec("r1", HOJE, 9), exec("r2", somarDias(HOJE, -7), 11, "passou_em_branco")]);

const rotinaDto = (id: string, agenteId: string, extra: Record<string, unknown> = {}, rotina: Record<string, unknown> = {}) =>
  ({
    rotina: { id, agenteId, conversaId: `c-${agenteId}`, ownerId: "p", estado: "ativa", instrucao: `Instrução da ${id}`, fusoIana: FUSO_LOCAL, exigeAprovacao: false, gatilho: "horario", ...rotina },
    proximaExecucao: em(HOJE, 14),
    resumo: "Todo dia às 09:00",
    bloqueio: null,
    espera: null,
    ...extra,
  }) as unknown as RotinaDto;

describe("datas da lista", () => {
  it("a janela lê 28 dias para trás até o fim de hoje", () => {
    expect(janela).toEqual({ de: "2026-10-01", ate: "2026-10-30" });
    expect(diaValido("2026-02-30")).toBe(false);
    expect(diaDe(AGORA)).toBe(HOJE);
  });

  it("a próxima vez: minutos quando falta menos de uma hora, depois hoje, amanhã ou a data", () => {
    expect(proximaVez(AGORA + 12 * 60_000, AGORA)).toEqual({ hora: "10:42", quando: "em 12 min" });
    expect(proximaVez(em(HOJE, 17), AGORA)).toEqual({ hora: "17:00", quando: "hoje" });
    expect(proximaVez(em(somarDias(HOJE, 1), 8), AGORA)).toEqual({ hora: "08:00", quando: "amanhã" });
    expect(proximaVez(em("2026-11-02", 9), AGORA)).toEqual({ hora: "09:00", quando: "seg, 2 nov" });
  });

  it("com o fuso da rotina, a hora e o dia saem nele, não no da máquina (PR #333, achado 2)", () => {
    // 25/11 12:00 UTC = 09:00 em São Paulo; agora = 24/11 23:41 em São Paulo (25/11 02:41 UTC).
    const agoraUtc = Date.UTC(2026, 10, 25, 2, 41);
    const proxima = Date.UTC(2026, 10, 25, 12, 0);
    expect(proximaVez(proxima, agoraUtc, "America/Sao_Paulo")).toEqual({ hora: "09:00", quando: "amanhã" });
    expect(proximaVez(proxima, agoraUtc, "UTC")).toEqual({ hora: "12:00", quando: "hoje" });
    expect(proximaVez(agoraUtc + 12 * 60_000, agoraUtc, "America/Sao_Paulo")).toEqual({ hora: "23:53", quando: "em 12 min" });
    expect(proximaVez(proxima, agoraUtc, "Fuso/Inexistente").quando).toBeTruthy();
  });

  it("a última vez em palavras, e a linha de Últimas vezes", () => {
    const ps = passagensPorRotina(BASE_DTO, AGORA).get("r1")!;
    expect(ps.map((p) => p.tom)).toEqual(["ok", "atencao"]);
    expect(fraseDaUltima(ps[0], AGORA)).toBe("rodou hoje às 09:00");
    expect(fraseDaUltima(ps[1], AGORA)).toBe("falhou ontem");
    expect(fraseDaUltima(undefined, AGORA)).toBe("ainda não rodou");
    expect(linhaDaPassagem(ps[1]!, AGORA)).toEqual({ quando: "ontem, 09:00", texto: "Falhou" });
    const branco = passagensPorRotina(BASE_DTO, AGORA).get("r2")![0];
    expect(fraseDaUltima(branco, AGORA)).toBe("qui, 22 out não tinha nada novo");
  });

  it("título curto corta com reticências", () => {
    expect(tituloDaRotina("a".repeat(60))).toHaveLength(48);
    expect(tituloDaRotina("  curto  ")).toBe("curto");
  });
});

describe("montarLista", () => {
  const montar = (rotinas: RotinaDto[], filtro: Partial<Parameters<typeof montarLista>[0]["filtro"]> = {}) =>
    montarLista({ rotinas, dto: BASE_DTO, agentes: BOTS, filtro: { visao: "todas", bots: [], soProblema: false, ...filtro }, pessoaId: "p", agora: AGORA });

  it("parada primeiro, ativas pela próxima vez (webhook no fim), pausadas à parte", () => {
    const parada = rotinaDto("r3", "b-ada", { bloqueio: { motivo: "sem_conexao", app: "Slack", desde: AGORA - 3_600_000, naoRodaram: [], fusoIana: "America/Sao_Paulo", slug: "slack", decisaoId: null, rodaNaHora: false } });
    const tarde = rotinaDto("r1", "b-otto", { proximaExecucao: em(HOJE, 17) });
    const cedo = rotinaDto("r2", "b-ada", { proximaExecucao: em(HOJE, 11) });
    const webhook = rotinaDto("r4", "b-otto", { proximaExecucao: em("9999-01-01") }, { gatilho: "webhook" });
    const pausada = rotinaDto("r5", "b-otto", {}, { estado: "pausada" });
    const l = montar([tarde, webhook, parada, pausada, cedo]);
    expect(l.precisa.map((x) => x.dto.rotina.id)).toEqual(["r3"]);
    expect(l.proximas.map((x) => x.dto.rotina.id)).toEqual(["r2", "r1", "r4"]);
    expect(l.pausadas.map((x) => x.dto.rotina.id)).toEqual(["r5"]);
    expect(l.conta).toEqual({ todas: 5, ativas: 4, pausadas: 1 });
    expect(l.bots.map((b) => b.nome)).toEqual(["Ada", "Otto"]);
  });

  it("as abas, o bot e o link de problema filtram", () => {
    const rs = [rotinaDto("r1", "b-otto"), rotinaDto("r2", "b-ada"), rotinaDto("r5", "b-otto", {}, { estado: "pausada" })];
    expect(montar(rs, { visao: "ativas" }).pausadas).toEqual([]);
    const pausadas = montar(rs, { visao: "pausadas" });
    expect(pausadas.proximas).toEqual([]);
    expect(pausadas.pausadas).toHaveLength(1);
    const ada = montar(rs, { bots: ["b-ada"] });
    expect(ada.proximas.map((x) => x.dto.rotina.id)).toEqual(["r2"]);
    expect(ada.conta.todas).toBe(1);
    // r1 rodou bem por último (hoje às 9); r2 passou em branco: nenhuma com problema.
    expect(montar(rs, { soProblema: true }).conta.todas).toBe(0);
  });

  it("a parada de outra pessoa (equipe) fica nas próximas: só a dona resolve", () => {
    const alheia = rotinaDto("r3", "b-ada", { bloqueio: { motivo: "sem_conexao", app: "Slack", desde: AGORA, naoRodaram: [], fusoIana: "America/Sao_Paulo", slug: "slack", decisaoId: null, rodaNaHora: false } }, { ownerId: "colega" });
    const l = montar([alheia]);
    expect(l.precisa).toEqual([]);
    expect(l.proximas[0]!.minha).toBe(false);
  });
});

describe("o link da agenda no chat", () => {
  it("lê só o formato exato, com dia válido", () => {
    expect(lerLinkDaAgenda("nod:agenda?dia=2026-10-29")).toEqual({ dia: "2026-10-29", soProblema: false });
    expect(lerLinkDaAgenda("nod:agenda?dia=2026-10-29&problema=1")).toEqual({ dia: "2026-10-29", soProblema: true });
    for (const ruim of ["nod:agenda?dia=2026-02-30", "nod:agenda?dia=2026-10-29&x=1", "javascript:alert(1)", "nod:agenda?dia=29/10/2026"]) expect(lerLinkDaAgenda(ruim)).toBeNull();
  });

  it("vira o botão abrir-agenda no texto do bot; o resto não", () => {
    const h = textoFormatado("[Abrir na agenda](nod:agenda?dia=2026-10-29&problema=1)", { agora: new Date(AGORA) });
    expect(h).toContain('data-act="abrir-agenda" data-dia="2026-10-29" data-problema="1"');
    const ruim = textoFormatado('[x](nod:agenda?dia=2026-10-29"onmouseover=1)', { agora: new Date(AGORA) });
    expect(ruim).not.toContain("abrir-agenda");
  });
});

describe("estado da lista", () => {
  const aberto = reduzirAgenda(AGENDA_INICIAL, { tipo: "agenda-abrir", hoje: HOJE });

  it("abrir lê a janela para trás; o link do chat abre com o filtro de problema", () => {
    expect(aberto.janela).toEqual(janela);
    expect(agendaPorLer(aberto)).toBe(true);
    expect(reduzirAgenda(aberto, { tipo: "agenda-abrir", hoje: HOJE, soProblema: true }).ui.soProblema).toBe(true);
  });

  // Revisão 1 do PR #595: reabrir relê (a lida de antes não tem o que rodou desde então).
  it("reabrir relê mesmo com a janela igual", () => {
    const lido = reduzirAgenda(aberto, { tipo: "hidratar-agenda", janela, dto: BASE_DTO });
    expect(agendaPorLer(lido)).toBe(false);
    expect(agendaPorLer(reduzirAgenda(lido, { tipo: "agenda-abrir", hoje: HOJE }))).toBe(true);
  });

  // Revisão 1 do PR #595: as instruções das rotinas (dado pessoal) não passam para a próxima pessoa.
  it("trocar de pessoa limpa a lista; a mesma pessoa mantém", () => {
    const comSessao = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    const comAgenda: Estado = { ...comSessao, agenda: reduzirAgenda(aberto, { tipo: "hidratar-agenda", janela, dto: BASE_DTO }) };
    expect(reduzir(comAgenda, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } }).agenda.dto).not.toBeNull();
    expect(reduzir(comAgenda, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).agenda).toEqual(AGENDA_INICIAL);
  });

  it("a resposta de outra janela é ignorada; a falha não relê sozinha", () => {
    expect(reduzirAgenda(aberto, { tipo: "hidratar-agenda", janela: { ...janela, de: "2026-09-01" }, dto: BASE_DTO }).dto).toBeNull();
    expect(reduzirAgenda(aberto, { tipo: "agenda-falhou", janela: { ...janela, ate: "2026-11-01" } }).erro).toBe(false);
    const falhou = reduzirAgenda(aberto, { tipo: "agenda-falhou", janela });
    expect(agendaPorLer(falhou)).toBe(false);
    expect(agendaPorLer(reduzirAgenda(falhou, { tipo: "agenda-tentar" }))).toBe(true);
  });

  it("escolher um bot troca o filtro e fecha a rotina aberta; null volta a todos", () => {
    const comLinha: EstadoAgenda = { ...aberto, ui: { ...aberto.ui, aberto: "r1" } };
    const um = reduzirAgenda(comLinha, { tipo: "agenda-bot", id: "b-ada" });
    expect(um.ui.bots).toEqual(["b-ada"]);
    expect(um.ui.aberto).toBeNull();
    expect(reduzirAgenda(um, { tipo: "agenda-bot", id: "b-otto" }).ui.bots).toEqual(["b-otto"]);
    expect(reduzirAgenda(um, { tipo: "agenda-bot", id: null }).ui.bots).toEqual([]);
  });

  it("o Esc fecha o menu ou a rotina aberta; sem nada, segue", () => {
    expect(escNaAgenda({ ...AGENDA_UI_INICIAL, aberto: "r1" })).toEqual({ mudanca: { aberto: null, menu: null }, foco: '[data-act="agenda-linha"][data-id="r1"]' });
    expect(escNaAgenda({ ...AGENDA_UI_INICIAL, menu: "r2" })?.foco).toBe('[data-act="agenda-linha"][data-id="r2"]');
    expect(escNaAgenda(AGENDA_UI_INICIAL)).toBeNull();
  });

  it("entrar em Rotinas abre a lista e pede a leitura; Rotinas fica entre Agentes e Aprovações", () => {
    const e = reduzir({ ...estadoInicial, agora: AGORA }, { tipo: "espaco", secao: "rotinas" });
    expect(e.agenda.janela).toEqual(janela);
    expect(invalidacoesDaTela(e)).toContain("agenda");
    const ids = SECOES_ESPACO.map((s) => s.id);
    expect(ids.indexOf("rotinas")).toBe(ids.indexOf("agentes") + 1);
    expect(ids.indexOf("aprovacoes")).toBe(ids.indexOf("rotinas") + 1);
    expect(ids.indexOf("cofre")).toBe(ids.indexOf("aprovacoes") + 1);
    expect(ids.indexOf("feedback")).toBe(ids.length - 1);
  });
});

describe("a tela de Rotinas", () => {
  const frota = { agentes: BOTS.map((b) => ({ ...b, conversaId: `c-${b.id}` })) } as unknown as Estado["frota"];
  const com = (agenda: Partial<Omit<EstadoAgenda, "ui">> & { ui?: Partial<EstadoAgenda["ui"]> }, extra: Partial<Estado> = {}): Estado => {
    const base = reduzirAgenda(AGENDA_INICIAL, { tipo: "agenda-abrir", hoje: HOJE });
    return { ...estadoInicial, agora: AGORA, frota, sessao: { tenantId: "t", pessoaId: "p" }, rotinas: [rotinaDto("r1", "b-otto"), rotinaDto("r2", "b-ada")], ...extra, agenda: { ...base, ...agenda, ui: { ...base.ui, ...agenda.ui } } };
  };
  const SLACK = { motivo: "sem_conexao", app: "Slack", desde: AGORA - 3_600_000, naoRodaram: [], fusoIana: "America/Sao_Paulo", slug: "slack", decisaoId: null, rodaNaHora: false };

  it("carregando, erro e vazio", () => {
    expect(renderAgendaRotinas(com({}))).toContain('class="ag-carregando"');
    const erro = renderAgendaRotinas(com({ erro: true }));
    expect(erro).toContain('role="alert"');
    expect(erro).toContain('data-act="agenda-tentar"');
    const vazio = renderAgendaRotinas(com({ dto: dto([], []) }, { rotinas: [] }));
    expect(vazio).toContain("Nenhuma rotina ainda");
    expect(vazio).not.toContain("ag-filtros");
  });

  it("cabeçalho, abas com a conta, filtro de bot e a coluna da próxima vez", () => {
    const h = renderAgendaRotinas(com({ dto: BASE_DTO }));
    expect(h).toContain("O que seus bots fazem sozinhos, num horário. 2 rotinas de 2 bots.");
    expect(h).toContain('data-act="navegar" data-tela="nova-rotina"');
    expect(h).toMatch(/data-visao="todas" aria-pressed="true">Todas<span class="ag-conta">2</);
    expect(h).toContain("<select data-agenda-bot>");
    expect(h).toContain(">Próxima vez<");
    expect(h).toMatch(/<b>14:00<\/b><small>hoje<\/small>/);
    // O ponto da última vez é a única cor: r1 rodou hoje, r2 passou em branco.
    expect(h).toContain('ag-t-ok" aria-hidden="true"></i><span class="ag-meta-txt">Otto · todo dia às 09:00 · rodou hoje às 09:00');
    expect(h).toContain("ag-t-neutro");
    expect(h).not.toContain("Precisa de você");
    expect(h).not.toContain("ag-regua");
  });

  it("parada vai para Precisa de você, com o botão que resolve", () => {
    const h = renderAgendaRotinas(com({ dto: BASE_DTO }, { rotinas: [rotinaDto("r1", "b-otto", { bloqueio: SLACK }), rotinaDto("r2", "b-ada")] }));
    expect(h.indexOf("Precisa de você")).toBeLessThan(h.indexOf("Próximas"));
    expect(h).toContain("falta conectar o Slack");
    expect(h).toContain('data-act="abrir-conexao"');
  });

  it("a rotina abre na própria linha, com instrução, dados, últimas vezes e ações", () => {
    const h = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { aberto: "r1" } }));
    expect(h).toContain('class="ag-det" id="ag-det-r1"');
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain("<dt>Quando</dt><dd>Todo dia às 09:00</dd>");
    // PR #333 (achado 4): o Excluir está na rotina aberta, com o título para a confirmação.
    expect(h).toMatch(/data-act="excluir-rotina" data-id="r1" data-titulo="Instrução da r1"[^>]*>Excluir</);
    expect(h).toContain("<dt>Antes de agir</dt><dd>Faz sem perguntar</dd>");
    expect(h).toContain("<h4>Últimas vezes</h4>");
    expect(h).toContain('<span class="ag-quando">ontem, 09:00</span><span>Falhou</span>');
    for (const act of ["executar-rotina", "pausar-rotina", "abrir-conversa"]) expect(h).toContain(`data-act="${act}"`);
    expect(h).toContain(">Mudar pela conversa<");
  });

  // Revisão 1 do PR #595: rotina de outra pessoa (equipe) não oferece o que o servidor recusa, nem a conversa dela.
  it("rotina de outra pessoa abre sem ação nenhuma", () => {
    const alheias = [rotinaDto("r1", "b-otto", {}, { ownerId: "colega" })];
    const h = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { aberto: "r1" } }, { rotinas: alheias }));
    expect(h).toContain('class="ag-det"');
    for (const act of ["abrir-conversa", "executar-rotina", "pausar-rotina"]) expect(h).not.toContain(`data-act="${act}"`);
  });

  it("parada e pausada de outra pessoa (equipe) não aparecem com Ativar nem Conectar (revisão 2 do PR 595)", () => {
    const rotinas = [rotinaDto("r1", "b-otto", { bloqueio: SLACK }, { ownerId: "colega" }), rotinaDto("r2", "b-ada", {}, { estado: "pausada", ownerId: "colega" })];
    const e = com({ dto: BASE_DTO, ui: { pausadasAbertas: true } }, { rotinas });
    const h = renderAgendaRotinas(e);
    expect(h).not.toContain('data-act="abrir-conexao"');
    expect(h).not.toContain('data-act="ativar-rotina"');
    expect(valorDaAgenda({ ...e, agenda: { ...e.agenda, dto: null } })).toBe("");
  });

  it("as pausadas ficam recolhidas; abrem com o Ativar e dizem até quando (NOD-412)", () => {
    const pausada = rotinaDto("r2", "b-ada", { retomada: { em: AGORA + 86_400_000, texto: "seg 09:00" } }, { estado: "pausada" });
    const fechado = renderAgendaRotinas(com({ dto: BASE_DTO }, { rotinas: [rotinaDto("r1", "b-otto"), pausada] }));
    expect(fechado).toContain("1 rotina pausada");
    expect(fechado).toContain("Ada. Não roda até você ativar.");
    expect(fechado).not.toContain('data-act="ativar-rotina"');
    const aberto = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { pausadasAbertas: true } }, { rotinas: [rotinaDto("r1", "b-otto"), pausada] }));
    expect(aberto).toContain('data-act="ativar-rotina"');
    expect(aberto).toContain("pausada até seg 09:00");
    const aba = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { visao: "pausadas" } }, { rotinas: [rotinaDto("r1", "b-otto"), pausada] }));
    expect(aba).toContain('data-act="ativar-rotina"');
    expect(aba).not.toContain("Próximas");
  });

  it("a pausa em lote (PR 197) fica no bloco do topo, com Reativar as N, e fora do cartão Pausadas", () => {
    const lote = { id: "lote-1", em: em(HOJE, 9, 36) };
    const rotinas = [
      rotinaDto("r1", "b-otto"),
      rotinaDto("r2", "b-ada", {}, { estado: "pausada", pausaLote: lote }),
      rotinaDto("r3", "b-otto", {}, { estado: "pausada", pausaLote: lote }),
      rotinaDto("r4", "b-ada", {}, { estado: "pausada" }),
    ];
    const h = renderAgendaRotinas(com({ dto: BASE_DTO }, { rotinas }));
    expect(h).toContain('id="ajuste-rotinas-pausadas"');
    expect(h).toContain("2 rotinas pausadas juntas");
    expect(h).toContain("Hoje às 09:36 · de 2 bots.");
    expect(h).toContain('data-act="reativar-lote" data-id="lote-1"');
    expect(h.indexOf("ag-lote")).toBeLessThan(h.indexOf("ag-filtros"));
    expect(h).toContain("1 rotina pausada");
    expect(h).not.toContain('data-act="ativar-rotina"');
    const aberto = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { loteAberto: "lote-1" } }, { rotinas }));
    expect(aberto.match(/data-act="ativar-rotina"/g)).toHaveLength(2);
    expect(aberto).toContain("Esconder");
    const aba = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { visao: "pausadas" } }, { rotinas }));
    expect(aba.match(/class="ag-item ag-pausada"/g)).toHaveLength(3);
  });

  it("mais de 6 ativas: as 6 primeiras e Ver todas", () => {
    const muitas = Array.from({ length: 8 }, (_, i) => rotinaDto(`r${i}`, "b-otto", { proximaExecucao: em(HOJE, 11 + i) }));
    const h = renderAgendaRotinas(com({ dto: BASE_DTO }, { rotinas: muitas }));
    expect(h.match(/data-act="agenda-linha"/g)).toHaveLength(6);
    expect(h).toContain("Mais 2 ativas");
    const todas = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { verTodas: true } }, { rotinas: muitas }));
    expect(todas.match(/data-act="agenda-linha"/g)).toHaveLength(8);
    expect(todas).toContain(">Ver menos<");
  });

  it("filtro que esvazia diz o que filtrou e oferece ver todas", () => {
    const h = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { soProblema: true } }));
    expect(h).toContain("Nenhuma rotina com problema.");
    expect(h).toContain('data-act="agenda-todos"');
    expect(h).toContain('data-act="agenda-so-problema"');
  });

  it("NOD-412: a rotina aberta oferece pausar até amanhã, segunda ou uma data", () => {
    const aberta = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { aberto: "r1" } }));
    // Hoje é quinta 29/10 (no fuso da rotina, São Paulo): amanhã = 30/10, segunda = 02/11.
    expect(aberta).toMatch(/data-act="pausar-rotina"[^>]*data-ate="2026-10-30"[^>]*aria-label="Pausar até amanhã">amanhã</);
    expect(aberta).toMatch(/data-act="pausar-rotina"[^>]*data-ate="2026-11-02"[^>]*aria-label="Pausar até segunda">segunda</);
    expect(aberta).toContain('data-act="pausar-rotina-escolhida"');
    expect(aberta).toContain('type="datetime-local"');
  });

  it("NOD-412: domingo não repete \"segunda\" (amanhã já é segunda)", () => {
    expect(datasDePausa("America/Sao_Paulo", Date.parse("2026-11-01T15:00:00Z")).map((d) => d.ate)).toEqual(["2026-11-02"]);
    expect(datasDePausa("America/Sao_Paulo", Date.parse("2026-11-02T15:00:00Z")).map((d) => d.ate)).toEqual(["2026-11-03", "2026-11-09"]);
  });

  it("celular: folha de baixo ao tocar e menu ao segurar", () => {
    const toque = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { aberto: "r1" } }), true);
    expect(toque).toContain("ag-cel");
    expect(toque).toContain('class="ag-folha" role="dialog" aria-modal="true" tabindex="-1"');
    expect(toque).toContain('data-act="agenda-fechar"');
    expect(toque).toContain('class="ag-folha-pausar"');
    expect(toque).toContain('data-act="pausar-rotina-escolhida"');
    expect(toque).toContain('type="datetime-local"');
    expect(toque).not.toContain('class="ag-det"');
    const menu = renderAgendaRotinas(com({ dto: BASE_DTO, ui: { menu: "r1" } }), true);
    expect(menu).toContain('role="menu"');
    expect(menu.match(/role="menuitem"/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("a frase do topo conta rotinas e bots", () => {
    expect(introDasRotinas(com({}, { rotinas: [] }))).toBe("O que seus bots fazem sozinhos, num horário.");
    expect(introDasRotinas(com({}, { rotinas: [rotinaDto("r1", "b-otto")] }))).toBe("O que seus bots fazem sozinhos, num horário. 1 rotina de 1 bot.");
  });

  it("o valor na lista do celular conta as falhas de ontem e hoje", () => {
    expect(valorDaAgenda(com({}))).toBe("");
    expect(valorDaAgenda(com({ dto: BASE_DTO }))).toBe("1 falha");
    // QA do PR #595 (B6): antes de abrir, as paradas (de GET rotinas) já aparecem.
    expect(valorDaAgenda(com({}, { rotinas: [rotinaDto("r1", "b-otto", { bloqueio: SLACK }), rotinaDto("r2", "b-ada")] }))).toBe("1 parada");
  });

  it("o CSS da lista está ligado antes do mobile.css e usa só tokens", () => {
    const html = readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8");
    expect(html.indexOf("/agenda.css")).toBeGreaterThan(-1);
    expect(html.indexOf("/agenda.css")).toBeLessThan(html.indexOf("/mobile.css"));
    const css = readFileSync(new URL("../../../web/agenda.css", import.meta.url), "utf8");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors");
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

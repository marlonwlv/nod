import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DonoDto, EstadoDoDono } from "../../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { botsDaNovaTarefa, htmlDoMenuDaNovaTarefa, htmlDoMenuDeBots, iconeDaTarefa, origemNaTela, renderTelaTarefas } from "../../../web/telas/tela-tarefas.ts";

/**
 * A tela Tarefas (ADR-187 §8, lote B, passo 5, 2026-11-18; Paper 5a "Por bot", 5b "Por estado" e 4e "onde você clica"):
 * o topo com o segmentado colado no título e o "+ Nova tarefa", os chips Abertas N / Feitas / Todas e "Todos os bots ▾",
 * as duas vistas e o clique que abre a tarefa em tela cheia.
 */

const MIN = 60_000;
const AGORA = new Date(2026, 10, 18, 15, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "lia", conversaId: "c-lia", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 20 * MIN, iniciadoEm: AGORA - 9 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: "t", esperandoComputadorDe: null, ...extra,
});
const estadoDono = (extra: Partial<EstadoDoDono>): EstadoDoDono => ({ agenteId: "lia", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null, ...extra });
const dono = (e: Partial<EstadoDoDono>): DonoDto => ({ estado: estadoDono(e), esperas: [], fila: [] });

const AGENTES = [
  { id: "lia", nome: "Lia", conversaId: "c-lia", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "PM", descricao: "", confirmado: true },
  { id: "davi", nome: "Davi", conversaId: "c-davi", cor: "c-orange", forma: "shape-triangle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
  { id: "teo", nome: "Tito", conversaId: "c-teo", cor: "c-teal", forma: "shape-hex", ownerId: "p", titulo: "Ops", descricao: "", confirmado: true },
  { id: "nod", nome: "Nod", conversaId: "c-nod", cor: "c-black", forma: "shape-circle", ownerId: "p", titulo: "", descricao: "", confirmado: true, papel: "nod" },
  { id: "alheio", nome: "Alheio", conversaId: "c-x", cor: "c-red", forma: "shape-circle", ownerId: "outra", titulo: "", descricao: "", confirmado: true },
];

// Paper 5b: a Lia com uma tarefa que pergunta e um pedido de 12 (8 rodando, 3 prontas); o Davi com uma do Quadro.
const pergunta = trabalho("pr821", { titulo: "PR #821 · Migração 0168", estado: "precisa_de_voce", ultimoPasso: "Posso rodar a migração no banco de teste?", iniciadoEm: AGORA - 6 * MIN, loteId: "lote" });
const doLote = Array.from({ length: 8 }, (_, i) => trabalho(`pr${i}`, { titulo: `PR #80${i}`, loteId: "lote", ultimoPasso: "rodando os testes", criadoEm: AGORA - (19 - i) * MIN }));
const prontas = Array.from({ length: 3 }, (_, i) => trabalho(`ok${i}`, { titulo: `PR #81${i}`, loteId: "lote", estado: "terminado", turnoVivoId: null, terminadoEm: AGORA - (i + 1) * MIN, ultimoPasso: "pronto para merge" }));
const doQuadro = trabalho("fila-email", { agenteId: "davi", conversaId: "c-davi", titulo: "Fila de e-mails com retentativa", origem: "quadro", iniciadoEm: AGORA - 22 * MIN });
const TODOS = [pergunta, ...doLote, ...prontas, doQuadro];

function estadoCom(extra: Partial<Estado> = {}, trabalhos: TrabalhoDto[] = TODOS): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: AGENTES } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null, donos: [dono({ agenteId: "lia", esperandoVoce: 1, frentes: 9, desde: AGORA - 9 * MIN }), dono({ agenteId: "davi", frentes: 1, desde: AGORA - 22 * MIN }), dono({ agenteId: "teo" })] },
    tela: { tipo: "trabalhos" },
    suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null },
    ...extra,
  };
}

describe("o topo (Paper 5a)", () => {
  it("Tarefas, o segmentado colado no título, o espaço e o + Nova tarefa; os chips com o número só em Abertas", () => {
    const html = renderTelaTarefas(estadoCom());
    expect(html).toContain('<header class="tf-cab"><h1>Tarefas</h1><div class="tf-vista" role="group" aria-label="Ver as tarefas">');
    expect(html).toContain('<span class="tf-espaco"></span><button type="button" class="tf-nova" data-act="nova-tarefa" aria-haspopup="menu">+ Nova tarefa</button></header>');
    expect(html).toContain('data-act="mostrar-tarefas" data-id="abertas" aria-pressed="true">Abertas <span class="tf-chip-n">10</span></button>');
    expect(html).toContain('data-id="feitas" aria-pressed="false">Feitas</button>');
    expect(html).toContain('data-id="todas" aria-pressed="false">Todas</button><span class="tf-traco" aria-hidden="true"></span>');
    expect(html).toMatch(/data-act="bots-tarefas" aria-haspopup="menu" aria-pressed="false">Todos os bots<svg/);
    expect(html).toContain('data-vista="por-bot"');
  });

  it("com um bot escolhido, o chip diz o nome e o número de Abertas é o dele", () => {
    const html = renderTelaTarefas(estadoCom(), { tipo: "trabalhos", bot: "davi" });
    expect(html).toMatch(/data-act="bots-tarefas" aria-haspopup="menu" aria-pressed="true">Davi<svg/);
    expect(html).toContain('Abertas <span class="tf-chip-n">1</span>');
  });

  it("sem o dono no servidor, só Por estado (sem o segmentado); sem bot que aceite tarefa, sem o + Nova tarefa", () => {
    const semDono = estadoCom();
    const html = renderTelaTarefas({ ...semDono, trabalhos: { ...semDono.trabalhos!, donos: undefined } });
    expect(html).not.toContain("tf-vista");
    expect(html).toContain('data-vista="por-estado"');
    expect(renderTelaTarefas({ ...semDono, frota: { agentes: AGENTES.filter((a) => a.id === "nod" || a.id === "alheio") } as never })).not.toContain("tf-nova");
  });

  it("o + Nova tarefa escolhe entre os bots da pessoa (o Nod e o bot de outra pessoa ficam de fora)", () => {
    expect(botsDaNovaTarefa(estadoCom()).map((b) => b.nome)).toEqual(["Lia", "Davi", "Tito"]);
    const menu = htmlDoMenuDaNovaTarefa(botsDaNovaTarefa(estadoCom()));
    expect(menu).toContain('<div role="menu" class="menu-aba-corpo" aria-label="Nova tarefa com"><p class="menu-nome">Nova tarefa com</p>');
    expect(menu).toMatch(/<button type="button" role="menuitem" class="tf-menu-item" data-bot="davi"><nod-mascote[^>]*><\/nod-mascote><span class="at-item-titulo">Davi<\/span><\/button>/);
  });

  it("o menu de Todos os bots: Todos e cada bot, o escolhido marcado", () => {
    const menu = htmlDoMenuDeBots(estadoCom(), "davi");
    expect(menu).toContain('data-bot="" aria-checked="false"><span class="at-item-titulo">Todos os bots</span></button>');
    expect(menu).toMatch(/data-bot="davi" aria-checked="true"><nod-mascote[^>]*><\/nod-mascote><span class="at-item-titulo">Davi<\/span><span class="tf-menu-ok">/);
    expect(menu).not.toContain("Nod");
    expect(menu).not.toContain("Alheio");
    expect(htmlDoMenuDeBots(estadoCom(), undefined)).toContain('data-bot="" aria-checked="true"');
  });
});

describe("Por bot (Paper 5a)", () => {
  it("a Lia em Precisa de você (o pedido como título, as contas, o tempo), o Davi em Trabalhando; Livres no fim", () => {
    const html = renderTelaTarefas(estadoCom());
    expect(html).toContain('<h2 class="tf-rotulo">Precisa de você · 1 bot</h2>');
    expect(html).toContain('<h2 class="tf-rotulo">Trabalhando · 1 bot</h2>');
    expect(html).toMatch(/data-agente="lia"[^>]*data-grupo="precisa">[^]*?<span class="tf-contas">1 precisa de você · 8 rodando · 3 prontas<\/span><span class="tf-tempo">há 9 min<\/span>/);
    expect(html).toMatch(/data-agente="davi"[^>]*data-grupo="trabalhando">[^]*?<span class="tf-titulo"[^>]*>Fila de e-mails com retentativa<\/span><span class="tf-contas">1 rodando<\/span><span class="tf-tempo">há 22 min<\/span>/);
    // Livres são todos os bots da frota sem linha (o de outra pessoa também), menos o Nod.
    expect(html).toContain('<p class="tf-livres">Livres: Tito, Alheio</p>');
  });

  it("a Lia aberta: quem pergunta primeiro, três à vista e \"+ N tarefas do mesmo pedido\" (que abre Por estado no bot)", () => {
    const e = reduzir(estadoCom(), { tipo: "bot-trabalhos", agenteId: "lia" });
    const html = renderTelaTarefas(e);
    const aberta = html.slice(html.indexOf('<div class="tf-tarefas-do-bot"'));
    expect(aberta.match(/class="tf-tarefa-bot"/g)).toHaveLength(3);
    expect(aberta).toMatch(/^<div class="tf-tarefas-do-bot" role="group" aria-label="Tarefas de Lia"><div class="tf-trilho"><button type="button" class="tf-tarefa-bot" data-act="abrir-trabalho" data-id="pr821" data-estado="precisa_de_voce"><span class="tf-ic"><svg class="pf-aba-ic pf-precisa"/);
    expect(aberta).toContain('<span class="tf-t-titulo">PR #821 · Migração 0168</span>');
    expect(aberta).toContain('<button type="button" class="tf-mais" data-act="vista-tarefas" data-id="por-estado" data-bot="lia">+ 6 tarefas do mesmo pedido</button>');
    expect(aberta).toContain(">Abrir a conversa com Lia ›</button>");
    // Com Todas, as prontas entram no fim (e o resto do pedido cresce).
    expect(renderTelaTarefas(e, { tipo: "trabalhos", mostrar: "todas" })).toContain("+ 9 tarefas do mesmo pedido");
  });

  it("Feitas: uma seção \"Feitas hoje\" com o bot que terminou algo, a hora da última e as prontas", () => {
    const html = renderTelaTarefas(estadoCom(), { tipo: "trabalhos", mostrar: "feitas" });
    expect(html).not.toContain("Precisa de você ·");
    expect(html).toContain('<h2 class="tf-rotulo">Feitas hoje · 1 bot</h2>');
    expect(html).toMatch(/data-agente="lia"[^>]*data-grupo="feitas">[^]*?<span class="tf-titulo"[^>]*>PR #810<\/span><span class="tf-contas">3 prontas<\/span><span class="tf-tempo">14:59<\/span>/);
    expect(html).not.toContain("tf-livres");
  });

  it("um bot escolhido: só ele, sem Livres; sem nada, a frase do vazio", () => {
    const html = renderTelaTarefas(estadoCom(), { tipo: "trabalhos", bot: "davi" });
    expect(html).not.toContain('data-agente="lia"');
    expect(html).toContain('data-agente="davi"');
    expect(html).not.toContain("tf-livres");
    expect(renderTelaTarefas(estadoCom(), { tipo: "trabalhos", bot: "teo" })).toContain("Este bot não está com nada agora.");
  });
});

describe("Por estado (Paper 5b)", () => {
  const porEstado = (e: Estado = estadoCom(), extra: Partial<{ mostrar: "abertas" | "feitas" | "todas"; bot: string }> = {}): string => renderTelaTarefas(e, { tipo: "trabalhos", filtro: "todos", ...extra });

  it("uma linha por tarefa: o ícone, o título e o passo, o bot, a origem e o tempo; quem pergunta primeiro, no azul", () => {
    const html = porEstado();
    expect(html).toContain('data-vista="por-estado"');
    expect(html.indexOf("Precisa de você · 1")).toBeLessThan(html.indexOf("Trabalhando · 9"));
    expect(html).toMatch(/<button type="button" class="tf-tarefa" data-act="abrir-trabalho" data-id="pr821" data-grupo="precisa"><span class="tf-ic"><svg class="pf-aba-ic pf-precisa"[^]*?<span class="tf-t-titulo">PR #821 · Migração 0168<\/span><span class="tf-t-passo"[^>]*>[^<]+<\/span><\/span><span class="tf-quem"><nod-mascote[^>]*><\/nod-mascote><span>Lia<\/span><\/span><span class="tf-origem"><\/span><span class="tf-tempo">6 min<\/span><\/button>/);
    expect(html).toMatch(/data-id="fila-email" data-grupo="trabalhando">[^]*?<span>Davi<\/span><\/span><span class="tf-origem"><span class="tf-origem-chip">do Quadro<\/span><\/span><span class="tf-tempo">22 min<\/span>/);
    // Abertas não traz as prontas.
    expect(html).not.toContain("Feitas hoje");
  });

  it("Feitas e Todas; o bot escolhido filtra as linhas", () => {
    expect(porEstado(estadoCom(), { mostrar: "feitas" })).toContain('<h2 class="tf-rotulo">Feitas hoje · 3</h2>');
    expect(porEstado(estadoCom(), { mostrar: "feitas" })).not.toContain("Trabalhando ·");
    const todas = porEstado(estadoCom(), { mostrar: "todas" });
    expect(todas.indexOf("Trabalhando · 9")).toBeLessThan(todas.indexOf("Feitas hoje · 3"));
    expect(todas).toMatch(/data-id="ok0" data-grupo="terminados">[^]*?<span class="tf-t-passo"[^>]*>pronto para merge<\/span>[^]*?<span class="tf-tempo">14:59<\/span>/);
    const soDavi = porEstado(estadoCom(), { bot: "davi" });
    expect(soDavi).toContain('data-id="fila-email"');
    expect(soDavi).not.toContain('data-id="pr821"');
    expect(porEstado(estadoCom(), { bot: "teo" })).toContain("Nada com este filtro agora.");
  });

  it("os ícones de lote B: anel de quem roda, ponto de quem pergunta, ✓, quadrado; o tracejado de quem espera", () => {
    expect(iconeDaTarefa(trabalho("a"))).toContain("pf-anel");
    expect(iconeDaTarefa(trabalho("b", { estado: "precisa_de_voce" }))).toContain("pf-precisa");
    expect(iconeDaTarefa(trabalho("c", { estado: "terminado" }))).toContain("at-feita");
    expect(iconeDaTarefa(trabalho("d", { estado: "parado" }))).toContain("at-parada");
    expect(iconeDaTarefa(trabalho("e", { turnoVivoId: null, acordaEm: AGORA + 10 * MIN }))).toContain('stroke-dasharray="2 2"');
  });

  it("a origem: do Quadro, da rotina e o pedido do colega; a da pessoa e a da rede, sem chip", () => {
    expect(origemNaTela({ origem: "quadro", pedidoPorNome: null })).toBe("do Quadro");
    expect(origemNaTela({ origem: "rotina", pedidoPorNome: null })).toBe("da rotina");
    expect(origemNaTela({ origem: "colega", pedidoPorNome: "Chico" })).toBe("pedido do Chico");
    expect(origemNaTela({ origem: "pessoa", pedidoPorNome: null })).toBe("");
    expect(origemNaTela({ origem: "rede", pedidoPorNome: null })).toBe("");
  });
});

describe("no main (Paper 4e: o clique numa tarefa abre a tarefa em tela cheia)", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("a tela, a vista, os chips e o bot trocam a tela; o + Nova tarefa sem bot abre o menu \"Nova tarefa com\"", () => {
    expect(main).toContain("corpo = renderTelaTarefas(estado, t);");
    expect(main).toContain('"vista-tarefas": (el) => {');
    expect(main).toContain('"mostrar-tarefas": (el) => {');
    expect(main).toContain('"bots-tarefas": (el) => abrirMenuDeBotsDasTarefas(el),');
    expect(main).toContain("abrirMenuDaBarra(htmlDoMenuDaNovaTarefa(bots), alvo");
    // A linha da tarefa usa o abrir-trabalho de sempre: a tela da tarefa com a aba dela (passo 3).
    expect(main).toContain('"abrir-trabalho": (el) => abrirTrabalho(el.dataset.id ?? ""),');
    expect(main).not.toContain('"filtro-trabalhos"');
  });

  it("o CSS da tela usa só os tokens do chat (claro e escuro) e cabe no celular", () => {
    const css = readFileSync(new URL("../../../web/chat.css", import.meta.url), "utf8");
    const bloco = css.slice(css.indexOf(".timeline-wrap:has(> .tela-tarefas)"));
    expect(bloco).toContain(".tela-tarefas .tf-cab h1 { flex: none; margin: 0; font-size: 26px; line-height: 32px; font-weight: 600; letter-spacing: -0.01em; }");
    expect(bloco).toContain(".tela-tarefas .tf-chip[aria-pressed=\"true\"] { background: var(--chat-tinta); color: var(--chat-superficie); }");
    expect(bloco).toContain(".tela-tarefas .tf-tarefa[data-grupo=\"precisa\"] { margin-bottom: 4px; border-bottom: 0; border-radius: 10px; background: var(--chat-precisa-fundo); }");
    expect(bloco).toMatch(/@media \(max-width: 760px\) \{\n {2}\.tela-tarefas \{ padding: 20px 16px 24px; \}/);
  });
});

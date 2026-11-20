import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { abasAoMostrar, abrirAba, dividirAbas, fecharAba, gravarAbas, gravarModoAbas, lerAbas, lerModoAbas, MAX_ABAS_GUARDADAS, podarAbas, tarefaAcabou, vizinhaAoFechar, type AbaDeTarefa } from "../../../web/lib/abas-de-tarefa.ts";
import { botaoDeAbas, feitasDaFileira, htmlDoMenuDaAba, htmlDoMenuDasOutras, iconeDaAba, outrasDaFileira, renderFileiraDeAbas } from "../../../web/telas/abas-de-tarefa.ts";
import { renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/**
 * ADR-187 §6 (lote B, passo 3, 2026-11-18): a tarefa em tela cheia com a fileira de abas (Paper 4j opção 1, 4o e 4p). Só
 * as tarefas que a pessoa abriu; no máximo 3 à vista; nenhuma aba fecha sozinha (Paper 10b, validação de 2026-11-18);
 * quais abas estão abertas e o modo abas sobrevivem ao recarregar (e a fileira funciona sem storage).
 */

const aba = (id: string, agenteId = "b1"): AbaDeTarefa => ({ id, agenteId });
const ids = (abas: readonly AbaDeTarefa[]): string[] => abas.map((a) => a.id);

describe("as abas abertas (web/lib/abas-de-tarefa.ts)", () => {
  it("entrar numa tarefa abre a aba no fim, uma vez só", () => {
    let abas = abrirAba([], aba("t1"));
    abas = abrirAba(abas, aba("t2"));
    abas = abrirAba(abas, aba("t1"));
    expect(ids(abas)).toEqual(["t1", "t2"]);
    expect(abrirAba(abas, aba(""))).toEqual(abas);
  });

  it("guarda no máximo 20: as mais antigas saem primeiro", () => {
    let abas: AbaDeTarefa[] = [];
    for (let i = 0; i < MAX_ABAS_GUARDADAS + 3; i++) abas = abrirAba(abas, aba(`t${i}`));
    expect(abas).toHaveLength(MAX_ABAS_GUARDADAS);
    expect(abas[0]?.id).toBe("t3");
  });

  it("fechar tira só a aba pedida", () => {
    expect(ids(fecharAba([aba("t1"), aba("t2"), aba("t3")], "t2"))).toEqual(["t1", "t3"]);
  });

  it("acabou = terminou ou falhou; parada não acabou (escrever retoma)", () => {
    expect(tarefaAcabou("terminado")).toBe(true);
    expect(tarefaAcabou("falhou")).toBe(true);
    for (const e of ["parado", "rodando", "na_fila", "precisa_de_voce", "fechado_ocioso"] as const) expect(tarefaAcabou(e)).toBe(false);
    expect(tarefaAcabou(undefined)).toBe(false);
  });

  it("o botão de abas leva as tarefas abertas do bot que ainda não eram aba, sem repetir", () => {
    expect(ids(abasAoMostrar([aba("t2")], [aba("t1"), aba("t2"), aba("t3")]))).toEqual(["t2", "t1", "t3"]);
    expect(abasAoMostrar([], [])).toEqual([]);
  });

  it("o modo abas por bot volta igual do storage; lixo vira nenhum", () => {
    expect(lerModoAbas(gravarModoAbas(new Set(["b2", "b1"])))).toEqual(new Set(["b1", "b2"]));
    for (const lixo of [null, "", "{", '{"b1":true}', "42"]) expect(lerModoAbas(lixo)).toEqual(new Set());
    expect(lerModoAbas('["b1", 3, "", null]')).toEqual(new Set(["b1"]));
  });

  it("no máximo 3 à vista; a ativa além da terceira toma o lugar da terceira; o resto vai para \"outras\"", () => {
    const abas = ["t1", "t2", "t3", "t4", "t5"].map((x) => aba(x));
    expect(ids(dividirAbas(abas, "t2").aVista)).toEqual(["t1", "t2", "t3"]);
    expect(ids(dividirAbas(abas, "t2").outras)).toEqual(["t4", "t5"]);
    expect(ids(dividirAbas(abas, "t5").aVista)).toEqual(["t1", "t2", "t5"]);
    expect(ids(dividirAbas(abas, "t5").outras)).toEqual(["t3", "t4"]);
    expect(ids(dividirAbas(abas, null).aVista)).toEqual(["t1", "t2", "t3"]);
    expect(dividirAbas(abas.slice(0, 2), "t1").outras).toEqual([]);
  });

  it("a aba de quem precisa da pessoa nunca fica escondida: toma o lugar da última que não é a ativa (Paper 10b, 3b)", () => {
    const abas = ["t1", "t2", "t3", "t4", "t5"].map((x) => aba(x));
    const precisa = (id: string): boolean => id === "t5";
    expect(ids(dividirAbas(abas, "t1", 3, precisa).aVista)).toEqual(["t1", "t2", "t5"]);
    expect(ids(dividirAbas(abas, "t1", 3, precisa).outras)).toEqual(["t3", "t4"]);
    // Mais que caibam: ficam as primeiras que precisam; a ativa nunca sai.
    const todas = (id: string): boolean => id !== "t1";
    expect(ids(dividirAbas(abas, "t1", 3, todas).aVista)).toEqual(["t1", "t2", "t3"]);
  });

  it("fechar a aba à vista vai para a da direita, senão a da esquerda, senão a Conversa (null)", () => {
    const abas = [aba("t1"), aba("t2"), aba("t3")];
    expect(vizinhaAoFechar(abas, "t2")).toBe("t3");
    expect(vizinhaAoFechar(abas, "t3")).toBe("t2");
    expect(vizinhaAoFechar([aba("t1")], "t1")).toBeNull();
    expect(vizinhaAoFechar(abas, "x")).toBeNull();
  });

  it("o que o storage guarda volta igual; lixo vira lista vazia, sem quebrar", () => {
    const abas = [aba("t1", "b1"), aba("t2", "b2")];
    expect(lerAbas(gravarAbas(abas))).toEqual(abas);
    for (const lixo of [null, undefined, "", "{", "42", '{"id":"t1"}', "null"]) expect(lerAbas(lixo)).toEqual([]);
    expect(lerAbas('[{"id":"t1","agenteId":"b1"},{"id":"t1","agenteId":"b1"},{"id":3},null,{"id":"t2","agenteId":""}]')).toEqual([aba("t1", "b1")]);
  });

  it("depois que a lista chega, saem as abas que a tela não conhece; a à vista nunca sai", () => {
    const conhecidas = new Set(["t1"]);
    const abas = [aba("t1"), aba("t2"), aba("t3")];
    expect(ids(podarAbas(abas, (id) => conhecidas.has(id), "t3"))).toEqual(["t1", "t3"]);
  });
});

const AGORA = new Date(2026, 10, 18, 15, 10).getTime();
const tarefa = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "b1", conversaId: "c1", titulo: `Tarefa ${id}`, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 60_000, iniciadoEm: AGORA - 60_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null,
  turnoVivoId: null, esperandoComputadorDe: null, forma: "frente", loteId: null, lote: null, ...extra,
});
function estadoCom(trabalhos: TrabalhoDto[]): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "b1", nome: "Bot A", conversaId: "c1", cor: "c-rouge", forma: "shape-square", ownerId: "p", titulo: "", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null, donos: [] },
    tela: { tipo: "trabalho", id: "t1", voltar: { tipo: "conversa", conversaId: "c1", agenteId: "b1" } },
  };
}
const NOVA = { texto: "⌘N", aria: "Meta+N" };

describe("a fileira (web/telas/abas-de-tarefa.ts, Paper 4p)", () => {
  it("\"‹ Conversa\", as abas do bot com o ícone do estado, a ativa marcada, o + com a tecla e o fim à direita", () => {
    const e = estadoCom([tarefa("t1"), tarefa("t2", { estado: "precisa_de_voce" }), tarefa("t3", { estado: "terminado" })]);
    const html = renderFileiraDeAbas(e, { agenteId: "b1", ativa: "t1", abas: [aba("t1"), aba("t2"), aba("t3"), aba("x", "outro-bot")], renomeando: null, novaTarefa: NOVA, fim: "<i>fim</i>" });
    expect(html).toContain('data-act="aba-conversa" data-agente="b1"');
    expect(html).toContain('<div class="at-aba ativa" data-aba="t1">');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-act="menu-aba-tarefa" data-id="t2" aria-haspopup="menu"');
    // Validação de 2026-11-19: o × de cada aba sempre à vista, junto da seta do menu; sem a pílula, nem "Fechar abas".
    expect(html).toContain('<button type="button" class="at-fechar" data-act="fechar-aba-tarefa" data-id="t3" aria-label="Fechar a aba Tarefa t3"');
    expect(html).not.toContain("at-fechar-abas");
    expect(html).toContain("pf-anel");
    expect(html).toContain("pf-precisa");
    expect(html).toContain("at-feita");
    expect(html).not.toContain('data-aba="x"');
    expect(html).toContain('data-act="nova-tarefa" aria-label="Nova tarefa com Bot A" aria-keyshortcuts="Meta+N"');
    expect(html).toContain("<kbd>⌘N</kbd>");
    expect(html).toContain('<span class="at-fim"><i>fim</i></span>');
    expect(html).not.toContain("at-outras");
  });

  it("acima de 3, \"N outras ⌄\" junta as que não couberam e as tarefas abertas do bot que a pessoa não abriu", () => {
    const e = estadoCom(["t1", "t2", "t3", "t4", "t5"].map((x) => tarefa(x)).concat(tarefa("t6", { estado: "terminado" })));
    const abas = ["t1", "t2", "t3", "t4"].map((x) => aba(x));
    expect(outrasDaFileira(e, abas, "b1", "t1").map((t) => t.id)).toEqual(["t4", "t5"]);
    const html = renderFileiraDeAbas(e, { agenteId: "b1", ativa: "t1", abas, renomeando: null, novaTarefa: null });
    expect(html).toContain('data-act="abas-outras" data-agente="b1" aria-haspopup="menu">2 outras');
    expect(html).not.toContain('data-aba="t4"');
    expect(html).not.toContain('data-act="nova-tarefa"');
    expect(htmlDoMenuDasOutras(outrasDaFileira(e, abas, "b1", "t1"))).toContain('data-id="t5"');
  });

  it("na tarefa nova, a aba \"Nova tarefa\" é a ativa; a tarefa que a tela não conhece não vira aba", () => {
    const html = renderFileiraDeAbas(estadoCom([tarefa("t1")]), { agenteId: "b1", ativa: null, abas: [aba("t1"), aba("sumiu")], renomeando: null, novaTarefa: NOVA });
    expect(html).toContain('<div class="at-aba ativa at-nova">');
    expect(html).toContain('<div class="at-aba" data-aba="t1">');
    expect(html).not.toContain('data-aba="sumiu"');
  });

  it("renomeando, o nome vira campo com o texto de agora; o nome novo aparece antes de o servidor devolver", () => {
    const e = estadoCom([tarefa("t1")]);
    const editando = renderFileiraDeAbas(e, { agenteId: "b1", ativa: "t1", abas: [aba("t1")], renomeando: { id: "t1", texto: "Novo <nome>" }, novaTarefa: NOVA });
    expect(editando).toContain('<input id="at-nome" class="at-nome" data-id="t1" value="Novo &lt;nome&gt;"');
    expect(editando).not.toContain('data-act="aba-tarefa"');
    const otimista = renderFileiraDeAbas(e, { agenteId: "b1", ativa: "t1", abas: [aba("t1")], renomeando: null, novaTarefa: NOVA, titulos: new Map([["t1", "Revisão"]]) });
    expect(otimista).toContain('<span class="at-titulo">Revisão</span>');
  });

  it("o ícone diz o estado: anel (na fila parado), ponto de quem precisa, ✓ e quadrado", () => {
    expect(iconeDaAba({ estado: "rodando" }).texto).toBe("trabalhando");
    expect(iconeDaAba({ estado: "na_fila" }).html).toContain("at-quieto");
    expect(iconeDaAba({ estado: "fechado_ocioso" }).html).toContain("pf-precisa");
    expect(iconeDaAba({ estado: "terminado" }).html).toContain("at-feita");
    expect(iconeDaAba({ estado: "parado" }).html).toContain("at-parada");
    expect(iconeDaAba({ estado: "falhou" }).html).toContain("at-falhou");
  });

  it("o menu da aba (sem ⋯): Renomear com a dica do duplo clique, Ver na tela Tarefas, Fechar aba e, aberta, Parar", () => {
    const aberta = htmlDoMenuDaAba(tarefa("t1"));
    expect(aberta).toContain('data-aba-acao="renomear">Renomear<span class="at-menu-dica">· duplo clique</span>');
    expect(aberta).toContain('data-aba-acao="tarefas"');
    expect(aberta).toContain('data-aba-acao="fechar"');
    expect(aberta).toContain('class="danger" data-aba-acao="parar"');
    expect(htmlDoMenuDaAba(tarefa("t1", { estado: "terminado" }))).not.toContain("parar");
  });

  it("com a fileira, ela é o topo da tarefa só com as abas: o Parar foi para o campo (passo 4), sem o \"← Conversa\" antigo", () => {
    const e = estadoCom([tarefa("t1")]);
    const topo = renderTopoTrabalho(e, "t1", (fim) => `<nav>${fim}</nav>`);
    expect(topo).toBe('<div class="tk-topo tk-topo-abas"><nav></nav></div>');
    expect(topo).not.toContain('data-act="parar-trabalho"');
    expect(topo).not.toContain("tk-status");
    expect(topo).not.toContain('data-act="fechar-trabalho"');
    expect(renderTopoTrabalho(e, "t1")).toContain('data-act="fechar-trabalho"');
  });

  it("modo abas (Paper 10c A): a pílula é a aba da Conversa, marcada nela; \"Fechar abas\" no fim", () => {
    const e = estadoCom([tarefa("t1"), tarefa("t2")]);
    const naConversa = renderFileiraDeAbas(e, { agenteId: "b1", ativa: null, abas: [aba("t1"), aba("t2")], renomeando: null, novaTarefa: NOVA, pilula: { html: "<b>pílula</b>", conversaAtiva: true, botaoDeAbas: "<i>abas</i>" } });
    expect(naConversa).toContain('<nav class="abas-tarefa abas-com-pilula"');
    expect(naConversa).toContain('<div class="at-pilula ativa"><b>pílula</b><i>abas</i></div>');
    expect(naConversa).not.toContain('data-act="aba-conversa"');
    expect(naConversa).not.toContain("at-nova");
    expect(naConversa).not.toContain('class="at-aba ativa"');
    expect(naConversa).toContain('data-act="fechar-abas" data-agente="b1"');
    const naTarefa = renderFileiraDeAbas(e, { agenteId: "b1", ativa: "t2", abas: [aba("t1"), aba("t2")], renomeando: null, novaTarefa: NOVA, pilula: { html: "<b>pílula</b>", conversaAtiva: false } });
    expect(naTarefa).toContain('<div class="at-pilula"><b>pílula</b></div>');
    expect(naTarefa).toContain('<div class="at-aba ativa" data-aba="t2">');
  });

  it("a que precisa da pessoa sobe para a fileira; escondida além disso, \"N outras\" ganha o ponto", () => {
    const e = estadoCom(["t1", "t2", "t3", "t4"].map((x) => tarefa(x)).concat(tarefa("t5", { estado: "precisa_de_voce" })));
    const html = renderFileiraDeAbas(e, { agenteId: "b1", ativa: "t1", abas: ["t1", "t2", "t3", "t4", "t5"].map((x) => aba(x)), renomeando: null, novaTarefa: null });
    expect(html).toContain('data-aba="t5"');
    expect(html).not.toContain('data-aba="t3"');
    expect(html).toContain('class="at-outras" data-act="abas-outras"');
  });

  it("o botão de abas: só com aba ou tarefa aberta; ícone sem número à vista, o ponto de quem precisa", () => {
    expect(botaoDeAbas(estadoCom([tarefa("t1", { estado: "terminado" })]), [], "b1")).toBeNull();
    const html = botaoDeAbas(estadoCom([tarefa("t1"), tarefa("t2", { estado: "precisa_de_voce" })]), [aba("t1")], "b1") ?? "";
    expect(html).toContain('class="botao-abas precisa" data-act="mostrar-em-abas" data-agente="b1"');
    expect(html).toContain('aria-label="Mostrar as tarefas em abas, 2 tarefas, uma precisa de você"');
    expect(html).toContain('<span class="ba-num" aria-hidden="true">2</span>');
    expect(botaoDeAbas(estadoCom([tarefa("t1", { estado: "terminado" })]), [aba("t1")], "b1")).toContain('class="botao-abas"');
  });

  it("\"Tirar as feitas das abas\" aparece com feitas na fileira e diz quantas", () => {
    const e = estadoCom([tarefa("t1", { estado: "terminado" }), tarefa("t2", { estado: "falhou" }), tarefa("t3", { estado: "parado" })]);
    const feitas = feitasDaFileira(e, [aba("t1"), aba("t2"), aba("t3"), aba("t9", "b2")], "b1");
    expect(feitas).toEqual(["t1", "t2"]);
    expect(htmlDoMenuDasOutras([], feitas.length)).toContain("data-tirar-feitas>Tirar as 2 feitas das abas</button>");
    expect(htmlDoMenuDasOutras([], 1)).toContain("Tirar a feita das abas");
    expect(htmlDoMenuDasOutras([])).not.toContain("data-tirar-feitas");
  });
});

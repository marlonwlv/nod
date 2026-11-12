import { describe, expect, it } from "vitest";
import type { CanvasItemDto, ComentarioCanvasDto, VersaoCanvasDto } from "../../../src/contracts/canvas.ts";
import {
  agruparPorEstado, aprovadoQuando, balaoComFrame, htmlDaBarra, htmlDaLista, htmlDaListaCompacta, htmlDoBalao, htmlDoRecibo, htmlDosPinos, htmlMenuNome, htmlMenuVersoes, iniciais, lerRecibo,
  linhaDaVersao, numerarPinos, origemCurta, origemDoRepo, perguntaSobre, reciboDaRodada, type Balao, type Barra,
} from "../../../web/lib/canvas-html.ts";
import { lerRascunhos, passoDoAbrir, vistaInicial } from "../../../web/lib/canvas-na-tela.ts";

let n = 0;
const com = (o: Partial<ComentarioCanvasDto> = {}): ComentarioCanvasDto => ({
  id: `c${++n}`, telaId: "J1-1", jornada: "J1", tipo: "pino", x: 0.5, y: 0.5, texto: "ajustar", autorTipo: "pessoa", autorNome: null, paiId: null,
  versao: 1, rodada: 1, confiavel: true, resolvido: false, arquivado: false, criadoEm: n, ...o,
});
const item = (o: Partial<CanvasItemDto> = {}): CanvasItemDto => ({
  id: `k${++n}`, issue: "NOD-1", titulo: "Canvas", versao: 1, origemUrl: null, atualizadoEm: n, abertos: 0, estado: "esperando_voce", etapa: null, aprovadoEm: null, telas: 3, jornadas: 1, ...o,
});
const barra = (o: Partial<Barra> = {}): Barra => ({
  nome: "NOD-512", versao: 3, vendo: null, onde: "J2-1", pct: 0.42, modo: null, rascunhos: 0, abertos: 0, vivo: false, enviando: false, menu: null, apresentando: false, podeLink: true, ...o,
});
const versao = (o: Partial<VersaoCanvasDto> = {}): VersaoCanvasDto => ({ versao: 2, criadoEm: Date.now(), resumo: null, mudaram: [], sairam: [], telas: 5, jornadas: 2, resolvidos: [], arquivados: 0, ...o });

describe("barra (J3-1)", () => {
  it("mostra nome, versão, onde e o %; sem rascunho não há Enviar", () => {
    const h = htmlDaBarra(barra());
    expect(h).toContain("NOD-512");
    expect(h).toContain(">v3<");
    expect(h).toContain("J2-1");
    expect(h).toContain("42%");
    expect(h).not.toContain("enviar-rodada");
  });
  it("com rascunhos, Enviar N ›; enviando, desabilitado", () => {
    expect(htmlDaBarra(barra({ rascunhos: 3 }))).toMatch(/data-cv="enviar-rodada">Enviar 3 /);
    expect(htmlDaBarra(barra({ rascunhos: 3, enviando: true }))).toMatch(/data-cv="enviar-rodada" disabled/);
  });
  it("vendo versão antiga: mostra a vN velha e desabilita Comentar e Nota", () => {
    const h = htmlDaBarra(barra({ vendo: 1 }));
    expect(h).toContain("cv-fer-velha");
    expect(h).toContain(">v1<");
    expect(h).toMatch(/data-cv="comentar"[^>]*disabled/);
    expect(h).toMatch(/data-cv="nota"[^>]*disabled/);
  });
  it("modo pino liga o Comentar; apresentando, só a navegação e o sair", () => {
    expect(htmlDaBarra(barra({ modo: "pino" }))).toMatch(/cv-fer-on" data-cv="comentar"[^>]*aria-pressed="true"/);
    const a = htmlDaBarra(barra({ apresentando: true }));
    expect(a).toContain("sair-apresentar");
    expect(a).not.toContain("menu-nome");
    expect(a).not.toContain('data-cv="link"');
  });
  it("J3-3: apresentando, a barra traz o título da tela e o % da tela grande", () => {
    const a = htmlDaBarra(barra({ apresentando: true, onde: "J3-1", titulo: "Mudar", pct: 1 }));
    expect(a).toMatch(/J3-1<\/span><span class="cv-fer-tit">Mudar<\/span><button[^>]*data-cv="proxima"/);
    expect(a).toContain(">100%<");
    expect(a).not.toContain('data-cv="ajustar"');
  });
});

describe("recibo da rodada (J5-3)", () => {
  const r = { canvas: "NOD-512", rodada: 2, itens: [{ endereco: "J1-2", texto: "botão  maior\nno topo" }, { endereco: "J2", texto: "falta o vazio" }] };
  it("ida e volta", () => {
    const t = reciboDaRodada(r);
    expect(t.split("\n")[0]).toBe("Rodada 2 no canvas NOD-512 (2 comentários):");
    expect(lerRecibo(t)).toEqual({ canvas: "NOD-512", rodada: 2, itens: [{ endereco: "J1-2", texto: "botão maior no topo" }, { endereco: "J2", texto: "falta o vazio" }] });
  });
  it("mensagem comum, contagem errada ou linha fora do formato não é recibo", () => {
    expect(lerRecibo("oi, tudo bem?")).toBeNull();
    expect(lerRecibo("Rodada 1 no canvas X (2 comentários):\n- #J1-1: a")).toBeNull();
    expect(lerRecibo("Rodada 1 no canvas X (1 comentário):\n- #J1-1: a\nolá")).toBeNull();
  });
  it("o html escapa e cada endereço abre o canvas na tela", () => {
    const h = htmlDoRecibo({ canvas: "<b>", rodada: 1, itens: [{ endereco: "J1-1", texto: "<script>" }] }, "abc");
    expect(h).not.toContain("<script>");
    expect(h).toContain('data-act="abrir-canvas" data-id="abc" data-endereco="J1-1"');
    expect(htmlDoRecibo({ canvas: "x", rodada: 1, itens: [{ endereco: "J1-1", texto: "a" }] }, null)).not.toContain("data-act");
  });
});

describe("lista por estado (J7-3)", () => {
  it("ordem esperando, produção, aprovado; mais recente primeiro; busca em issue e título", () => {
    const a = item({ estado: "aprovado", atualizadoEm: 1 });
    const p = item({ estado: "em_producao", atualizadoEm: 2, etapa: "montando a J2-3 · 1 de 3 telas" });
    const e1 = item({ estado: "esperando_voce", atualizadoEm: 3, issue: "NOD-9", titulo: "Agenda" });
    const e2 = item({ estado: "esperando_voce", atualizadoEm: 4 });
    expect(agruparPorEstado([a, p, e1, e2]).map((g) => [g.estado, g.itens.map((c) => c.id)])).toEqual([["esperando_voce", [e2.id, e1.id]], ["em_producao", [p.id]], ["aprovado", [a.id]]]);
    expect(agruparPorEstado([a, p, e1, e2], "agenda").flatMap((g) => g.itens)).toEqual([e1]);
    expect(agruparPorEstado([a, p, e1, e2], "nod-9").flatMap((g) => g.itens)).toEqual([e1]);
  });
  it("a lista tracejada pela classe do estado e o filtro marcado", () => {
    const h = htmlDaLista({ lista: [item({ estado: "em_producao", etapa: "montando" }), item()], filtro: "em_producao", busca: "", nome: "Ada", miniatura: () => null });
    expect(h).toContain("cv-lin-producao");
    expect(h).not.toContain("cv-lin-esperando");
    expect(h).toMatch(/aria-selected="true" class="cv-filtro" data-cv="filtro" data-filtro="em_producao"/);
    expect(h).toContain("1 em produção agora");
  });
  it("o menu do nome tem Todos os canvas e marca o aberto", () => {
    const c = item();
    const h = htmlMenuNome({ lista: [c, item()], aberto: c.id, busca: "", nome: "Ada" });
    expect(h).toContain('data-cv="todos"');
    expect(h).toContain(`cv-mi cv-mi-cur" data-cv="abrir" data-id="${c.id}"`);
  });
});

describe("versões (J5-6)", () => {
  it("linha da atual: resolvidos, abertos e arquivados", () => {
    const r1 = com({ telaId: "J1-2", resolvido: true });
    const r2 = com({ telaId: "J1-3", resolvido: true });
    const aberto = com({ telaId: "J1-1" });
    const l = linhaDaVersao(versao({ versao: 3, resolvidos: [r1.id, r2.id], arquivados: 2 }), { atual: 3, comentarios: [r1, r2, aberto] });
    expect(l).toMatch(/^hoje \d\d:\d\d · atual · resolveu J1-2 e J1-3 · J1-1 segue aberto · 2 comentários arquivados$/);
  });
  it("o menu: Ver nas antigas, ✓ na vista, Comparar só com mais de uma", () => {
    const h = htmlMenuVersoes({ canvas: "NOD-1", versoes: [versao({ versao: 1 }), versao({ versao: 2 })], atual: 2, vendo: 2, comparar: false, comentarios: [] });
    expect(h).toContain('data-cv="ver-versao" data-versao="1">Ver');
    expect(h).not.toContain('data-versao="2"');
    expect(h).toContain("Comparar com a anterior");
    expect(htmlMenuVersoes({ canvas: "x", versoes: null, atual: 1, vendo: 1, comparar: false, comentarios: [] })).not.toContain("comparar");
  });
});

describe("pinos (J5-1, J5-5)", () => {
  it("numera pela ordem das raízes; resposta não conta", () => {
    const a = com({ criadoEm: 2 });
    const b = com({ criadoEm: 1 });
    const r = com({ paiId: a.id, criadoEm: 0 });
    expect([...numerarPinos([a, b, r])]).toEqual([[b.id, 1], [a.id, 2]]);
  });
  it("rascunho tracejado continua a numeração; resolvido vira ✓ sem número; versão antiga, velho", () => {
    const ok = com({ resolvido: true });
    const ab = com();
    const numeros = numerarPinos([ok, ab]);
    const h = htmlDosPinos({ tela: "J1-1", comentarios: [ok, ab], numeros, rascunhos: [{ id: "r1", tipo: "pino", endereco: "J1-1", x: 0.1, y: 0.2, texto: "x" }, { id: "r2", tipo: "pino", endereco: "J9-9", texto: "y" }], ativo: null, velha: false, novo: null });
    expect(h).toMatch(/cv-pino cv-pino-ok" data-cv="thread"[^>]*><\/button>/);
    expect(h).toMatch(/cv-pino-rasc" data-cv="rascunho" data-id="r1"[^>]*>3<\/button>/);
    expect(h).not.toContain("r2");
    expect(htmlDosPinos({ tela: "J1-1", comentarios: [ab], numeros, rascunhos: [], ativo: null, velha: true, novo: null })).toContain("cv-pino-velho");
  });
  it("rascunhos guardados: só os com forma certa e texto", () => {
    expect(lerRascunhos(JSON.stringify([{ id: "a", tipo: "pino", endereco: "J1-1", texto: "ok" }, { id: "b", tipo: "x", endereco: "J1", texto: "z" }, { id: "c", tipo: "nota", endereco: "J1", texto: "  " }]))).toHaveLength(1);
    expect(lerRascunhos("{quebrado")).toEqual([]);
    expect(lerRascunhos(null)).toEqual([]);
  });
});

describe("input de vidro e balão (J4-4..6)", () => {
  const b0: Balao = { pergunta: "e o vazio?", chip: "J1-3", etapas: [], resposta: "", fim: false, inicio: 0, agora: 0, nome: "Ada", conversaId: "cv1", turnoId: null };
  const f = (tipo: string, dados: Record<string, unknown>) => ({ tipo, dados: { conversaId: "cv1", turnoId: "t1", ...dados } });
  it("a pergunta leva o endereço e o canvas", () => {
    expect(perguntaSobre({ endereco: "J2-1", canvas: "NOD-512", texto: " maior " })).toBe("sobre #J2-1 do NOD-512: maior");
    expect(perguntaSobre({ endereco: null, canvas: "NOD-512", texto: "oi" })).toBe("sobre o canvas NOD-512: oi");
  });
  it("ignora outra conversa e outro turno; segue etapas, texto e fim", () => {
    expect(balaoComFrame(b0, { tipo: "turno.delta", dados: { conversaId: "outra", texto: "x" } }, 1)).toBe(b0);
    // O frame como o servidor manda (frameDaFerramenta): rotulo em texto, emUso como {texto, frentes}.
    let b = balaoComFrame(b0, f("turno.atividade", { id: "a1", rotulo: "Leu a J1-3", emUso: { texto: "Lendo a J1-3", frentes: false } }), 1000);
    expect(b.turnoId).toBe("t1");
    expect(b.etapas).toEqual([{ id: "a1", texto: "Leu a J1-3", estado: "rodando", agora: "Lendo a J1-3" }]);
    expect(balaoComFrame(b, { tipo: "turno.delta", dados: { conversaId: "cv1", turnoId: "t2", texto: "x" } }, 1)).toBe(b);
    b = balaoComFrame(b, f("turno.acao_fim", { id: "a1", falhou: false }), 2000);
    b = balaoComFrame(b, f("turno.delta", { texto: "Pronto, " }), 2000);
    b = balaoComFrame(b, f("turno.delta", { texto: "mudei." }), 2000);
    expect(b.etapas[0]?.estado).toBe("feita");
    expect(b.resposta).toBe("Pronto, mudei.");
    b = balaoComFrame(b, f("turno.encerrado", {}), 5000);
    expect(b.fim).toBe(true);
    expect(balaoComFrame(b, f("turno.delta", { texto: "mais" }), 6000)).toBe(b);
    const h = htmlDoBalao(b);
    expect(h).toContain("Trabalhou por 5 s · 1 ação");
    expect(h).toContain("Pronto, mudei.");
  });
  it("interrompido sem resposta diz que parou", () => {
    expect(balaoComFrame(b0, f("turno.interrompido", {}), 1).resposta).toBe("Parou antes de responder.");
  });
});

describe("miúdos", () => {
  it("iniciais e origem curta", () => {
    expect(iniciais("Marlon Wanderllich")).toBe("MW");
    expect(iniciais("Ada")).toBe("AD");
    expect(origemCurta("https://gamefik.github.io/nod-prototipos/nod-ada-13-canvas/")).toBe("nod-prototipos/nod-ada-13-canvas");
    // ADA-228 (J6-1): a origem do card do importado, como no protótipo.
    expect(origemDoRepo("https://gamefik.github.io/nod-prototipos/nod-463-canvas/")).toBe("gamefik/nod-prototipos · nod-463-canvas");
    expect(origemDoRepo("https://exemplo.com/a/b/")).toBe("a/b");
  });

  it("a lista compacta do chat (J7-5): N esperam você, só com os que esperam, cada nome abre o canvas", () => {
    const h = htmlDaListaCompacta([
      { id: "a", issue: "NOD-1", titulo: "Um", versao: 3, estado: "aprovado", etapa: null, aprovadoEm: null },
      { id: "b", issue: null, titulo: "Sem <issue>", versao: 1, estado: "em_producao", etapa: "montando a J1-2" },
      { id: "c", issue: "NOD-3", titulo: "Três", versao: 2, estado: "esperando_voce", etapa: "1 comentário aberto" },
      { id: "d", issue: null, titulo: "Solto <x>", versao: 1, estado: "esperando_voce", etapa: null },
    ]);
    // J7-5: "2 esperam você:" e só os que esperam, com título, versão e etapa.
    expect(h).toContain("2 esperam você:");
    expect([...h.matchAll(/data-id="(\w)"/g)].map((m) => m[1])).toEqual(["c", "d"]);
    expect(h).toContain("Três · v2 · 1 comentário aberto");
    expect(h).toContain("Solto &lt;x&gt;");
    expect(h).toContain("v1 · pronto para ver");
    expect(h).toContain('data-act="abrir-canvas"');
  });

  it("sem nenhum esperando, a lista compacta vai inteira, por estado", () => {
    const h = htmlDaListaCompacta([
      { id: "a", issue: "NOD-1", titulo: "Um", versao: 3, estado: "aprovado", etapa: null, aprovadoEm: null },
      { id: "b", issue: null, titulo: "Sem <issue>", versao: 1, estado: "em_producao", etapa: "montando a J1-2" },
    ]);
    expect(h).toContain("Nenhum espera você.");
    expect([...h.matchAll(/data-id="(\w)"/g)].map((m) => m[1])).toEqual(["b", "a"]);
    expect(h).toContain("Sem &lt;issue&gt;");
    expect(h).toContain("montando a J1-2");
    expect(h).toContain(">aprovado<");
  });

  it("Aprovado mostra a data em que a tarefa saiu de Prototipando (regra da Ada)", () => {
    const agora = new Date(2026, 10, 5, 12).getTime();
    expect(aprovadoQuando(null, agora)).toBe("aprovado");
    expect(aprovadoQuando(new Date(2026, 10, 5, 9).getTime(), agora)).toBe("aprovado hoje");
    expect(aprovadoQuando(new Date(2026, 10, 4, 9).getTime(), agora)).toBe("aprovado ontem");
    expect(aprovadoQuando(new Date(2026, 10, 1, 9).getTime(), agora)).toBe("aprovado em 01/11");
    expect(htmlDaListaCompacta([{ id: "a", issue: "NOD-1", titulo: "Um", versao: 3, estado: "aprovado", etapa: null, aprovadoEm: Date.now() }])).toContain("aprovado hoje");
  });
});

describe("vistaInicial (J6-2)", () => {
  it("o importado abre com todas as fileiras; o resto, na largura", () => {
    expect(vistaInicial(true)).toBe("tudo");
    expect(vistaInicial(false)).toBe("largura");
  });
});
describe("passoDoAbrir (J7-1)", () => {
  it("o canvas já aberto, clicado na lista, volta para ele; no menu, só fecha o menu; outro abre", () => {
    expect(passoDoAbrir("a", "a", true)).toBe("voltar");
    expect(passoDoAbrir("a", "a", false)).toBe("topo");
    expect(passoDoAbrir("b", "a", true)).toBe("abrir");
    expect(passoDoAbrir("b", null, false)).toBe("abrir");
    expect(passoDoAbrir("", null, true)).toBe("abrir");
  });
});

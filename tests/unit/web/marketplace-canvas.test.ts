import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { CANVAS, paginasDoDto } from "../../../web/lib/paginas.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { renderMarketplace } from "../../../web/telas/marketplace.ts";
import { configurarAppCanvas, guardarAppCanvas, nivelCanvasDe } from "../../../web/telas/marketplace-canvas.ts";

/** ADA-13 (ADR-150): o cartão "Canvas · Do nod", a gaveta com o nível por bot, a pílula e o card no chat. */
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Gil", titulo: "UI/UX", descricao: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true } as never;
const base: Estado = { ...estadoInicial, agora: 10_000, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conectores" }, frota: { agentes: [agente], negacoes: [] } as never, marketplace: [], composioConfigurado: true };
configurarAppCanvas({ ler: () => null, aoMudar: () => undefined });

describe("Marketplace: Canvas · Do nod", () => {
  it("não instalado: o cartão oferece Instalar e a gaveta abre com a prévia e o texto do protótipo", () => {
    guardarAppCanvas({ instalado: false, acessos: [] });
    const html = renderMarketplace(base);
    expect(html).toContain('id="app-canvas"');
    expect(html).toContain('data-act="instalar-canvas"');
    const g = renderMarketplace({ ...base, tela: { tipo: "conectores", gaveta: { slug: "canvas", passo: "detalhes" } } });
    expect(g).toContain("Instalar Canvas");
    expect(g).toContain("cv-gav-previa");
    expect(g).toContain("O bot monta e atualiza canvas de telas pelo chat.");
    expect(g).not.toContain('data-act="nivel-canvas"');
  });
  it("instalado: o segmentado por bot marca o nível atual; Desinstalar no rodapé", () => {
    guardarAppCanvas({ instalado: true, acessos: [{ agenteId: "a1", nivel: "criar_publicar" }] });
    const g = renderMarketplace({ ...base, tela: { tipo: "conectores", gaveta: { slug: "canvas", passo: "detalhes" } } });
    expect(g).toContain('data-act="nivel-canvas" data-id="a1" data-nivel="criar_publicar" aria-pressed="true"');
    expect(g).toContain('data-nivel="nenhum" aria-pressed="false"');
    expect(g).toContain('data-act="desinstalar-canvas"');
    // ADA-228 (J1-2, Marlon 11/11): como no protótipo, prévia, texto, Quem usa e a nota; sem o card dos níveis.
    expect(g).toContain("Do nod · sem conta, sem chave");
    expect(g).toContain("cv-gav-previa");
    expect(g.indexOf("cv-gav-previa")).toBeLessThan(g.indexOf("Quem usa"));
    expect(g).toContain("Quem pode criar ganha a página Canvas na pílula.");
    expect(g).not.toContain("O que os bots podem fazer");
    expect(g).not.toContain("nivel-caixa");
    expect(renderMarketplace(base)).toContain("Gil usa");
    expect(nivelCanvasDe({ instalado: true, acessos: [] }, "a1")).toBe("nenhum");
  });
});

describe("Canvas na pílula e no chat", () => {
  it("a página Canvas entra depois de Tarefas quando o bot tem acesso", () => {
    const dto = { agenteId: "a1", ordem: [], apps: [], temTarefas: true, temCanvas: true, cabeMais: true, limite: 12 };
    expect(paginasDoDto(dto).map((p) => p.id)).toEqual(["conversa", "tarefas", CANVAS.id]);
    expect(paginasDoDto({ ...dto, temCanvas: false }).map((p) => p.id)).toEqual(["conversa", "tarefas"]);
  });
  it("o card do canvas publicado tem o título escapado, as contagens e Abrir", () => {
    const m = {
      id: "m1", conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false,
      autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv1", agenteId: "a1", versao: 2, titulo: "<b>NOD-1</b>", jornadas: 3, telas: 1, importado: true },
    } as unknown as Mensagem;
    const html = renderMensagem(m, { ...base, tela: { tipo: "conversa", conversaId: "c1" } } as never);
    expect(html).toContain("&lt;b&gt;NOD-1&lt;/b&gt;");
    expect(html).toContain("v2 · 3 jornadas · 1 tela");
    expect(html).toContain("cv-card-mini");
    expect(html).toContain("cv-card-origem");
    expect(html).toContain("Abrir no Canvas");
    expect(html).toContain('data-act="abrir-canvas"');
    expect(html).toContain('data-id="cv1"');
    expect(html).not.toContain("não confiável");
  });
  it("ADA-228 (J6-1, Marlon 11/11): o importado diz de onde veio, no lugar de não confiável", () => {
    const m = {
      id: "m3", conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false, autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv1", agenteId: "a1", versao: 1, titulo: "Prioridade", issue: "NOD-463", jornadas: 6, telas: 24, importado: true, confiavel: false, origemUrl: "https://gamefik.github.io/nod-prototipos/nod-463-canvas/" },
    } as unknown as Mensagem;
    const h = renderMensagem(m, { ...base, tela: { tipo: "conversa", conversaId: "c1" } } as never);
    expect(h).toContain("de gamefik/nod-prototipos · nod-463-canvas");
    expect(h).not.toContain("não confiável");
  });
  it("revisão 1 do #649 (A3): o card da versão de turno com conteúdo de fora diz não confiável", () => {
    const m = {
      id: "m2", conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false,
      autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv1", agenteId: "a1", versao: 3, titulo: "X", jornadas: 1, telas: 1, importado: false, confiavel: false },
    } as unknown as Mensagem;
    expect(renderMensagem(m, { ...base, tela: { tipo: "conversa", conversaId: "c1" } } as never)).toContain("não confiável");
  });
  it("ADA-228 (J2-2): a versão seguinte do mesmo canvas na conversa vira a linha vN no ar", () => {
    const pub = (id: string, versao: number, texto = ""): Mensagem => ({
      id, conversaId: "c1", kind: "sistema", texto, criadoEm: versao, parcial: false, autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv1", agenteId: "a1", versao, titulo: "NOD-512", jornadas: 2, telas: 5, importado: false },
    } as unknown as Mensagem);
    const v1 = pub("m1", 1);
    const v2 = pub("m2", 2, "mudei a J1-2 e a J1-3");
    const est = { ...base, tela: { tipo: "conversa", conversaId: "c1" }, conversas: { c1: { mensagens: [v1, v2] } } } as never;
    expect(renderMensagem(v1, est)).toContain("cv-card");
    const h = renderMensagem(v2, est);
    expect(h).toContain("NOD-512 · v2 no ar");
    expect(h).toContain("na mesma folha · mudei a J1-2 e a J1-3");
    expect(h).toContain(">Abrir <");
    // O texto automático da publicação não vira resumo: fica só "na mesma folha".
    const v3 = pub("m4", 3, "Publicou o canvas NOD-512 (v3: 2 jornadas, 5 telas).");
    const est3 = { ...base, tela: { tipo: "conversa", conversaId: "c1" }, conversas: { c1: { mensagens: [v1, v2, v3] } } } as never;
    expect(renderMensagem(v3, est3)).toContain("<span>na mesma folha</span>");
    expect(h).toContain("mudei a J1-2 e a J1-3");
    expect(h).not.toContain("cv-card-mini");
  });
  it("ADA-228 (J5-3): a rodada enviada pela pessoa vira o recibo com os endereços que abrem o canvas", () => {
    const pub = { id: "m1", conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false, autoria: { autor_tipo: "agente", autor_id: "a1" },
      payload: { kind: "canvas", canvasId: "cv9", agenteId: "a1", versao: 1, titulo: "NOD-512", jornadas: 1, telas: 1, importado: false } } as unknown as Mensagem;
    const r = { id: "m2", conversaId: "c1", kind: "texto", texto: "Rodada 1 no canvas NOD-512 (1 comentário):\n- #J1-2: botão maior", criadoEm: 2, parcial: false,
      autoria: { autor_tipo: "pessoa", autor_id: "p1" }, payload: null } as unknown as Mensagem;
    const h = renderMensagem(r, { ...base, tela: { tipo: "conversa", conversaId: "c1" }, conversas: { c1: { mensagens: [pub, r], turnosCancelados: [], turnosEmCurso: [] } } } as never);
    expect(h).toContain("cv-rodada");
    expect(h).toContain('data-act="abrir-canvas" data-id="cv9" data-endereco="J1-2"');
    // Como no protótipo: o recibo vai no balão da pessoa, com "enviada do Canvas" embaixo.
    expect(h).toMatch(/<div class="bubble cv-rodada-bal">.*cv-rodada.*<\/div><span class="cv-rodada-pe">enviada do Canvas<\/span>/s);
  });
  it("revisão do #677: com dois canvas na conversa, o recibo pela issue abre o canvas dela, não o último publicado", () => {
    const pub = (id: string, canvasId: string, issue: string, titulo: string): Mensagem => ({ id, conversaId: "c1", kind: "sistema", texto: "", criadoEm: 1, parcial: false,
      autoria: { autor_tipo: "agente", autor_id: "a1" }, payload: { kind: "canvas", canvasId, agenteId: "a1", versao: 1, titulo, issue, jornadas: 1, telas: 1, importado: false } } as unknown as Mensagem);
    const a = pub("m1", "cvA", "NOD-512", "Folha do onboarding");
    const b = pub("m2", "cvB", "NOD-5120", "Outra folha");
    const r = { id: "m3", conversaId: "c1", kind: "texto", texto: "Rodada 1 no canvas NOD-512 (1 comentário):\n- #J1-2: botão maior", criadoEm: 3, parcial: false,
      autoria: { autor_tipo: "pessoa", autor_id: "p1" }, payload: null } as unknown as Mensagem;
    const h = renderMensagem(r, { ...base, tela: { tipo: "conversa", conversaId: "c1" }, conversas: { c1: { mensagens: [a, b, r], turnosCancelados: [], turnosEmCurso: [] } } } as never);
    expect(h).toContain('data-id="cvA" data-endereco="J1-2"');
    // E o nome que é só o começo do título de outro canvas não o pega.
    const c = pub("m4", "cvC", "", "NOD-512 e mais");
    const h2 = renderMensagem(r, { ...base, tela: { tipo: "conversa", conversaId: "c1" }, conversas: { c1: { mensagens: [a, c, r], turnosCancelados: [], turnosEmCurso: [] } } } as never);
    expect(h2).toContain('data-id="cvA" data-endereco="J1-2"');
  });
});

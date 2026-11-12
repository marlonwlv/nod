import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComentarioCanvasDto } from "../../../src/contracts/canvas.ts";
import { htmlPopNovo, htmlThread, type Balao } from "../../../web/lib/canvas-html.ts";
import { ICONE_DA_PAGINA } from "../../../web/telas/paginas.ts";

/** ADA-228, rodada do Marlon de 11/11: o que ele marcou como diferente do protótipo. */
const com = (o: Partial<ComentarioCanvasDto>): ComentarioCanvasDto => ({
  id: "c1", telaId: "J1-2", jornada: "J1", tipo: "pino", x: 0.5, y: 0.5, texto: "testa 12 px?", autorTipo: "pessoa", autorNome: null, paiId: null,
  versao: 1, rodada: 1, confiavel: true, resolvido: false, arquivado: false, criadoEm: 1, ...o,
});
const css = (arq: string): string => readFileSync(new URL(`../../../web/${arq}`, import.meta.url), "utf8");

describe("ADA-228: ajustes da rodada de 11/11", () => {
  it("J1-3: o ícone do Canvas na pílula é o do protótipo (três telas e uma linha), não os dois retângulos sobrepostos", () => {
    const ic = ICONE_DA_PAGINA.canvas;
    expect(ic.match(/<rect /g)).toHaveLength(3);
    expect(ic).toContain('<path d="M13.5 17.25h8.25"/>');
    expect(ic).not.toContain("M8.5 12.5v3.5h2");
  });

  it("J4-2: a fala do bot na conversa do pino leva o mascote dele; a da pessoa, as iniciais", () => {
    const raiz = com({});
    const resp = com({ id: "c2", paiId: "c1", autorTipo: "bot", autorNome: "Gil", autorAgenteId: "a1", texto: "Faço em 12 px na v3." });
    const h = htmlThread({ raiz, respostas: [resp], x: 0, y: 0, autor: (c) => c.autorNome ?? "Você", leitura: false, enviando: false, mascote: (c) => (c.autorAgenteId === "a1" ? '<nod-mascote data-teste="gil"></nod-mascote>' : null) });
    expect(h).toContain('<span class="cv-av-mascote" aria-hidden="true"><nod-mascote data-teste="gil"></nod-mascote></span>');
    expect(h).toContain('<span class="cv-av" aria-hidden="true">VO</span>');
    // Sem mascote (bot que não está na frota), volta às iniciais.
    expect(htmlThread({ raiz, respostas: [resp], x: 0, y: 0, autor: (c) => c.autorNome ?? "Você", leitura: false, enviando: false })).toContain('class="cv-av cv-av-bot"');
  });

  it("revisão (J4-2): cada bot da conversa do pino leva o próprio mascote, não o do bot da página", () => {
    // Um bot com "ver e comentar" comenta no canvas de outro: a fala dele não pode sair com o mascote do dono da página.
    const raiz = com({});
    const gil = com({ id: "c2", paiId: "c1", autorTipo: "bot", autorNome: "Gil", autorAgenteId: "a1", texto: "Faço na v3." });
    const ada = com({ id: "c3", paiId: "c1", autorTipo: "bot", autorNome: "Ada", autorAgenteId: "a2", texto: "Revisei." });
    const fora = com({ id: "c4", paiId: "c1", autorTipo: "bot", autorNome: "Zé", autorAgenteId: "a9", texto: "Oi." });
    const frota: Record<string, string> = { a1: "<nod-mascote data-teste=\"gil\"></nod-mascote>", a2: "<nod-mascote data-teste=\"ada\"></nod-mascote>" };
    const h = htmlThread({ raiz, respostas: [gil, ada, fora], x: 0, y: 0, autor: (c) => c.autorNome ?? "Você", leitura: false, enviando: false, mascote: (c) => (c.autorAgenteId ? frota[c.autorAgenteId] ?? null : null) });
    expect(h).toMatch(/data-teste="gil"><\/nod-mascote><\/span><div><b>Gil<\/b>/);
    expect(h).toMatch(/data-teste="ada"><\/nod-mascote><\/span><div><b>Ada<\/b>/);
    // Bot fora da frota: as iniciais dele, não o mascote de outro.
    expect(h).toContain('<span class="cv-av cv-av-bot" aria-hidden="true">ZÉ</span><div><b>Zé</b>');
  });

  it("revisão (J4-2): o DTO do comentário diz qual bot escreveu; da pessoa e do importado, nada", async () => {
    const { comentarioDto } = await import("../../../src/use-cases/acoes/canvas.ts");
    const base = { id: "k", canvasId: "cv", telaId: "J1-2", jornada: "J1", tipo: "pino" as const, x: 0.5, y: 0.5, texto: "t", autorNome: "Gil", paiId: null, versao: 1, rodada: null, confianca: "confiavel" as const, resolvidoEm: null, arquivadoEm: null, criadoEm: 1 };
    expect(comentarioDto({ ...base, autorTipo: "bot", autorId: "a1" }).autorAgenteId).toBe("a1");
    expect(comentarioDto({ ...base, autorTipo: "pessoa", autorId: "p1" }).autorAgenteId).toBeNull();
    expect(comentarioDto({ ...base, autorTipo: "importado", autorId: null }).autorAgenteId).toBeNull();
  });

  it("J4-1, J4-2: o campo do pino e o Responder… não ganham o contorno preto no foco (fora do alto contraste)", () => {
    const c = css("canvas.css");
    expect(c).toMatch(/\.cv-pop textarea:focus, \.cv-pop textarea:focus-visible \{ outline: 0; \}/);
    expect(c).toMatch(/\.cv-pop \.cv-resp:focus, \.cv-pop \.cv-resp:focus-visible \{ outline: 0; border-color: var\(--line-strong\); \}/);
    expect(htmlPopNovo({ endereco: "J1-2", x: 0, y: 0 })).toContain('<textarea id="cv-novo-in"');
  });

  it("J1-2: o × da gaveta fica no centro do círculo", () => {
    expect(css("interface.css")).toMatch(/\.gaveta-fechar\{display:inline-grid!important;place-items:center;line-height:1!important;/);
  });
});

describe("ADA-228: o balão do canvas com o frame real do servidor (teste com a IA real, 11/11)", () => {
  it("emUso vem como {texto, frentes}: o cabeçalho diz o presente e a lista o rótulo, nunca [object Object]", async () => {
    const { balaoComFrame, htmlDoBalao } = await import("../../../web/lib/canvas-html.ts");
    const { frameDaFerramenta } = await import("../../../src/domain/rotulo-ferramenta.ts");
    const b0: Balao = { pergunta: "aumenta o contraste da J2-1", chip: "J2-1", etapas: [], resposta: "", fim: false, inicio: 0, agora: 0, nome: "Gil", conversaId: "c1", turnoId: null };
    const real = frameDaFerramenta("Read", "t1");
    let b = balaoComFrame(b0, { tipo: "turno.atividade", dados: { conversaId: "c1", turnoId: "u1", ...real } }, 1000);
    const h = htmlDoBalao(b, '<nod-mascote data-teste="gil"></nod-mascote>');
    expect(h).not.toContain("[object Object]");
    expect(h).toContain(`<span>${real.rotulo}</span>`);
    expect(h).toContain(`${real.emUso.texto} · 1 s`);
    expect(h).toContain('<span class="cv-av-mascote" aria-hidden="true"><nod-mascote data-teste="gil"></nod-mascote></span>');
    b = balaoComFrame(b, { tipo: "turno.acao_fim", dados: { conversaId: "c1", turnoId: "u1", id: "t1" } }, 2000);
    expect(b.etapas[0]?.estado).toBe("feita");
  });
});

describe("ADA-228: a resposta do bot no balão vem formatada (teste com a IA real, 11/11)", () => {
  it("markdown vira negrito, código e lista, e nada escapa como HTML cru", async () => {
    const { htmlDoBalao } = await import("../../../web/lib/canvas-html.ts");
    const b: Balao = { pergunta: "p", chip: null, etapas: [], resposta: "O que pedi:\n- **Fundo:** `#e8e8e4`\n- <img src=x onerror=alert(1)>", fim: true, inicio: 0, agora: 23_000, nome: "Gil", conversaId: "c1", turnoId: "t" };
    const h = htmlDoBalao(b);
    expect(h).toContain('<div class="cv-bal-txt">');
    expect(h).toContain("<strong>Fundo:</strong>");
    expect(h).toContain("<code>#e8e8e4</code>");
    expect(h).not.toContain("**Fundo");
    expect(h).not.toContain("<img");
  });
});

describe("ADA-228: a fala depois de uma ferramenta não gruda na anterior (teste com a IA real, 11/11)", () => {
  it("delta, ferramenta, delta vira dois parágrafos; dois deltas seguidos continuam juntos", async () => {
    const { balaoComFrame } = await import("../../../web/lib/canvas-html.ts");
    const f = (tipo: string, dados: Record<string, unknown>) => ({ tipo, dados: { conversaId: "c1", turnoId: "u1", ...dados } });
    let b: Balao = { pergunta: "p", chip: null, etapas: [], resposta: "", fim: false, inicio: 0, agora: 0, nome: "Gil", conversaId: "c1", turnoId: null };
    b = balaoComFrame(b, f("turno.delta", { texto: "Vou republicar a v5" }), 1);
    b = balaoComFrame(b, f("turno.delta", { texto: "." }), 1);
    b = balaoComFrame(b, f("turno.atividade", { id: "a1", rotulo: "Publicou", emUso: { texto: "Publicando", frentes: false } }), 2);
    b = balaoComFrame(b, f("turno.delta", { texto: "O chip da J2-1 agora mostra Urgente." }), 3);
    expect(b.resposta).toBe("Vou republicar a v5.\n\nO chip da J2-1 agora mostra Urgente.");
  });
});

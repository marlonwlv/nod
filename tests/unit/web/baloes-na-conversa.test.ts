import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto, type AtividadeTurno } from "../../../web/lib/atividade.ts";
import { planoDoMorph } from "../../../web/lib/morph.ts";
import { blocosAoVivo, renderMensagem } from "../../../web/telas/conversa.ts";

/**
 * NOD-358 (emenda da ADR-114) revista em 2026-11-12 (COP-14, itens 2 e 4): a resposta do bot é um balão só; ao vivo, a
 * conversa mostra só o indicador e a resposta entra inteira quando o turno acaba.
 */

const C = "c1";
const AGORA = Date.parse("2026-10-26T03:00:00Z");
const msg = (id: string, autor: "pessoa" | "agente", texto: string, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000, ...extra,
} as Mensagem);

function cenario(mensagens: Mensagem[]): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never };
}

const conta = (html: string, trecho: string | RegExp): number => html.split(trecho).length - 1;
const RESPOSTA = "Fechei a revisão.\n\nFaltam quatro coisas para sexta:\n\n- deploy\n- teste\n- doc\n- aviso\n\nTe aviso quando sair.";
const RESPOSTA_LONGA = `Fechei a revisão ${"de todos os pontos levantados na reunião de ontem com o time. ".repeat(5)}\n\nFaltam quatro coisas para sexta:\n\n- deploy\n- teste\n- doc\n- aviso\n\nTe aviso quando sair.`;

describe("a fala gravada", () => {
  it("COP-14 (item 4): um balão só, sem divisão por parágrafo; mascote, nome e hora uma vez; o nome para o leitor de tela", () => {
    const html = renderMensagem(msg("m1", "agente", RESPOSTA), cenario([]));
    expect(conta(html, 'class="bubble"')).toBe(1);
    expect(html).not.toContain("data-balao");
    expect(conta(html, "<nod-mascote")).toBe(1);
    expect(conta(html, 'class="msg-autor"')).toBe(1);
    expect(conta(html, "<time>")).toBe(1);
    expect(conta(html, "data-mensagem=")).toBe(1);
    expect(html).toContain('<span class="sr-only">Mensagem de Ada</span>');
    const balao = html.slice(html.indexOf('class="bubble"'));
    expect(balao).toContain("Fechei a revisão.");
    expect(balao).toContain('<ul class="md-lista">');
    expect(balao).toContain("Te aviso quando sair.");
  });

  it("um parágrafo só: o mesmo balão, sem data-balao", () => {
    const html = renderMensagem(msg("m1", "agente", "Pronto, está no ar."), cenario([]));
    expect(html).toContain('<div class="bubble">Pronto, está no ar.</div>');
    expect(html).not.toContain("data-balao");
  });

  it("as tags da fala vão dentro do balão único", () => {
    const html = renderMensagem(msg("m1", "agente", "Um.\n\nDois.", { parcial: true }), cenario([]));
    expect(conta(html, 'class="bubble"')).toBe(1);
    expect(conta(html, 'class="meta-tags"')).toBe(1);
    expect(html.indexOf('class="meta-tags"')).toBeGreaterThan(html.indexOf('class="bubble"'));
  });

  it("COP-14 (item 2): sem o resumo \"Pensou por / Usou N ferramentas\" na fala gravada", () => {
    const payload = { kind: "acoes_do_turno", acoes: [{ rotulo: "Consultou Linear" }], duracaoMs: 4000 };
    const html = renderMensagem(msg("m1", "agente", "Pronto.", { payload } as never), cenario([]));
    expect(html).not.toContain('class="pensar');
    expect(html).not.toMatch(/Pensou por|Usou \d+ ferramenta/);
  });

  it("a fala da pessoa não se divide", () => {
    const html = renderMensagem(msg("m1", "pessoa", "Um.\n\nDois."), cenario([]));
    expect(conta(html, 'class="bubble"')).toBe(1);
    expect(html).not.toContain("data-balao");
  });
});

describe("a fala viva (COP-14, item 2: só o indicador; a resposta entra inteira no fim)", () => {
  const comAtividade = (a: AtividadeTurno, encerrado = false): ReturnType<typeof blocosAoVivo> => {
    const base = cenario([msg("m0", "pessoa", "oi")]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: a } } };
    const fim = encerrado ? reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA }) : e;
    return blocosAoVivo(fim.conversas[C]!, fim);
  };
  const vivo = (texto: string): ReturnType<typeof blocosAoVivo>[number] => comAtividade(comTexto(ATIVIDADE_VAZIA, texto))[0]!;

  it("enquanto o texto chega, nada dele aparece: o indicador diz \"Digitando…\", sem balão, e o morph não troca nada", () => {
    let antes: ReturnType<typeof vivo> | undefined;
    for (let n = 1; n <= RESPOSTA_LONGA.length; n += 7) {
      const agora = vivo(RESPOSTA_LONGA.slice(0, n));
      expect(agora.morfar!.partes.map((p) => p.chave)).toEqual(["rotulo-digitando"]);
      expect(agora.html).not.toMatch(/class="bubble[ "]/);
      expect(agora.html).not.toContain("Fechei");
      expect(agora.html).toContain('<span class="indicador-rotulo" data-parte="rotulo-digitando">Digitando…</span>');
      expect(agora.html).toContain('aria-label="Ada está digitando"');
      if (antes) expect(planoDoMorph(antes.morfar, agora.morfar)!.partes.every((p) => p.html === null)).toBe(true);
      antes = agora;
    }
    expect(conta(antes!.html, "<nod-mascote")).toBe(1);
    expect(antes!.html).toMatch(/<nod-mascote[^>]* sm"/);
  });

  it("com ferramenta, o indicador diz o verbo dela (com brilho); a narração e o pensamento não aparecem", () => {
    const a = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Vou olhar o Linear.\n\nJá volto com a lista."), "Consultou Linear", { texto: "Usando Linear", frentes: false });
    const b = comAtividade(a)[0]!;
    expect(b.morfar!.partes.map((p) => p.chave)).toEqual(["rotulo-ferramenta:Usando Linear"]);
    expect(b.html).toContain('<span class="indicador-rotulo brilho" data-parte="rotulo-ferramenta:Usando Linear">Usando Linear</span>');
    expect(b.html).toContain('aria-live="polite"');
    expect(b.html).toContain('aria-label="Ada está usando Linear"');
    expect(b.html).not.toContain("Vou olhar");
    expect(b.html).not.toContain('class="pensar');
    expect(b.html).not.toContain("fala-narracao");
  });

  it("no fim do turno, a resposta entra inteira num balão só, com a chave saindo:", () => {
    const blocos = comAtividade(comTexto(ATIVIDADE_VAZIA, RESPOSTA_LONGA), true);
    expect(blocos.map((b) => b.chave)).toEqual(["saindo:t1"]);
    const html = blocos[0]!.html;
    expect(html).toContain('<article class="message bot fala-chegou" data-turno="t1">');
    expect(conta(html, /class="bubble[ "]/)).toBe(1);
    expect(html).toContain('class="bubble balao-chega"');
    expect(html).not.toContain("data-balao");
    expect(html).toContain('<span class="sr-only">Mensagem de Ada</span>');
    expect(html).toContain("Te aviso quando sair.");
    expect(html).not.toContain("<nod-mascote");
  });

  it("no fim do turno sem texto, nenhum bloco", () => {
    expect(comAtividade(ATIVIDADE_VAZIA, true)).toEqual([]);
  });

  it("revisão 4 do PR #522: as duas tabelas do balão que chegou têm chaves de texto diferentes", () => {
    const tabela = `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| ${i} | x |`).join("\n")}`;
    const html = comAtividade(comTexto(ATIVIDADE_VAZIA, `Um.\n\n${tabela}\n\nDois.\n\n${tabela}`), true)[0]!.html;
    const chaves = [...html.matchAll(/data-disclosure="(tabela:[^"]+)"/g)].map((m) => m[1]);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(2);
  });

  it("revisão 2 do PR #522: o balão que chegou mostra o texto inteiro, sem esconder o começo indeciso do fim", () => {
    const html = comAtividade(comTexto(ATIVIDADE_VAZIA, "- a\n- b\n\n-"), true)[0]!.html;
    expect(conta(html, /class="bubble[ "]/)).toBe(1);
    expect(html).toMatch(/<\/ul>.*-/s);
  });
});

describe("revisão 5 do PR #522: a fala gravada", () => {
  it("revisão 6: o balão 0 usa a chave da mensagem (a tabela dele guarda o mostrar mais de antes)", () => {
    const tabela = `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| ${i} | x |`).join("\n")}`;
    const html = renderMensagem(msg("m1", "agente", `${tabela}\n\nDois.`), cenario([]));
    expect(html).toContain('data-disclosure="tabela:m1:0"');
  });

  it("cada tabela tem a sua chave de texto", () => {
    const tabela = `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| ${i} | x |`).join("\n")}`;
    const html = renderMensagem(msg("m1", "agente", `Um.\n\n${tabela}\n\nDois.\n\n${tabela}`), cenario([]));
    const chaves = [...html.matchAll(/data-disclosure="([^"]+)"/g)].map((m) => m[1]);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(2);
  });
});

describe("CSS", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
  it("o balão tem a largura do texto, 6 px entre eles e, com menos movimento, não anima", () => {
    expect(css).toContain(".bubble-wrap > .bubble[data-balao]:not(.com-progresso) { width: fit-content;");
    expect(css).toContain(".bubble-wrap > .bubble[data-balao] + .bubble[data-balao] { margin-top: 6px; }");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.bubble\.balao-entra \{ animation: none; \} \}/);
    // Revisão 2 do PR #522: a regra da animação tem a mesma especificidade da de menos movimento, que vem depois e ganha.
    const anima = css.indexOf(".bubble.balao-entra { animation: balao-entra");
    expect(anima).toBeGreaterThan(-1);
    expect(css.indexOf("@media (prefers-reduced-motion: reduce) { .bubble.balao-entra { animation: none; } }")).toBeGreaterThan(anima);
    expect(css).not.toContain("data-trocada");
  });
});

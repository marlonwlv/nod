import { describe, expect, it } from "vitest";
import { comGrupos, posicoesDosGrupos, remetenteDoBloco } from "../../../web/telas/grupos-do-chat.ts";
import { botoesDoCampo, rotuloDoIndicador, verboDaFerramenta, CUIDANDO_MS } from "../../../web/telas/conversa.ts";
import { ATIVIDADE_VAZIA, type AtividadeTurno } from "../../../web/lib/atividade.ts";
import { PAUSA_QUE_ABRE_BLOCO_MS, htmlDivisor } from "../../../web/telas/divisores-de-data.ts";

const voce = (id: string) => ({ chave: id, html: `<article class="message you balao-c-blue" data-mensagem="${id}"><div class="bubble">oi</div></article>` });
const bot = (id: string) => ({ chave: id, html: `<article class="message bot" data-mensagem="${id}"><div class="bubble">oi</div></article>` });
const sep = { chave: "sep", html: `<div class="time-sep" role="separator">Hoje 14:32</div>` };

describe("COP-14 item 3: agrupamento dos balões", () => {
  it("posições: sozinho, primeiro, meio e último por remetente", () => {
    expect(posicoesDosGrupos(["you", "you", "you", "bot", null, "bot"])).toEqual(["primeiro", "meio", "ultimo", "sozinho", null, "sozinho"]);
  });
  it("o separador de hora e o cartão quebram o grupo; só o primeiro leva data-group-start", () => {
    const blocos = comGrupos([voce("a"), voce("b"), sep, voce("c"), bot("d"), bot("e")]);
    expect(blocos[0]!.html).toContain('data-grupo="primeiro" data-group-start');
    expect(blocos[1]!.html).toContain('data-grupo="ultimo"');
    expect(blocos[1]!.html).not.toContain("data-group-start");
    expect(blocos[2]!.html).toBe(sep.html);
    expect(blocos[3]!.html).toContain('data-grupo="sozinho" data-group-start');
    expect(blocos[4]!.html).toContain('data-grupo="primeiro"');
    expect(blocos[5]!.html).toContain('data-grupo="ultimo"');
  });
  it("a fala pendente agrupa com a gravada de cima; cartão e artefato não são balão", () => {
    const pendente = { chave: "p", html: `<div class="fala-pendente" data-envio="enviando"><article class="message you"><div class="bubble">de novo</div></article></div>` };
    const [a, p] = comGrupos([voce("a"), pendente]);
    expect(a!.html).toContain('data-grupo="primeiro"');
    expect(p!.html).toContain('<div class="fala-pendente" data-envio="enviando"><article data-grupo="ultimo" class="message you"');
    expect(remetenteDoBloco(`<article class="message bot com-artefato">`)).toBeNull();
    expect(remetenteDoBloco(`<article class="message bot pergunta">`)).toBeNull();
  });
});

describe("COP-14 item 2: o rótulo do indicador", () => {
  const t = { desde: 1_000 };
  const com = (x: Partial<AtividadeTurno>): AtividadeTurno => ({ ...ATIVIDADE_VAZIA, ...x });
  it("começou: Cuidando disso; depois de um tempo sem nada, Refletindo", () => {
    expect(rotuloDoIndicador(t, undefined, 1_500, null, null)).toMatchObject({ texto: "Cuidando disso", brilho: true });
    expect(rotuloDoIndicador(t, undefined, 1_000 + CUIDANDO_MS, null, null)).toMatchObject({ texto: "Refletindo", state: "thinking" });
  });
  it("ferramenta: o verbo curto; texto chegando: Digitando… sem brilho", () => {
    expect(rotuloDoIndicador(t, com({ emUso: { texto: "Rodando um comando", frentes: false } }), 1_500, null, null).texto).toBe("Rodando no terminal");
    expect(rotuloDoIndicador(t, com({ emUso: { texto: "Usando Gmail", frentes: false } }), 1_500, null, null).texto).toBe("Usando Gmail");
    expect(rotuloDoIndicador(t, com({ atual: "Oi" }), 1_500, null, null)).toMatchObject({ texto: "Digitando…", brilho: false });
    expect(verboDaFerramenta("Procurando nos arquivos")).toBe("Pesquisando no código");
  });
  it("esperando a pessoa e o silêncio do vigia", () => {
    expect(rotuloDoIndicador(t, undefined, 1_500, "Esperando sua aprovação", null).texto).toBe("Esperando sua aprovação");
    expect(rotuloDoIndicador(t, undefined, 1_500, null, 3).texto).toBe("Ainda trabalhando · 3 min");
  });
});

describe("COP-14 item 1: um botão à direita do campo", () => {
  it("com texto, Enviar mesmo trabalhando; vazio e trabalhando, Parar; vazio e parado, Enviar", () => {
    expect(botoesDoCampo({ trabalhando: true, temConteudo: true, ditando: false })).toEqual({ enviar: true, parar: false });
    expect(botoesDoCampo({ trabalhando: true, temConteudo: false, ditando: false })).toEqual({ enviar: false, parar: true });
    expect(botoesDoCampo({ trabalhando: false, temConteudo: false, ditando: false })).toEqual({ enviar: true, parar: false });
  });
});

describe("COP-14 item 0: o separador de hora", () => {
  it("abre a cada 15 min e leva o dia", () => {
    expect(PAUSA_QUE_ABRE_BLOCO_MS).toBe(15 * 60_000);
    const agora = new Date(2026, 10, 12, 14, 40).getTime();
    expect(htmlDivisor(new Date(2026, 10, 12, 14, 32).getTime(), agora, false)).toContain(">Hoje 14:32<");
  });
});

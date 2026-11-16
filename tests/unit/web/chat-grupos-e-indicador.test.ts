import { describe, expect, it } from "vitest";
import { comGrupos, posicoesDosGrupos, remetenteDoBloco } from "../../../web/telas/grupos-do-chat.ts";
import { botoesDoCampo, estadoVivoDoServidor, rotuloDoIndicador } from "../../../web/telas/conversa.ts";
import { estadoDoIndicador, rotuloComPermanencia, varianteDaVez, verboDaFerramenta, VARIANTES_TRABALHANDO, type EstadoVivoDoBot } from "../../../web/lib/estado-do-indicador.ts";
import { escreverVariantes } from "../../../web/lib/fala-viva.ts";
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

describe("COP-14 item 2: a função única do estado do indicador", () => {
  const base: EstadoVivoDoBot = { rodando: true, compondo: false, atividade: null, aguardando: null, desfecho: null };
  it("rodando: compondo → Digitando… sem brilho; thinking → Refletindo (3 a cada 2,5 s); sem atividade → Trabalhando (5 a cada 5 s)", () => {
    expect(estadoDoIndicador({ ...base, compondo: true }, 0)).toMatchObject({ texto: "Digitando…", brilho: false });
    expect(estadoDoIndicador({ ...base, atividade: { tipo: "thinking" } }, 0)).toMatchObject({ texto: "Refletindo", periodoMs: 2_500, state: "thinking" });
    expect(estadoDoIndicador({ ...base, atividade: { tipo: "thinking" } }, 0)?.variantes).toHaveLength(3);
    const t = estadoDoIndicador(base, 0)!;
    expect(t).toMatchObject({ texto: "Trabalhando", periodoMs: 5_000 });
    expect(t.variantes).toHaveLength(5);
    expect(varianteDaVez(t, 1_000, 1_000 + 5_000)).toBe(VARIANTES_TRABALHANDO[1]);
    expect(varianteDaVez(t, 1_000, 1_000 + 25_000)).toBe(VARIANTES_TRABALHANDO[0]);
  });
  it("ferramenta: o verbo curto", () => {
    expect(estadoDoIndicador({ ...base, atividade: { tipo: "ferramenta", rotulo: "Rodando um comando" } }, 0)?.texto).toBe("Rodando no terminal");
    expect(estadoDoIndicador({ ...base, atividade: { tipo: "ferramenta", rotulo: "Usando Gmail" } }, 0)?.texto).toBe("Usando Gmail");
    expect(verboDaFerramenta("Procurando nos arquivos")).toBe("Pesquisando no código");
  });
  it("depois de rodar: aguardando → desfecho por menos de 8 s → parado (null)", () => {
    expect(estadoDoIndicador({ ...base, rodando: false, aguardando: "aprovacao" }, 0)?.texto).toBe("Esperando sua aprovação");
    expect(estadoDoIndicador({ ...base, rodando: false, aguardando: "resposta" }, 0)?.texto).toBe("Esperando sua resposta");
    const desfecho = { ...base, rodando: false, desfecho: { tipo: "parou" as const, em: 1_000 } };
    expect(estadoDoIndicador(desfecho, 1_000 + 7_999)?.texto).toBe("Parou");
    expect(estadoDoIndicador(desfecho, 1_000 + 8_000)).toBeNull();
    expect(estadoDoIndicador({ ...base, rodando: false }, 0)).toBeNull();
  });
  it("cada rótulo fica no mínimo 800 ms; o novo espera como pendente", () => {
    const a = estadoDoIndicador(base, 0)!;
    const b = estadoDoIndicador({ ...base, compondo: true }, 0)!;
    const p1 = rotuloComPermanencia(undefined, a, 1_000);
    expect(p1).toEqual({ atual: { rotulo: a, desde: 1_000 }, pendente: null });
    expect(rotuloComPermanencia(p1.atual, b, 1_799)).toEqual({ atual: p1.atual, pendente: b });
    expect(rotuloComPermanencia(p1.atual, b, 1_800)).toEqual({ atual: { rotulo: b, desde: 1_800 }, pendente: null });
    expect(rotuloComPermanencia(p1.atual, a, 5_000).atual.desde).toBe(1_000);
  });
  it("o adaptador de hoje: texto chegando = compondo; ferramenta em uso; já fez algo = thinking; nada = sem atividade", () => {
    const com = (x: Partial<AtividadeTurno>): AtividadeTurno => ({ ...ATIVIDADE_VAZIA, ...x });
    expect(rotuloDoIndicador(com({ atual: "Oi" }), null, 0)?.texto).toBe("Digitando…");
    expect(rotuloDoIndicador(com({ emUso: { texto: "Usando Gmail", frentes: false } }), null, 0)?.texto).toBe("Usando Gmail");
    expect(rotuloDoIndicador(com({ acoes: [{ id: "1", rotulo: "Leu", estado: "feita", emUso: null }] }), null, 0)?.texto).toBe("Refletindo");
    expect(rotuloDoIndicador(undefined, null, 0)?.texto).toBe("Trabalhando");
    // A ferramenta acabou e o `emUso` ficou com ela (até o próximo texto ou ferramenta): o bot está pensando de novo.
    const acabou = com({ emUso: { texto: "Usando Gmail", frentes: false }, acoes: [{ id: "1", rotulo: "Usou Gmail", estado: "feita", emUso: null }] });
    expect(rotuloDoIndicador(acabou, null, 0)?.texto).toBe("Refletindo");
    expect(rotuloDoIndicador(undefined, "Esperando sua aprovação", 0)?.texto).toBe("Esperando sua aprovação");
  });
  it("o retrato do servidor mapeia ferramenta, espera e desfecho sem depender dos deltas", () => {
    const baseServidor = { agenteId: "a", rodando: true, compondo: false, atividade: { tipo: "ferramenta" as const, ferramenta: "Bash", detalhe: "Rodando no terminal" }, aguardando: null, subagentes_rodando: 1, ultimo_desfecho: null, vence_em: null, turnoId: "t", conversaId: "c", em: 10 };
    expect(estadoVivoDoServidor(baseServidor)).toMatchObject({ atividade: { tipo: "ferramenta", rotulo: "Rodando no terminal", frentes: true } });
    expect(estadoVivoDoServidor({ ...baseServidor, rodando: false, atividade: null, aguardando: { motivo: "segredo", desde: 9 } }).aguardando).toBe("resposta");
    expect(estadoVivoDoServidor({ ...baseServidor, rodando: false, atividade: null, ultimo_desfecho: { resultado: "error", em: 10, falha: "timeout" } }).desfecho).toEqual({ tipo: "falhou", em: 10 });
  });
  it("o relógio troca a variante no lugar", () => {
    const el = { textContent: "Refletindo", getAttribute: (n: string) => ({ "data-variantes": "Refletindo|Pensando|Ponderando", "data-periodo": "2500", "data-variantes-desde": "0" } as Record<string, string>)[n] ?? null };
    expect(escreverVariantes({ querySelectorAll: () => [el] }, 2_600)).toBe(1);
    expect(el.textContent).toBe("Pensando");
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { OPCOES_BOAS_VINDAS, PERGUNTA_BOAS_VINDAS } from "../../../src/domain/boas-vindas.ts";
import { cartaoDeBoasVindas, faseDasBoasVindas, htmlRefletindo, linhaDasBoasVindas, OPCOES_PADRAO, PERGUNTA_PADRAO, PLACEHOLDER_DA_PERGUNTA } from "../../../web/telas/boas-vindas.ts";

/**
 * Spec do botão + (telas 4 e 5): depois de criar o bot interativo, ele reflete até a conversa chegar e então fala primeiro,
 * com o cartão "Para que você quer minha ajuda?". O relógio segura as telas 3 e 4 mesmo quando a API responde rápido.
 */
type M = Pick<Mensagem, "kind" | "payload" | "autoria">;
const msg = (autor: "agente" | "pessoa", payload: Mensagem["payload"] = null): M => ({ kind: "texto", payload, autoria: { autor_tipo: autor } } as M);
const BOAS_VINDAS = msg("agente", { kind: "boas_vindas", pergunta: PERGUNTA_BOAS_VINDAS, opcoes: [...OPCOES_BOAS_VINDAS] });
const BOT = { nome: "Bia", cor: "c-teal", forma: "shape-star" } as const;

describe("faseDasBoasVindas", () => {
  it("telas 3 e 4: a conversa nasce vazia e depois o bot reflete; outro bot sem conversa, não", () => {
    expect(faseDasBoasVindas(undefined, { recemCriado: true, confirmado: false })).toBe("vazia");
    expect(faseDasBoasVindas(undefined, { recemCriado: true, confirmado: false, decorridoMs: 2_100 })).toBe("pensando");
    expect(faseDasBoasVindas(undefined, { recemCriado: false, confirmado: false })).toBeNull();
  });

  it("tela 5: com a fala boas_vindas e nada da pessoa, a pergunta está aberta", () => {
    expect(faseDasBoasVindas({ mensagens: [BOAS_VINDAS] }, { recemCriado: true, confirmado: false, decorridoMs: 2_100 })).toBe("pensando");
    expect(faseDasBoasVindas({ mensagens: [BOAS_VINDAS] }, { recemCriado: true, confirmado: false, decorridoMs: 6_300 })).toBe("pergunta");
    expect(faseDasBoasVindas({ mensagens: [BOAS_VINDAS] }, { recemCriado: false, confirmado: false })).toBe("pergunta");
  });

  it("a primeira mensagem da pessoa encerra; o bot confirmado e a conversa sem boas-vindas não perguntam", () => {
    expect(faseDasBoasVindas({ mensagens: [BOAS_VINDAS, msg("pessoa")] }, { recemCriado: false, confirmado: false })).toBeNull();
    expect(faseDasBoasVindas({ mensagens: [BOAS_VINDAS] }, { recemCriado: false, confirmado: true })).toBeNull();
    // A conversa chegou sem a fala (servidor de antes): não fica pensando para sempre.
    expect(faseDasBoasVindas({ mensagens: [msg("agente")] }, { recemCriado: true, confirmado: false, decorridoMs: 6_300 })).toBeNull();
  });
});

describe("linhaDasBoasVindas (a linha da barra)", () => {
  it("pensando: avatar nas três bolinhas e sem prévia", () => {
    expect(linhaDasBoasVindas("pensando", "Bia")).toEqual({ pensando: true, semPrevia: true, naoLida: false, rotulo: null });
  });
  it("pergunta: o ponto de não lido mesmo aberta, com o rótulo da spec", () => {
    expect(linhaDasBoasVindas("pergunta", "Bia")).toEqual({ pensando: false, semPrevia: false, naoLida: true, rotulo: "Bia, atividade não lida" });
  });
  it("fora das fases, a linha de sempre", () => {
    expect(linhaDasBoasVindas(null, "Bia")).toEqual({ pensando: false, semPrevia: false, naoLida: false, rotulo: null });
  });
});

describe("htmlRefletindo (tela 4)", () => {
  const agora = new Date(2026, 10, 13, 9, 12).getTime();
  const h = htmlRefletindo(BOT, agora, agora);
  it("o divisor de hoje e, à esquerda, o mascote pensando na cor do bot com \"Refletindo\" e o brilho da fala viva", () => {
    expect(h).toContain('<div class="time-sep" role="separator" aria-label="Hoje 9:12">Hoje 9:12</div>');
    expect(h).toMatch(/<article class="message bot fala-viva bv-pensando c-teal" role="status" aria-label="Bia está refletindo">/);
    expect(h).toMatch(/<nod-mascote [^>]*data-estado="pensando" state="thinking"/);
    expect(h).toContain('<span class="fala-viva-estado" aria-hidden="true">Refletindo</span>');
  });
  it("sem saudação nem cartão ainda", () => {
    expect(h).not.toContain("Acabamos de nos conhecer");
    expect(h).not.toContain("bv-cartao");
  });
});

describe("cartaoDeBoasVindas (tela 5)", () => {
  const p = BOAS_VINDAS.payload?.kind === "boas_vindas" ? BOAS_VINDAS.payload : { kind: "boas_vindas" as const };
  const h = cartaoDeBoasVindas(p, "m1");

  it("o título é a pergunta; as opções A, B e C mandam o texto delas", () => {
    expect(h).toContain('<h2 class="bv-titulo" id="bv-t-m1">Para que você quer minha ajuda?</h2>');
    expect(h).toContain('aria-labelledby="bv-t-m1"');
    const opcoes = [...h.matchAll(/<button type="button" class="bv-opcao" data-act="escolher-missao" data-texto="([^"]*)"><span class="bv-tecla" aria-hidden="true">(\w)<\/span><span class="bv-rotulo">([^<]*)<\/span>/g)];
    expect(opcoes.map((m) => [m[2], m[3]])).toEqual([["A", "Tarefas do dia a dia"], ["B", "Trabalho e projetos"], ["C", "Pesquisa e ideias"]]);
    expect(opcoes[0]?.[1]).toBe("Quero ajuda com tarefas do dia a dia: lembretes e organização.");
  });

  it("a última, D, é \"Outra coisa\" como campo livre", () => {
    expect(h).toMatch(/<label class="bv-opcao bv-outra"><span class="bv-tecla" aria-hidden="true">D<\/span><input type="text" class="bv-outra-campo" placeholder="Outra coisa"/);
  });

  it("escapa o que vem do payload", () => {
    const x = cartaoDeBoasVindas({ kind: "boas_vindas", pergunta: "<b>?", opcoes: [{ rotulo: "<img>", texto: '"x"' }] }, "m2");
    expect(x).not.toMatch(/<b>\?|<img>|data-texto=""x""/);
  });

  it("a fala gravada antes, sem pergunta nem opções no payload, mostra a pergunta e as opções de sempre", () => {
    expect(cartaoDeBoasVindas({ kind: "boas_vindas" }, "m3")).toBe(cartaoDeBoasVindas(p, "m3"));
  });

  it("o espelho da web confere com o domínio (a web não importa src/domain)", () => {
    expect(PERGUNTA_PADRAO).toBe(PERGUNTA_BOAS_VINDAS);
    expect(OPCOES_PADRAO).toEqual(OPCOES_BOAS_VINDAS);
  });
});

describe("main.ts liga as fases à barra, ao chat e ao campo", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");

  it("o diálogo e o segurar marcam o bot recém-criado; só a conversa aberta dele pensa", () => {
    expect(main.match(/botRecemCriado = \{ agenteId(: r\.agente\.id)?, em: Date\.now\(\) \};/g)).toHaveLength(2);
    expect(main).toContain('const recemCriado = botRecemCriado?.agenteId === a.id && t.tipo === "conversa" && t.agenteId === a.id;');
  });

  it("a linha: pensando sem prévia; com a pergunta aberta, não lida mesmo aberta", () => {
    expect(main).toContain('temNovas(a.conversaId, estado) || boasVindas.get(a.id)?.naoLida ? "nao-lido" : ""');
    expect(main).toContain('const estadoVisual = bv?.pensando ? "pensando" : mascoteComAviso(mascote, aviso);');
    expect(main).toContain('bv?.semPrevia ? "<span></span>"');
    expect(main).toContain("aria-label=\"${bv?.rotulo ? esc(bv.rotulo) :");
  });

  it("o chat reflete no lugar do carregando; o placeholder responde ao cartão; Enter no \"Outra coisa\" responde", () => {
    expect(main).toContain('if (fase === "vazia") { partes = null; corpo = \'<div class="timeline"></div>\'; }');
    expect(main).toContain('else if (bot && botRecemCriado && fase === "pensando") { partes = null; corpo = htmlRefletindo(bot, botRecemCriado.em, Date.now()); }');
    expect(main).toContain('if (bot && faseDasBoasVindasDe(bot) === "pergunta") return PLACEHOLDER_DA_PERGUNTA;');
    expect(PLACEHOLDER_DA_PERGUNTA).toBe("Digite sua resposta ou fale sobre outra coisa");
    expect(main).toMatch(/classList\?\.contains\("bv-outra-campo"\)\) \{\n\s+ev\.preventDefault\(\);\n\s+if \(ta\.value\.trim\(\)\) void responderBoasVindas\(ta\.value\.trim\(\)\);/);
  });
});

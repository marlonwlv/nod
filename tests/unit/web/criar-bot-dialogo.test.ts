import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORMAS_DO_SELETOR, NOME_MAX, ORDEM_DAS_CORES, criarMemoriaDaAparencia, emLinhas, htmlCoresDoDialogo, htmlDialogoCriarBot, htmlFormasDoDialogo, nomeDoBotValido, sortearAparencia } from "../../../web/telas/criar-bot.ts";
import { ACOES_DA_PALETA } from "../../../web/lib/paleta.ts";

/** Spec do botão + (telas 1 a 5): o diálogo "Criar novo bot" — as partes puras e a ligação no main.ts. */

/** Uma sequência fixa no lugar do Math.random. */
const sequencia = (...valores: number[]): (() => number) => {
  let i = 0;
  return () => valores[i++ % valores.length] ?? 0;
};

describe("forma e cor do diálogo", () => {
  it("as 12 cores na ordem da spec: preto, marrom, vermelho, laranja, âmbar, verde / turquesa, azul, violeta, rosa, cinza, creme", () => {
    expect(ORDEM_DAS_CORES).toEqual(["c-black", "c-brown", "c-red", "c-orange", "c-amber", "c-green", "c-teal", "c-blue", "c-purple", "c-pink", "c-gray", "c-cream"]);
    expect(emLinhas(ORDEM_DAS_CORES, [6, 6]).map((l) => l.length)).toEqual([6, 6]);
  });

  it("as 8 formas do nod em linhas de 5 + 3", () => {
    expect(FORMAS_DO_SELETOR).toHaveLength(8);
    expect(emLinhas(FORMAS_DO_SELETOR, [5, 3])).toEqual([FORMAS_DO_SELETOR.slice(0, 5), FORMAS_DO_SELETOR.slice(5)]);
  });

  it("o sorteio escolhe entre as formas e as cores do seletor (nos dois extremos do aleatório)", () => {
    expect(sortearAparencia(sequencia(0, 0))).toEqual({ forma: FORMAS_DO_SELETOR[0], cor: ORDEM_DAS_CORES[0] });
    expect(sortearAparencia(sequencia(0.9999, 0.9999))).toEqual({ forma: FORMAS_DO_SELETOR.at(-1), cor: ORDEM_DAS_CORES.at(-1) });
    expect(sortearAparencia(sequencia(0.5, 0.25))).toEqual({ forma: FORMAS_DO_SELETOR[4], cor: ORDEM_DAS_CORES[3] });
  });

  it("sorteia na 1ª abertura da sessão; reabrir mantém a última escolha (e não sorteia de novo)", () => {
    let sorteios = 0;
    const memoria = criarMemoriaDaAparencia(() => { sorteios++; return 0.5; });
    const primeira = memoria.atual();
    expect(primeira).toEqual({ forma: FORMAS_DO_SELETOR[4], cor: ORDEM_DAS_CORES[6] });
    expect(memoria.atual()).toEqual(primeira);
    memoria.lembrar({ forma: "shape-drop", cor: "c-pink" });
    expect(memoria.atual()).toEqual({ forma: "shape-drop", cor: "c-pink" });
    expect(sorteios).toBe(2);
  });
});

describe("nome do bot", () => {
  it("vazio ou só espaços não cria; até NOME_MAX cria", () => {
    expect(nomeDoBotValido("")).toBe(false);
    expect(nomeDoBotValido("   ")).toBe(false);
    expect(nomeDoBotValido(" Lia ")).toBe(true);
    expect(nomeDoBotValido("a".repeat(NOME_MAX))).toBe(true);
    expect(nomeDoBotValido("a".repeat(NOME_MAX + 1))).toBe(false);
  });
});

describe("o HTML do diálogo (tela 1)", () => {
  const html = htmlDialogoCriarBot({ nome: "", forma: "shape-pebble", cor: "c-teal" });

  it("título, X, campo, grupos e rodapé com os rótulos da spec", () => {
    expect(html).toContain('<h2 id="cnb-titulo">Criar novo bot</h2>');
    expect(html).toContain('aria-label="Fechar caixa de diálogo"');
    expect(html).toContain('placeholder="Dê um nome ao seu bot" aria-label="Nome do bot"');
    expect(html).toContain('role="radiogroup" aria-label="Forma do personagem"');
    expect(html).toContain('role="radiogroup" aria-label="Cor do personagem"');
    expect(html).toMatch(/>Cancelar<\/button><button type="submit" class="cnb-bt cnb-criar" data-cb="criar" disabled>Criar</);
  });

  it("Criar fica desabilitado com o nome vazio e habilitado com nome", () => {
    expect(html).toContain('data-cb="criar" disabled');
    expect(htmlDialogoCriarBot({ nome: "Lia", forma: "shape-pebble", cor: "c-teal" })).not.toContain('data-cb="criar" disabled');
  });

  it("as formas pintadas na cor escolhida, com 'Forma {nome}' e a escolhida marcada", () => {
    const formas = htmlFormasDoDialogo("shape-hex", "c-red");
    expect(formas.match(/class="cnb-linha"/g)).toHaveLength(2);
    expect(formas.match(/role="radio"/g)).toHaveLength(8);
    expect(formas).toContain('aria-checked="true" tabindex="0" aria-label="Forma Hexágono" data-forma="shape-hex"');
    expect(formas.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(formas).toContain("c-red");
    expect(formas).not.toContain("c-teal");
  });

  it("as cores em 6 + 6, com 'Cor {nome}' e a escolhida marcada", () => {
    const cores = htmlCoresDoDialogo("c-amber");
    expect(cores.match(/class="cnb-linha"/g)).toHaveLength(2);
    expect(cores.match(/role="radio"/g)).toHaveLength(12);
    expect(cores).toContain('aria-checked="true" tabindex="0" aria-label="Cor Âmbar" data-cor="c-amber"');
  });

  it("tela 2: Criando… desabilita todos os controles", () => {
    const criando = htmlDialogoCriarBot({ nome: "Lia", forma: "shape-pebble", cor: "c-teal", criando: true });
    expect(criando).toContain(">Criando…</button>");
    expect(criando).not.toContain(">Criar</button>");
    // X, campo, 8 formas, 12 cores, Cancelar e Criar
    expect(criando.match(/ disabled/g)).toHaveLength(1 + 1 + 8 + 12 + 1 + 1);
  });

  it("o nome é escapado", () => {
    expect(htmlDialogoCriarBot({ nome: '"><img>', forma: "shape-pebble", cor: "c-teal" })).not.toContain("<img>");
  });
});

describe("ligação no app", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");

  it("o + abre o diálogo no clique e cria na hora no segurar; o tooltip diz os dois", () => {
    expect(main).toContain('data-act="novo-bot-dialogo" data-segurar="segurar-mais"');
    expect(main).toContain('title="Novo bot (${ATALHO_NOVO_BOT.texto}) · segure para criar na hora"');
    expect(main).not.toMatch(/class="create-trigger[^"]*" data-act="navegar" data-tela="novo-bot"/);
  });

  it("⌘N abre o diálogo (não a tela Nova conversa)", () => {
    const bloco = main.slice(main.indexOf('if (a.tipo === "novo-bot") {'), main.indexOf('if (a.tipo === "novo-bot") {') + 200);
    expect(bloco).toContain("abrirDialogoCriarBot()");
    expect(bloco).not.toContain('navegar({ tipo: "novo-bot" })');
  });

  it("o diálogo chama o mesmo criarAgente interativo do segurar, com nome, forma e cor", () => {
    expect(main).toContain("api!.criarAgente(nome, { interativo: true, forma, cor })");
    expect(main).toContain("api!.criarAgente(undefined, { interativo: true })");
  });

  it("a paleta ⌘K tem 'Novo bot' e 'Novo chat em grupo'", () => {
    expect(ACOES_DA_PALETA.find((a) => a.id === "novo-bot")?.titulo).toBe("Novo bot");
    expect(ACOES_DA_PALETA.find((a) => a.id === "nova-sala")?.titulo).toBe("Novo chat em grupo");
  });
});

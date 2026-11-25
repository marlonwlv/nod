import { describe, expect, it } from "vitest";
import type { AbaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import {
  ariaTecla, definirTecladoDoMac, tecla, textosDoAparelhoNaWeb, avisoDaAbaFechada, barraSoComAvatares, conversaEstreita,
  abasVisiveis, alturaDaFolha, avisoDoPedido, botNoMeio, caixaNaVista, dicaDaAbaDeLugar, duracaoDoCursor, estadoDaAbaDeLugar, estadoDaPilula, estadoDaTela, gravarLargura, htmlAbaDeLugar,
  htmlAvisoDoSite, htmlBarraDoNavegador, htmlBotaoDoCanto, htmlEstadoDaTela, htmlLinhaDoNavegador, htmlLugares, htmlLugaresFechados, lugarFechadoAMao, htmlMenuDoNavegador, htmlPilula, imantar, larguraMaxima, larguraPadrao,
  legendaDoPasso, lerLargura, limitarLargura, linhaDoNavegadorVisivel, modoDoPainel, MS_ASSUMINDO_VISIVEL, partesDoEndereco, pontoDoLugar, pontoNoViewport, proximoEncaixe,
  retanguloDaImagem, rotuloDaAprovacao, soltarFecha, soltarFolha, textoDoLugar,
  aoNome, aspasCurvas, causaCitaOLugar, comArtigo, deNome, quedaDaVista, subtituloDeEnsinar, fraseNoPassado,
} from "../../../web/lib/navegador-vista.ts";

/**
 * ADR-190 (Paper D1–D8): as regras puras da vista do navegador do bot — a pílula (D1b A, D4, A1), a barra (D2 A e B), os
 * estados da tela (D3), o letterbox e as coordenadas (D1 4), o painel (D5, D6), a aba de lugar (D7) e a linha de atividade.
 */
const aba = (x: Partial<AbaNavegador> = {}): AbaNavegador => ({ id: "t1", titulo: "Google Voos", url: "https://www.google.com/travel/flights?q=GRU-LIS", ativa: true, carregando: false, inseguro: false, ...x });
const vista = (x: Partial<VistaNavegador> = {}): VistaNavegador => ({
  agenteId: "a1", estado: "ao_vivo", controle: "bot", lugar: { tipo: "nod" }, abas: [aba()], aviso: null, passo: null, pedido: null, gravacao: null, descarte: null,
  segredoNaPagina: false, ofertaGuardar: null, atividadeEm: 1_000, erro: null, viewport: { w: 1280, h: 800 }, ...x,
});
const aprovacao = { tipo: "aprovacao" as const, decisaoId: "d1", pergunta: "Pagar R$ 3.780 na TAP?", botao: "pagar", classe: "pagar" as const, touchId: true, avisoTouchId: null, caixa: { x: 10, y: 20, w: 100, h: 40 }, lembrar: null };

describe("a pílula (D1b A, D4, A1)", () => {
  it("assistindo, assumindo só depois de 300 ms, controle, precisa, login e aprovação", () => {
    expect(estadoDaPilula(vista(), null, 0)).toBe("assistindo");
    expect(estadoDaPilula(vista(), 1_000, 1_000 + MS_ASSUMINDO_VISIVEL - 1)).toBe("assistindo");
    expect(estadoDaPilula(vista(), 1_000, 1_000 + MS_ASSUMINDO_VISIVEL)).toBe("assumindo");
    expect(estadoDaPilula(vista({ controle: "soltando" }), null, 0)).toBe("assumindo");
    expect(estadoDaPilula(vista({ controle: "pessoa" }), null, 0)).toBe("controle");
    expect(estadoDaPilula(vista({ controle: "precisa_de_voce" }), null, 0)).toBe("precisa");
    expect(estadoDaPilula(vista({ controle: "precisa_de_voce", pedido: { tipo: "login", decisaoId: "d", site: "itau.com.br", motivo: "fatura", opcoes: [], podeTrazerDoChrome: false, etapa: "eu_mesmo", erro: null } }), null, 0)).toBe("login");
    expect(estadoDaPilula(vista({ controle: "precisa_de_voce", pedido: aprovacao }), null, 0)).toBe("aprovacao");
  });

  it("os textos: Devolver à {nome} (não Parar), Já resolvi, Pronto, pode seguir, a pergunta e o Touch ID", () => {
    expect(htmlPilula("Nina", "assistindo")).toContain("Assistindo");
    expect(htmlPilula("Nina", "assistindo")).toContain('data-nv="assumir"');
    const controle = htmlPilula("Nina", "controle");
    expect(controle).toContain("Você está no controle");
    expect(controle).toContain("Devolver à Nina");
    expect(htmlPilula("Milton", "controle")).toContain("Devolver ao Milton");
    expect(controle).not.toContain("Parar");
    expect(htmlPilula("Nina", "assumindo")).toContain("disabled");
    expect(htmlPilula("Nina", "precisa")).toMatch(/Precisa de você.*Já resolvi.*Assumir o controle/s);
    // O pedido de ajuda já entrega o navegador (2026-11-21): "Precisa de você · Já resolvi", sem "Assumir".
    const ajuda = { tipo: "ajuda" as const, decisaoId: "d", motivo: "Resolver o CAPTCHA", codigo: false };
    expect(estadoDaPilula(vista({ controle: "pessoa", pedido: ajuda }), null, 0)).toBe("precisa");
    expect(htmlPilula("Nina", "precisa", ajuda)).toMatch(/Precisa de você.*Já resolvi/s);
    expect(htmlPilula("Nina", "precisa", ajuda)).not.toContain("Assumir o controle");
    expect(avisoDoPedido(vista({ controle: "pessoa", pedido: ajuda }))).toMatchObject({ tipo: "precisa_de_voce", texto: "Resolver o CAPTCHA" });
    expect(estadoDaAbaDeLugar(vista({ controle: "pessoa", pedido: ajuda }))).toBe("precisa");
    // 2026-11-22: parada 4 min no controle, a pílula avisa que volta sozinho.
    expect(htmlPilula("Ada", "controle", null, null, Date.now() + 60_000)).toContain("Volta à Ada em 1 min");
    expect(htmlPilula("Ada", "controle")).toContain("Você está no controle");
    expect(htmlLinhaDoNavegador("Nina", "a1", vista({ controle: "pessoa", pedido: ajuda }), { modoAbas: false })).toContain("precisa de você");
    expect(legendaDoPasso("Nina", vista({ controle: "pessoa", pedido: ajuda }), "aba")).toBe("Navegador da Nina · precisa de você");
    // D4 (Paper): com o artigo, como a pessoa fala.
    expect(htmlPilula("Nina", "login")).toMatch(/A Nina espera você entrar.*Pronto, pode seguir/s);
    expect(htmlPilula("Milton", "login")).toContain("O Milton espera você entrar");
    expect(htmlPilula("Nina", "assumindo")).toContain("A Nina está terminando um clique…");
    expect(controle).toContain('title="A Nina espera · ⌘⇧A devolve"');
    const ap = htmlPilula("Nina", "aprovacao", aprovacao);
    expect(ap).toMatch(/Pagar R\$ 3\.780 na TAP\?.*Não.*Pagar com Touch ID/s);
    expect(ap).toContain('data-nv="aprovar"');
    // A1 (Paper): o "sim" é o preto do cartão, não o azul de "Pronto, pode seguir".
    expect(ap).toContain('class="ctc-bt nv-aprovar" data-nv="aprovar"');
    expect(ap).not.toContain("nv-pilula-nota");
    // Ponto 14 dos cenários (22/11): a pergunta curta à vista; a inteira no title e no leitor de tela.
    expect(ap).toContain('<span aria-hidden="true">Posso pagar?</span><span class="sr-only">Pagar R$ 3.780 na TAP?</span>');
    // Sem o app do Mac, "Pagar sem Touch ID"; o aviso fica só no cartão (embaixo da pílula ele quebrava em duas linhas).
    expect(rotuloDaAprovacao({ ...aprovacao, touchId: false })).toBe("Pagar sem Touch ID");
    const semMac = htmlPilula("Nina", "aprovacao", { ...aprovacao, touchId: false, avisoTouchId: "Seu Mac está desligado: a confirmação vai só pelo botão, sem o Touch ID." });
    expect(semMac).toContain("Pagar sem Touch ID</button>");
    expect(semMac).not.toContain("Seu Mac está desligado");
    expect(rotuloDaAprovacao({ ...aprovacao, classe: "enviar", botao: "enviar", touchId: false })).toBe("Enviar");
  });

  it("escapa o nome do bot", () => {
    expect(htmlPilula("<b>", "controle")).toContain("Devolver ao &lt;b&gt;");
  });
});

describe("a barra do navegador (D2, A e B)", () => {
  it("até 6 abas e o resto em +N; a ativa sempre à vista", () => {
    const abas = Array.from({ length: 9 }, (_, i) => aba({ id: `t${i}`, titulo: `Aba ${i}`, ativa: i === 8 }));
    const { aVista, mais } = abasVisiveis(abas);
    expect(aVista).toHaveLength(6);
    expect(mais).toBe(3);
    expect(aVista.some((a) => a.ativa)).toBe(true);
    expect(htmlBarraDoNavegador(vista({ abas }), { nome: "Nina" })).toContain("+3");
  });

  it("assistindo: só leitura, domínio escuro e resto cinza, cadeado; Não seguro em vermelho", () => {
    expect(partesDoEndereco("https://www.google.com/travel/flights?q=GRU-LIS")).toEqual({ dominio: "google.com", resto: "/travel/flights?q=GRU-LIS", seguro: true });
    expect(partesDoEndereco("http://promo-passagens.net/").seguro).toBe(false);
    const html = htmlBarraDoNavegador(vista(), { nome: "Nina" });
    expect(html).toContain('<span class="nv-dominio">google.com</span>');
    expect(html).toContain("nv-cadeado");
    expect(html).not.toContain("<input");
    expect(html).toContain("nv-aba-cursor");
    expect(htmlBarraDoNavegador(vista({ abas: [aba({ url: "http://promo-passagens.net/" })] }), { nome: "Nina" })).toContain("Não seguro");
  });

  it("no controle: campo de verdade, voltar e recarregar; sem o cursorzinho do bot", () => {
    const html = htmlBarraDoNavegador(vista({ controle: "pessoa" }), { nome: "Nina" });
    expect(html).toContain('class="nv-endereco-input"');
    expect(html).toContain('data-nv="voltar"');
    expect(html).toContain('data-nv="recarregar"');
    expect(html).not.toContain("nv-aba-cursor");
  });

  it("o lugar baixinho no fim (N4)", () => {
    expect(textoDoLugar({ tipo: "nod" })).toBe("no nod");
    expect(textoDoLugar({ tipo: "maquina", maquinaId: "m", nome: "vm-sp" })).toBe("na vm-sp");
    expect(textoDoLugar({ tipo: "mac", nome: "Mac" })).toBe("no seu Mac");
    expect(htmlBarraDoNavegador(vista(), { nome: "Nina" })).toContain(">no nod<");
  });

  it("o ponto azul na aba que precisa de você", () => {
    expect(htmlBarraDoNavegador(vista({ controle: "precisa_de_voce" }), { nome: "Nina" })).toContain("nv-aba-ponto");
  });
});

describe("os avisos do site (D2 D, D1d)", () => {
  it("uma faixa por vez, com a ação; o pedido de login vira 'Entrar no …' sem botão (a ação é a da pílula)", () => {
    expect(htmlAvisoDoSite(null)).toBe("");
    const d = htmlAvisoDoSite({ tipo: "download", texto: "fatura.pdf baixado", acao: "Abrir em Arquivos", em: 0 });
    expect(d).toContain("Download");
    expect(d).toContain("Abrir em Arquivos");
    const p = avisoDoPedido(vista({ controle: "precisa_de_voce", pedido: { tipo: "login", decisaoId: "d", site: "itau.com.br", motivo: "", opcoes: [], podeTrazerDoChrome: false, etapa: "escolher", erro: null } }));
    // D3, 8 (Paper): "Entrar no Itaú", pelo nome do site com o artigo.
    expect(p).toMatchObject({ tipo: "precisa_de_voce", texto: "Entrar no Itau", acao: "" });
    const tap = avisoDoPedido(vista({ controle: "precisa_de_voce", pedido: { tipo: "login", decisaoId: "d", site: "TAP", motivo: "", opcoes: [], podeTrazerDoChrome: false, etapa: "escolher", erro: null } }));
    expect(tap?.texto).toBe("Entrar na TAP");
    expect(avisoDoPedido(vista({ controle: "pessoa" }))).toBeNull();
  });

  it("achado 10: 'Precisa de você' fica só com o motivo, mesmo quando o servidor manda a ação", () => {
    const html = htmlAvisoDoSite({ tipo: "precisa_de_voce", texto: "O site quer provar que é uma pessoa (CAPTCHA)", acao: "Assumir", em: 0 });
    expect(html).toContain("O site quer provar que é uma pessoa (CAPTCHA)");
    expect(html).not.toContain("<button");
  });

  it("achado 2: o texto inteiro no title (o CSS quebra em até 2 linhas) e as aspas curvas", () => {
    const html = htmlAvisoDoSite({ tipo: "pergunta", texto: '"Sair sem salvar?" · a Ada respondeu Cancelar', acao: "Ver passo", em: 0 });
    expect(html).toContain('<span class="nv-aviso-txt" title="“Sair sem salvar?” · a Ada respondeu Cancelar"><b>Pergunta do site</b> “Sair sem salvar?” · a Ada respondeu Cancelar</span>');
  });
});

describe("os estados da tela (D3)", () => {
  const r = (v: Partial<VistaNavegador>, disponivel = true) => ({ disponivel, vista: vista(v) });
  it("cada estado a partir da vista e do canal", () => {
    expect(estadoDaTela(null, { temQuadro: false, redeFraca: false })).toBe("conectando");
    expect(estadoDaTela(r({}), { temQuadro: false, redeFraca: false })).toBe("conectando");
    expect(estadoDaTela(r({}), { temQuadro: true, redeFraca: false })).toBe("ao_vivo");
    expect(estadoDaTela(r({}), { temQuadro: true, redeFraca: true })).toBe("rede_fraca");
    expect(estadoDaTela(r({ estado: "rede_fraca" }), { temQuadro: true, redeFraca: false })).toBe("rede_fraca");
    expect(estadoDaTela(r({ estado: "ligando" }), { temQuadro: false, redeFraca: false })).toBe("ligando");
    expect(estadoDaTela(r({ estado: "terminou" }), { temQuadro: true, redeFraca: false })).toBe("terminou");
    expect(estadoDaTela(r({ estado: "pausa" }), { temQuadro: true, redeFraca: false })).toBe("pausa");
    expect(estadoDaTela(r({ estado: "desligado" }), { temQuadro: false, redeFraca: false })).toBe("desligado");
    expect(estadoDaTela(r({ estado: "desligado" }, false), { temQuadro: false, redeFraca: false })).toBe("indisponivel");
    expect(estadoDaTela(r({ estado: "erro" }), { temQuadro: true, redeFraca: false })).toBe("erro");
    expect(estadoDaTela(r({ segredoNaPagina: true }), { temQuadro: true, redeFraca: false })).toBe("segredo");
  });

  it("todo estado parado tem botão; nunca rodinha sem texto; o erro diz causa, hora e lugar", () => {
    const v = vista({ abas: [aba(), aba({ id: "t2" })], erro: { causa: "A conexão com o motor caiu", em: new Date(2026, 10, 20, 16, 2).getTime() } });
    expect(htmlEstadoDaTela("pausa", v, "Nina")).toMatch(/Navegador em pausa.*Retomar.*2 abas guardadas/s);
    expect(htmlEstadoDaTela("desligado", v, "Nina")).toMatch(/Navegador da Nina desligado.*data-nv="ligar".*Ligar/s);
    expect(htmlEstadoDaTela("desligado", v, "Milton")).toContain("Navegador do Milton desligado");
    const erro = htmlEstadoDaTela("erro", v, "Nina");
    expect(erro).toContain("Não deu para mostrar a tela");
    // Achado 8: a queda da conexão é da vista — o bot continua.
    expect(erro).toContain("A conexão com o motor caiu às 16:02 · no nod. A Nina continua trabalhando.");
    expect(erro).toContain("Tentar de novo");
    expect(htmlEstadoDaTela("erro", vista({ erro: { causa: "Seu Mac está desligado", em: 0 } }), "Nina")).not.toContain("· no nod");
    // Achado 8: a causa que já cita o lugar não o repete; a falha do navegador não diz que o bot continua.
    const doNod = htmlEstadoDaTela("erro", vista({ erro: { causa: "A conexão com o nod caiu", em: new Date(2026, 10, 20, 16, 2).getTime() } }), "Ada");
    expect(doNod).toContain("A conexão com o nod caiu às 16:02. A Ada continua trabalhando.");
    expect(doNod).not.toContain("· no nod");
    const falhou = htmlEstadoDaTela("erro", vista({ erro: { causa: "o navegador não abriu", em: new Date(2026, 10, 20, 16, 2).getTime() } }), "Ada");
    expect(falhou).toContain("O navegador não abriu às 16:02 · no nod</span>");
    expect(falhou).not.toContain("continua trabalhando");
    // Achado 8: o Ligando diz o lugar inteiro, não "nod · leva uns 10 s".
    expect(htmlEstadoDaTela("ligando", v, "Nina")).toMatch(/nv-giro.*Ligando o navegador da Nina.*No nod · leva uns 10 s/s);
    expect(htmlEstadoDaTela("ligando", vista({ lugar: { tipo: "maquina", maquinaId: "m", nome: "vm-sp" } }), "Nina")).toContain("Na vm-sp · leva uns 10 s");
    expect(htmlEstadoDaTela("conectando", v, "Nina")).toContain("Conectando à tela da Nina…");
    // Nada por cima da imagem (D1d): a hora vai na pílula, no formato da linha de atividade.
    expect(htmlEstadoDaTela("terminou", vista({ atividadeEm: new Date(2026, 10, 20, 16, 4).getTime() }), "Nina")).toBe("");
    expect(htmlPilula("Nina", "assistindo", null, new Date(2026, 10, 20, 16, 4).getTime())).toContain("Terminou às 16:04");
    expect(htmlPilula("Nina", "assistindo", null)).toContain("Assistindo");
    expect(htmlEstadoDaTela("segredo", v, "Nina")).toContain("Campo protegido");
    expect(htmlEstadoDaTela("ao_vivo", v, "Nina")).toBe("");
    expect(htmlEstadoDaTela("rede_fraca", v, "Nina")).toBe("");
  });
});

describe("o letterbox e as coordenadas (D1 4, D2 C)", () => {
  it("a imagem 16:10 cabe, encostada em cima e centrada na largura; o resto é letterbox", () => {
    expect(retanguloDaImagem({ w: 1000, h: 1000 }, { w: 1280, h: 800 })).toEqual({ x: 0, y: 0, w: 1000, h: 625 });
    expect(retanguloDaImagem({ w: 1600, h: 500 }, { w: 1280, h: 800 })).toEqual({ x: 400, y: 0, w: 800, h: 500 });
  });

  it("da vista para o viewport, fora da imagem não vai ao site", () => {
    const caixa = { w: 640, h: 600 };
    // A imagem 640×400 fica em cima (y de 0 a 400); de 400 a 600 é letterbox.
    expect(pontoNoViewport({ x: 320, y: 200 }, caixa, { w: 1280, h: 800 })).toEqual({ x: 640, y: 400 });
    expect(pontoNoViewport({ x: 0, y: 0 }, caixa, { w: 1280, h: 800 })).toEqual({ x: 0, y: 0 });
    expect(pontoNoViewport({ x: 320, y: 450 }, caixa, { w: 1280, h: 800 })).toBeNull();
    expect(pontoNoViewport({ x: 640, y: 400 }, caixa, { w: 1280, h: 800 })).toEqual({ x: 1279, y: 799 });
  });

  it("a caixa do passo escalada à vista (o cursor e o anel)", () => {
    expect(caixaNaVista({ x: 100, y: 80, w: 200, h: 40 }, { w: 640, h: 600 }, { w: 1280, h: 800 })).toEqual({ x: 50, y: 40, w: 100, h: 20 });
  });

  it("o cursor anda em 120–400 ms pela distância", () => {
    expect(duracaoDoCursor(null, { x: 0, y: 0 })).toBe(0);
    expect(duracaoDoCursor({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(121);
    expect(duracaoDoCursor({ x: 0, y: 0 }, { x: 5000, y: 0 })).toBe(400);
  });
});

describe("o painel (D5, D6)", () => {
  it("mínimo 360, padrão 40 %, máximo deixando a conversa com 420", () => {
    expect(larguraPadrao(1100)).toBe(440);
    expect(larguraMaxima(1100)).toBe(680);
    expect(limitarLargura(200, 1100)).toBe(360);
    expect(limitarLargura(900, 1100)).toBe(680);
  });

  it("encaixes 1/3, 1/2 e 2/3 com ímã de 8 px; abaixo de 360 solta e fecha", () => {
    expect(imantar(546, 1100)).toEqual({ largura: 550, encaixe: 1 / 2 });
    expect(imantar(540, 1100)).toEqual({ largura: 540, encaixe: null });
    expect(imantar(370, 1100)).toEqual({ largura: 367, encaixe: 1 / 3 });
    expect(soltarFecha(359)).toBe(true);
    expect(soltarFecha(360)).toBe(false);
  });

  it("fora do Mac os atalhos se mostram com Ctrl e o painel sem aparelho diz PC (QA do Windows)", () => {
    definirTecladoDoMac(false);
    try {
      expect(tecla("⌘⇧F")).toBe("Ctrl+Shift+F");
      expect(tecla("⌘W")).toBe("Ctrl+W");
      expect(ariaTecla("Meta+Shift+A")).toBe("Control+Shift+A");
      expect(htmlPilula("Nina", "controle")).toContain('title="A Nina espera · Ctrl+Shift+A devolve"');
      expect(textosDoAparelhoNaWeb(undefined).nome).toBe("PC");
      expect(textosDoAparelhoNaWeb("mac").nome).toBe("Mac");
      expect(htmlPilula("Leitor QA", "controle")).toContain("O Leitor QA espera");
    } finally {
      definirTecladoDoMac(true);
    }
    expect(textosDoAparelhoNaWeb(undefined).nome).toBe("Mac");
  });

  it("⌘⌥← alarga e ⌘⌥→ estreita pelos encaixes que cabem", () => {
    expect(proximoEncaixe(440, 1100, -1)).toBe(550);
    expect(proximoEncaixe(550, 1100, -1)).toBe(733 > larguraMaxima(1100) ? 550 : 733);
    expect(proximoEncaixe(550, 1100, 1)).toBe(367);
    expect(proximoEncaixe(367, 1100, 1)).toBe(367);
  });

  it("≥ 1180 ao lado; 900–1179 cobre; celular, a folha", () => {
    expect(modoDoPainel(1440, false, 1100)).toBe("lado");
    expect(modoDoPainel(1100, false, 760)).toBe("cobre");
    expect(modoDoPainel(1300, false, 700)).toBe("cobre");
    expect(modoDoPainel(390, true, 390)).toBe("folha");
  });

  it("a largura lembrada como fração (lixo vira null)", () => {
    expect(lerLargura(gravarLargura(550, 1100))).toBe(0.5);
    expect(lerLargura("abc")).toBeNull();
    expect(lerLargura("3")).toBeNull();
    expect(lerLargura(null)).toBeNull();
  });

  it("a folha do celular solta na posição mais perto, ou pelo embalo", () => {
    expect(alturaDaFolha("meia", 800)).toBe(496);
    expect(soltarFolha(780, 800)).toBe("cheia");
    expect(soltarFolha(480, 800)).toBe("meia");
    expect(soltarFolha(60, 800)).toBe("fechada");
    expect(soltarFolha(480, 800, 1.2)).toBe("fechada");
    expect(soltarFolha(480, 800, -1.2)).toBe("cheia");
  });
});

describe("os lugares, a linha, o canto e a aba (D1 1, 1c, D7)", () => {
  it("o ponto do lugar: verde ao vivo, azul precisa de você, sem ponto parado", () => {
    expect(pontoDoLugar(vista())).toBe("vivo");
    expect(pontoDoLugar(vista({ controle: "precisa_de_voce" }))).toBe("precisa");
    expect(pontoDoLugar(vista({ estado: "desligado" }))).toBeNull();
    const html = htmlLugares(["navegador", "computador"], "navegador", "vivo");
    expect(html).toMatch(/nv-lugar-ponto" data-ponto="vivo".*Navegador.*Computador/s);
    expect(html).toContain("--nv-i:0;--nv-n:2");
    expect(htmlLugares(["navegador"], "navegador", null)).not.toContain("Computador");
  });

  it("achado 11: com um lugar só, o seletor vira rótulo (sem botão, sem a pílula que desliza)", () => {
    const um = htmlLugares(["navegador"], "navegador", "vivo");
    expect(um).toContain("nv-lugar-unico");
    expect(um).toContain('data-ponto="vivo"');
    expect(um).toContain("<span>Navegador</span>");
    expect(um).not.toContain("<button");
    expect(um).not.toContain("nv-lugar-fundo");
    expect(um).not.toContain('role="tablist"');
  });

  it("a legenda sai da vista: na aba 'Navegador da …', na tela cheia '{nome} · …'", () => {
    const v = vista({ passo: { tipo: "clicar", frase: "Clicando em Buscar", caixa: null, em: 1 } });
    expect(legendaDoPasso("Ada", v, "aba")).toBe("Navegador da Ada · clicando em Buscar");
    expect(legendaDoPasso("Milton", vista({ passo: { tipo: "clicar", frase: 'Clicando em "Faturas"', caixa: null, em: 1 } }), "aba")).toBe("Navegador do Milton · clicando em “Faturas”");
    expect(legendaDoPasso("Ada", v, "tela-cheia")).toBe("Ada · clicando em Buscar");
    expect(legendaDoPasso("Ada", vista({ controle: "pessoa" }), "tela-cheia")).toBe("Ada · você está no controle");
  });

  it("a linha de atividade aparece com o bot usando e some depois; precisa de você fica", () => {
    const v = vista({ atividadeEm: 1_000, passo: { tipo: "ler", frase: "Lendo os voos diretos", caixa: null, em: 1_000 } });
    expect(linhaDoNavegadorVisivel(v, 2_000)).toBe(true);
    expect(linhaDoNavegadorVisivel(v, 60_000)).toBe(false);
    expect(linhaDoNavegadorVisivel({ ...v, controle: "precisa_de_voce" }, 600_000)).toBe(true);
    expect(linhaDoNavegadorVisivel(vista({ estado: "desligado" }), 0)).toBe(false);
    const html = htmlLinhaDoNavegador("Ada", "a1", v, { modoAbas: false });
    expect(html).toMatch(/Navegador da Ada.*Google Voos · lendo os voos diretos.*data-act="navegador-ver".*Ver/s);
    expect(htmlLinhaDoNavegador("Ada", "a1", v, { modoAbas: true })).toContain(">Abrir<");
  });

  it("o botão do canto: só o ícone parado; 'Navegador' e o ponto com atividade", () => {
    expect(htmlBotaoDoCanto("a1", vista({ estado: "desligado" }), false)).not.toContain("Navegador</span>");
    const vivo = htmlBotaoDoCanto("a1", vista(), true);
    expect(vivo).toContain("nv-canto-ponto");
    expect(vivo).toContain('aria-pressed="true"');
    expect(vivo).toContain('data-act="navegador-alternar"');
  });

  it("a aba de lugar: os estados, a dica e o ×", () => {
    expect(estadoDaAbaDeLugar(vista())).toBe("vivo");
    expect(estadoDaAbaDeLugar(vista({ controle: "precisa_de_voce" }))).toBe("precisa");
    expect(estadoDaAbaDeLugar(vista({ controle: "pessoa" }))).toBe("controle");
    expect(estadoDaAbaDeLugar(vista({ estado: "terminou" }))).toBe("parada");
    expect(estadoDaAbaDeLugar(vista({ estado: "erro" }))).toBe("problema");
    expect(dicaDaAbaDeLugar("Ada", vista())).toBe("Navegador da Ada · Google Voos · ao vivo");
    // Achado 11: a aba diz "Navegador"; o título da página fica na dica (e na aba do Chrome logo abaixo).
    expect(htmlAbaDeLugar("a1", "Ada", vista(), false)).toMatch(/<span class="at-titulo">Navegador<\/span>/);
    expect(htmlAbaDeLugar("a1", "Ada", vista(), false)).toContain('data-dica="Navegador da Ada · Google Voos · ao vivo"');
    const html = htmlAbaDeLugar("a1", "Ada", vista({ controle: "pessoa" }), true);
    expect(html).toContain("nv-aba-mao");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-act="navegador-fechar-aba"');
    expect(htmlAbaDeLugar("a1", "Ada", vista({ estado: "erro" }), false)).toContain("nv-aba-lugar-erro");
  });

  it("o ⋯: os itens do navegador e, na aba, os do clique direito; Encerrar é o único vermelho", () => {
    const m = htmlMenuDoNavegador("Ada");
    expect(m).toMatch(/Recarregar a página.*Copiar endereço.*Abrir no meu navegador.*Logins deste site….*Encerrar o navegador da Ada/s);
    expect(m.match(/class="danger"/g)).toHaveLength(1);
    const daAba = htmlMenuDoNavegador("Ada", { daAba: true });
    // Achado 15: "Assumir o controle" (um rótulo só), o atalho à direita sem o "·" e "Fechar os outros lugares".
    expect(daAba).toMatch(/Pôr ao lado da conversa.*Assumir o controle.*Abrir em tela cheia<span class="nv-menu-dica">⌘⇧F<\/span>.*Fechar aba<span class="nv-menu-dica">⌘W<\/span>.*Fechar os outros lugares/s);
    expect(htmlMenuDoNavegador("Ada", { ensinar: true })).toContain('<span class="nv-menu-sub">Mostre no navegador da Ada; ela aprende</span>');
    expect(htmlMenuDoNavegador("Ada", { daAba: true, controle: true })).not.toContain('data-nv-menu="assumir"');
    // 2026-11-23: "Trazer do meu Chrome" logo depois de "Logins deste site…", quando a tela sabe fazer.
    expect(htmlMenuDoNavegador("Ada", { trazerDoChrome: true })).toMatch(/Logins deste site…<\/button><button[^>]*data-nv-menu="trazer-chrome">Trazer do meu Chrome<span class="nv-menu-sub">Entra neste site com o login do seu Chrome<\/span>/u);
    expect(htmlMenuDoNavegador("Ada")).not.toContain("trazer-chrome");
  });

  it("encerrar pergunta só com o bot no meio de algo", () => {
    expect(botNoMeio(vista({ passo: { tipo: "clicar", frase: "", caixa: null, em: 10_000 } }), 15_000)).toBe(true);
    expect(botNoMeio(vista({ passo: { tipo: "clicar", frase: "", caixa: null, em: 10_000 } }), 60_000)).toBe(false);
    expect(botNoMeio(vista({ estado: "pausa", pedido: aprovacao }), 0)).toBe(false);
    expect(botNoMeio(vista({ abas: [aba({ carregando: true })] }), 0)).toBe(true);
  });
});

describe("5e: o lugar fechado continua à mão", () => {
  it("só o vivo, o que precisa de você e o do controle ficam à mão; o item diz o site e o estado e reabre a aba", () => {
    expect(lugarFechadoAMao(vista())).toBe(true);
    expect(lugarFechadoAMao(vista({ controle: "precisa_de_voce" }))).toBe(true);
    expect(lugarFechadoAMao(vista({ estado: "pausa" }))).toBe(false);
    expect(lugarFechadoAMao(vista({ estado: "desligado" }))).toBe(false);
    const html = htmlLugaresFechados([{ agenteId: "a1", nome: "Ada", vista: vista() }]);
    expect(html).toContain('data-lugar-agente="a1"');
    expect(html).toContain("<span>Navegador da Ada</span><small>Google Voos · ao vivo</small>");
    expect(html).toContain('data-ponto="vivo"');
    expect(html).toContain("⌘⇧T reabre a última que você fechou.");
    expect(htmlLugaresFechados([])).toBe("");
  });
});

describe("achado 7: o nome do bot em pt-BR (o artigo pela terminação)", () => {
  it("da/do, à/ao, a/o e ela/ele", () => {
    expect(deNome("Ada")).toBe("da Ada");
    expect(deNome("Milton")).toBe("do Milton");
    expect(aoNome("Ada")).toBe("à Ada");
    expect(aoNome("Milton")).toBe("ao Milton");
    expect(comArtigo("Nina")).toBe("a Nina");
    expect(comArtigo("Nod")).toBe("o Nod");
    expect(subtituloDeEnsinar("Ada")).toBe("Mostre no navegador da Ada; ela aprende");
    expect(subtituloDeEnsinar("Milton")).toBe("Mostre no navegador do Milton; ele aprende");
  });

  it("nenhum 'de {nome}' sobra nos textos do navegador", () => {
    const v = vista({ passo: { tipo: "ler", frase: "Lendo", caixa: null, em: 1 } });
    const textos = [
      htmlPilula("Ada", "assistindo"), htmlPilula("Ada", "controle"), htmlBarraDoNavegador(v, { nome: "Ada" }), htmlMenuDoNavegador("Ada", { daAba: true, ensinar: true }),
      htmlLinhaDoNavegador("Ada", "a1", v, { modoAbas: false }), htmlAbaDeLugar("a1", "Ada", v, true), htmlLugaresFechados([{ agenteId: "a1", nome: "Ada", vista: v }]),
      ...(["conectando", "ligando", "desligado", "indisponivel"] as const).map((e) => htmlEstadoDaTela(e, v, "Ada")),
    ].join("\n");
    expect(textos).not.toMatch(/\bde Ada\b/);
    expect(textos).not.toMatch(/à Ada.*Devolver/);
  });
});

describe("achado 15: aspas curvas", () => {
  it("o nome citado ganha aspas curvas; aspa sem par fica", () => {
    expect(aspasCurvas('Clicou em "Faturas"')).toBe("Clicou em “Faturas”");
    expect(aspasCurvas('5" de tela')).toBe('5" de tela');
    expect(fraseNoPassado('Clicando em "Baixar"')).toBe("Clicou em “Baixar”");
  });
});

describe("achado 8: o lugar na causa e a queda da vista", () => {
  it("a causa que cita o lugar; a conexão é da vista", () => {
    expect(causaCitaOLugar("A conexão com o nod caiu", { tipo: "nod" })).toBe(true);
    expect(causaCitaOLugar("A vm-sp está fora do ar", { tipo: "maquina", maquinaId: "m", nome: "vm-sp" })).toBe(true);
    expect(causaCitaOLugar("Seu Mac está desligado", { tipo: "mac", nome: "MacBook" })).toBe(true);
    expect(causaCitaOLugar("o navegador não abriu", { tipo: "nod" })).toBe(false);
    expect(quedaDaVista("A conexão com o nod caiu")).toBe(true);
    expect(quedaDaVista("o navegador não abriu")).toBe(false);
  });
});

describe("achado 6: muitas abas do Chrome no painel estreito", () => {
  it("a inativa leva o nome no title e no aria-label (o CSS mostra só o favicon); até 6 e o resto em +N", () => {
    const abas = Array.from({ length: 9 }, (_, i) => aba({ id: `t${i}`, titulo: `Aba ${i}`, url: `https://site${i}.com/`, ativa: i === 0 }));
    const html = htmlBarraDoNavegador(vista({ abas }), { nome: "Ada" });
    expect(html.match(/class="nv-aba[ "]/g)).toHaveLength(6);
    expect(html).toContain('title="Aba 3" aria-label="Aba 3"');
    expect(html).toContain('<span class="nv-aba-mais" title="3 outras abas">+3</span>');
    expect(html).toContain('class="nv-abas nv-abas-muitas"');
    // Com poucas abas o nome cabe: elas não encolhem.
    expect(htmlBarraDoNavegador(vista({ abas: abas.slice(0, 2) }), { nome: "Ada" })).toContain('class="nv-abas"');
  });
});

describe("5d: o aviso de aba fechada", () => {
  it("diz que o bot continua, pelo pronome (Paper: 'Ela continua trabalhando.')", () => {
    expect(avisoDaAbaFechada("Ada")).toBe("Navegador da Ada fechado. Ela continua trabalhando.");
    expect(avisoDaAbaFechada("Milton")).toBe("Navegador do Milton fechado. Ele continua trabalhando.");
  });
});

describe("D6 B: a barra só com avatares com o painel cobrindo", () => {
  it("de 900 a 1179 px e só com o painel cobrindo a conversa", () => {
    expect(barraSoComAvatares(1024, true)).toBe(true);
    expect(barraSoComAvatares(900, true)).toBe(true);
    expect(barraSoComAvatares(1179, true)).toBe(true);
    expect(barraSoComAvatares(1024, false)).toBe(false);
    // A partir de 1180 o "cobre" vem da área: a barra estreita desfaria o próprio motivo (e oscilaria).
    expect(barraSoComAvatares(1180, true)).toBe(false);
    expect(barraSoComAvatares(899, true)).toBe(false);
  });
});

describe("D5 (máximo): a conversa estreita", () => {
  it("abaixo de 600 px de conversa o seletor de IA fica só com o anel; painel fechado nunca", () => {
    expect(conversaEstreita(1100, 440)).toBe(false);
    expect(conversaEstreita(1100, 680)).toBe(true);
    expect(conversaEstreita(1100, 0)).toBe(false);
  });
});

describe("o navegador no PC (2026-11-22): os textos do aparelho", () => {
  it("a cópia da web bate com a do domínio, nos dois aparelhos", async () => {
    const { textosDoAparelho } = await import("../../../src/domain/navegador-cofre.ts");
    const { textosDoAparelhoNaWeb } = await import("../../../web/lib/navegador-vista.ts");
    for (const a of ["mac", "pc"] as const) {
      const web = textosDoAparelhoNaWeb(a);
      const dom = textosDoAparelho(a);
      for (const k of Object.keys(web) as (keyof typeof web)[]) expect(web[k], `${a}.${k}`).toBe(dom[k]);
    }
    expect(textosDoAparelhoNaWeb(undefined).nome).toBe("Mac");
  });

  it("no PC: Windows Hello no botão de pagar, 'no seu PC' no lugar e 'Confirme no seu PC' no login", async () => {
    const { rotuloDaAprovacao, textoDoLugar } = await import("../../../web/lib/navegador-vista.ts");
    const { htmlCartaoLogin, htmlCartaoAprovacao } = await import("../../../web/lib/navegador-cartoes.ts");
    const ap = { tipo: "aprovacao" as const, decisaoId: "d1", pergunta: "Pagar R$ 3.780 na TAP?", botao: "pagar", classe: "pagar" as const, touchId: true, avisoTouchId: null, caixa: null, lembrar: null };
    expect(rotuloDaAprovacao(ap, "pc")).toBe("Pagar com Windows Hello");
    expect(rotuloDaAprovacao({ ...ap, touchId: false }, "pc")).toBe("Pagar sem Windows Hello");
    expect(rotuloDaAprovacao(ap)).toBe("Pagar com Touch ID");
    expect(htmlCartaoAprovacao(ap, { agenteId: "a1", nome: "Ada", dono: false, aparelho: "pc" })).toContain("O seu PC pede o Windows Hello na hora de pagar.");
    expect(textoDoLugar({ tipo: "mac", nome: "DESKTOP-4F2K" }, "pc")).toBe("no seu PC");
    expect(textoDoLugar({ tipo: "mac", nome: "MacBook de Marlon" })).toBe("no seu Mac");
    const login = htmlCartaoLogin({ tipo: "login", decisaoId: "d2", site: "itau.com.br", motivo: "ver a fatura", opcoes: [], podeTrazerDoChrome: false, etapa: "confirme_no_mac", erro: null }, { nome: "Ada", agenteId: "a1", fonte: "1password", aparelho: "pc" });
    expect(login).toContain("Confirme no seu PC");
    expect(login).toContain("Windows Hello");
    expect(login).not.toContain("Touch ID");
  });
});

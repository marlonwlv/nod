import { describe, expect, it } from "vitest";
import type { AbaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import {
  abasVisiveis, alturaDaFolha, avisoDoPedido, botNoMeio, caixaNaVista, dicaDaAbaDeLugar, duracaoDoCursor, estadoDaAbaDeLugar, estadoDaPilula, estadoDaTela, gravarLargura, htmlAbaDeLugar,
  htmlAvisoDoSite, htmlBarraDoNavegador, htmlBotaoDoCanto, htmlEstadoDaTela, htmlLinhaDoNavegador, htmlLugares, htmlLugaresFechados, lugarFechadoAMao, htmlMenuDoNavegador, htmlPilula, imantar, larguraMaxima, larguraPadrao,
  legendaDoPasso, lerLargura, limitarLargura, linhaDoNavegadorVisivel, modoDoPainel, MS_ASSUMINDO_VISIVEL, partesDoEndereco, pontoDoLugar, pontoNoViewport, proximoEncaixe,
  retanguloDaImagem, rotuloDaAprovacao, soltarFecha, soltarFolha, textoDoLugar,
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
    expect(controle).not.toContain("Parar");
    expect(htmlPilula("Nina", "assumindo")).toContain("disabled");
    expect(htmlPilula("Nina", "precisa")).toMatch(/Precisa de você.*Já resolvi.*Assumir o controle/s);
    expect(htmlPilula("Nina", "login")).toMatch(/Nina espera você entrar.*Pronto, pode seguir/s);
    const ap = htmlPilula("Nina", "aprovacao", aprovacao);
    expect(ap).toMatch(/Pagar R\$ 3\.780 na TAP\?.*Não.*Pagar com Touch ID/s);
    expect(ap).toContain('data-nv="aprovar"');
    expect(rotuloDaAprovacao({ ...aprovacao, touchId: false })).toBe("Pagar");
    expect(rotuloDaAprovacao({ ...aprovacao, classe: "enviar", botao: "enviar", touchId: false })).toBe("Enviar");
  });

  it("escapa o nome do bot", () => {
    expect(htmlPilula("<b>", "controle")).toContain("Devolver à &lt;b&gt;");
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
  it("uma faixa por vez, com a ação; o pedido de login vira 'Entrar em … · Assumir'", () => {
    expect(htmlAvisoDoSite(null)).toBe("");
    const d = htmlAvisoDoSite({ tipo: "download", texto: "fatura.pdf baixado", acao: "Abrir em Arquivos", em: 0 });
    expect(d).toContain("Download");
    expect(d).toContain("Abrir em Arquivos");
    const p = avisoDoPedido(vista({ controle: "precisa_de_voce", pedido: { tipo: "login", decisaoId: "d", site: "itau.com.br", motivo: "", opcoes: [], podeTrazerDoChrome: false, etapa: "escolher", erro: null } }));
    expect(p).toMatchObject({ tipo: "precisa_de_voce", texto: "Entrar em itau.com.br", acao: "Assumir" });
    expect(avisoDoPedido(vista({ controle: "pessoa" }))).toBeNull();
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
    expect(htmlEstadoDaTela("desligado", v, "Nina")).toMatch(/Navegador de Nina desligado.*data-nv="ligar".*Ligar/s);
    const erro = htmlEstadoDaTela("erro", v, "Nina");
    expect(erro).toContain("Não deu para mostrar a tela");
    expect(erro).toContain("A conexão com o motor caiu às 16:02 · no nod");
    expect(erro).toContain("Tentar de novo");
    expect(htmlEstadoDaTela("erro", vista({ erro: { causa: "Seu Mac está desligado", em: 0 } }), "Nina")).not.toContain("· no nod");
    expect(htmlEstadoDaTela("ligando", v, "Nina")).toMatch(/nv-giro.*Ligando o navegador de Nina.*leva uns 10 s/s);
    expect(htmlEstadoDaTela("conectando", v, "Nina")).toContain("Conectando à tela de Nina…");
    expect(htmlEstadoDaTela("terminou", vista({ atividadeEm: new Date(2026, 10, 20, 16, 4).getTime() }), "Nina")).toContain("✓ Nina terminou aqui · 16:04");
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

  it("a legenda sai da vista: na aba 'Navegador de …', na tela cheia '{nome} · …'", () => {
    const v = vista({ passo: { tipo: "clicar", frase: "Clicando em Buscar", caixa: null, em: 1 } });
    expect(legendaDoPasso("Ada", v, "aba")).toBe("Navegador de Ada · clicando em Buscar");
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
    expect(html).toMatch(/Navegador de Ada.*Google Voos · lendo os voos diretos.*data-act="navegador-ver".*Ver/s);
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
    expect(dicaDaAbaDeLugar("Ada", vista())).toBe("Navegador de Ada · Google Voos · ao vivo");
    const html = htmlAbaDeLugar("a1", "Ada", vista({ controle: "pessoa" }), true);
    expect(html).toContain("nv-aba-mao");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-act="navegador-fechar-aba"');
    expect(htmlAbaDeLugar("a1", "Ada", vista({ estado: "erro" }), false)).toContain("nv-aba-lugar-erro");
  });

  it("o ⋯: os itens do navegador e, na aba, os do clique direito; Encerrar é o único vermelho", () => {
    const m = htmlMenuDoNavegador("Ada");
    expect(m).toMatch(/Recarregar a página.*Copiar endereço.*Abrir no meu navegador.*Logins deste site….*Encerrar o navegador de Ada/s);
    expect(m.match(/class="danger"/g)).toHaveLength(1);
    const daAba = htmlMenuDoNavegador("Ada", { daAba: true });
    expect(daAba).toMatch(/Pôr ao lado da conversa.*Assumir.*Abrir em tela cheia.*Fechar aba.*⌘W.*Fechar as outras abas de lugar/s);
    expect(htmlMenuDoNavegador("Ada", { daAba: true, controle: true })).not.toContain('data-nv-menu="assumir"');
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
    expect(html).toContain("<span>Navegador de Ada</span><small>Google Voos · ao vivo</small>");
    expect(html).toContain('data-ponto="vivo"');
    expect(html).toContain("⌘⇧T reabre a última que você fechou.");
    expect(htmlLugaresFechados([])).toBe("");
  });
});

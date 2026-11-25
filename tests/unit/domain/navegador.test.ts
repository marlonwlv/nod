import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NAVEGADOR, FERRAMENTAS_NAVEGADOR_CATALOGO, FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../../src/contracts/ferramentas-navegador.ts";
import type { VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { classificarAcao, classificarAlvo, decidirNoNavegador, lerLiberacoes, perguntaDaAcao, SEM_LIBERACOES, valorDoRotulo } from "../../../src/domain/navegador-aprovacao.ts";
import { buscarNoCatalogo, ehDoCatalogo } from "../../../src/domain/navegador-catalogo.ts";
import { comandosDaEntrada, entradaDigita, lerEntradaNavegador, TEXTO_MAX_ENTRADA } from "../../../src/domain/navegador-entrada.ts";
import { arquivoDosPassos, campoDoElemento, eventoDoClique, mensagemDoEnsinado, fraseDoPasso, gravar, hostDaUrl, MAX_PASSOS_GRAVACAO, nomeSugerido, novaGravacao, rotuloDaGravacao, type ElementoNaPagina } from "../../../src/domain/navegador-ensinar.ts";
import { esperaDoNavegador, fraseDaPergunta, fraseDoLugar, maquinaPreferida, resolverLugar, subtituloDoInterruptor, sujeitoDoBot, type EntradaLugar } from "../../../src/domain/navegador-lugar.ts";
import { campoEhSecreto, MARCA_PROTEGIDO, redigirArvore, redigirSegredos, segredoAindaNaPagina } from "../../../src/domain/navegador-sensivel.ts";
import { botPodeAgir, camposQueMudaram, deveriaPausar, PAUSA_APOS_MS, proximoControle } from "../../../src/domain/navegador-vista.ts";

const botao = (nome: string, host = "tap.pt") => ({ papel: "button", nome, host });

describe("catálogo do navegador", () => {
  it("tem ~30 ferramentas, poucas diretas, todas com prefixo e descrição", () => {
    const nomes = Object.keys(FERRAMENTAS_NAVEGADOR);
    expect(nomes.length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(FERRAMENTAS_NAVEGADOR_DIRETAS).length).toBeLessThanOrEqual(12);
    for (const n of nomes) expect(n.startsWith("navegador_")).toBe(true);
    for (const s of Object.values(FERRAMENTAS_NAVEGADOR)) expect((s.description ?? "").length).toBeGreaterThan(20);
  });

  it("a busca acha por sinônimo e por palavra da descrição", () => {
    expect(buscarNoCatalogo("trocar de aba").resultados[0]?.nome).toBe("navegador_abas");
    expect(buscarNoCatalogo("upload de arquivo").resultados[0]?.nome).toBe("navegador_enviar_arquivo");
    expect(buscarNoCatalogo("clicar por pixel no canvas").resultados[0]?.nome).toBe("navegador_pixel");
    expect(buscarNoCatalogo("css").resultados[0]?.nome).toBe("navegador_estilos");
    expect(buscarNoCatalogo("xyzzy").resultados).toEqual([]);
    expect(buscarNoCatalogo("xyzzy").todos.length).toBe(Object.keys(FERRAMENTAS_NAVEGADOR_CATALOGO).length);
  });

  it("só nomes do catálogo passam por navegador_usar", () => {
    expect(ehDoCatalogo("navegador_abas")).toBe(true);
    expect(ehDoCatalogo("navegador_clicar")).toBe(false);
    expect(ehDoCatalogo("constructor")).toBe(false);
  });
});

describe("aprovação no ponto sem volta (quadro A)", () => {
  it("classifica pelo rótulo do botão, sem acento, palavra inteira, o mais grave primeiro", () => {
    expect(classificarAlvo(botao("Pagar R$ 3.780"))).toBe("pagar");
    expect(classificarAlvo(botao("Finalizar compra"))).toBe("pagar");
    expect(classificarAlvo(botao("Excluir item"))).toBe("apagar");
    expect(classificarAlvo(botao("Enviar"))).toBe("enviar");
    expect(classificarAlvo(botao("Alterar senha"))).toBe("seguranca");
    expect(classificarAlvo(botao("Pagar e enviar"))).toBe("pagar");
    expect(classificarAlvo(botao("Buscar voos"))).toBe("livre");
    expect(classificarAlvo(botao("Pagamentos"))).toBe("livre");
    expect(classificarAlvo({ papel: "textbox", nome: "Enviar para", host: "x" })).toBe("livre");
    expect(classificarAlvo(null)).toBe("livre");
  });

  it("só clicar e Enter disparam; preencher e rolar nunca", () => {
    expect(classificarAcao({ ferramenta: "navegador_clicar", alvo: botao("Comprar") })).toBe("pagar");
    expect(classificarAcao({ ferramenta: "navegador_tecla", alvo: botao("Enviar"), tecla: "Enter" })).toBe("enviar");
    expect(classificarAcao({ ferramenta: "navegador_tecla", alvo: botao("Enviar"), tecla: "Tab" })).toBe("livre");
    expect(classificarAcao({ ferramenta: "navegador_preencher", alvo: botao("Pagar") })).toBe("livre");
  });

  it("lê o valor do rótulo em centavos", () => {
    expect(valorDoRotulo("Pagar R$ 3.780")).toBe(378000);
    expect(valorDoRotulo("Pagar R$ 3.780,50")).toBe(378050);
    expect(valorDoRotulo("Pay $12.50")).toBe(1250);
    expect(valorDoRotulo("Comprar")).toBeNull();
  });

  it("segue a tabela: livre passa; pagar pede Touch ID em todo modo; segurança é da pessoa", () => {
    const base = { host: "tap.pt", rotulo: "Pagar R$ 3.780", destino: null, liberacoes: SEM_LIBERACOES, revisorLigado: false };
    expect(decidirNoNavegador({ ...base, modo: "manual", classe: "livre" })).toEqual({ tipo: "passa", motivo: "livre" });
    for (const modo of ["manual", "automatico", "total"] as const) {
      expect(decidirNoNavegador({ ...base, modo, classe: "pagar" })).toEqual({ tipo: "pede", classe: "pagar", touchId: true, podeLembrar: false });
      expect(decidirNoNavegador({ ...base, modo, classe: "seguranca" })).toEqual({ tipo: "pessoa_faz" });
    }
    expect(decidirNoNavegador({ ...base, modo: "automatico", classe: "apagar" }).tipo).toBe("pede");
    expect(decidirNoNavegador({ ...base, modo: "total", classe: "apagar" }).tipo).toBe("passa");
    expect(decidirNoNavegador({ ...base, modo: "manual", classe: "enviar", destino: "Pedro" })).toEqual({ tipo: "pede", classe: "enviar", touchId: false, podeLembrar: true });
    expect(decidirNoNavegador({ ...base, modo: "automatico", classe: "enviar", revisorLigado: true })).toEqual({ tipo: "revisor" });
    expect(decidirNoNavegador({ ...base, modo: "automatico", classe: "enviar" })).toEqual({ tipo: "passa", motivo: "modo" });
  });

  it("o teto de antemão (A2) vale até o valor; o destino lembrado (A3) dispensa", () => {
    const lib = { pagar: [{ host: "tap.pt", ateCentavos: 400000 }], enviar: [{ host: "web.whatsapp.com", destino: "Pedro" }] };
    const base = { modo: "manual" as const, liberacoes: lib, revisorLigado: false, destino: null };
    expect(decidirNoNavegador({ ...base, classe: "pagar", host: "tap.pt", rotulo: "Pagar R$ 3.780" })).toEqual({ tipo: "passa", motivo: "liberado_antes" });
    expect(decidirNoNavegador({ ...base, classe: "pagar", host: "tap.pt", rotulo: "Pagar R$ 4.100" }).tipo).toBe("pede");
    expect(decidirNoNavegador({ ...base, classe: "pagar", host: "tap.pt", rotulo: "Pagar" }).tipo).toBe("pede");
    expect(decidirNoNavegador({ ...base, classe: "enviar", host: "web.whatsapp.com", rotulo: "Enviar", destino: "Pedro" })).toEqual({ tipo: "passa", motivo: "liberado_antes" });
  });

  it("a pergunta do cartão: o rótulo do botão e o site; no envio com destino visto, para quem (A3)", () => {
    expect(perguntaDaAcao("pagar", "Pagar R$ 3.780", "www.flytap.com")).toBe("Pagar R$ 3.780 no flytap.com?");
    expect(perguntaDaAcao("enviar", "Enviar", "web.whatsapp.com", "Pedro")).toBe("Enviar a mensagem para Pedro no web.whatsapp.com?");
    expect(perguntaDaAcao("enviar", "Enviar e-mail", "mail.exemplo.com", "Pedro")).toBe("Enviar e-mail para Pedro no mail.exemplo.com?");
    expect(perguntaDaAcao("enviar", "Enviar", "web.whatsapp.com", null)).toBe("Enviar no web.whatsapp.com?");
    expect(perguntaDaAcao("pagar", "Pagar", "loja.com", "Pedro")).toBe("Pagar no loja.com?");
  });
});

describe("onde o navegador mora (M e N)", () => {
  const base: EntradaLugar = { temApp: true, nomeDoAparelho: "seu Mac", aparelhoLigado: true, continuaSemMac: false, maquinas: [], maquinaDoComputador: null, escolha: null, soNaMaquina: false };
  const sp = { id: "m1", nome: "vm-sp", ligada: true };
  const rio = { id: "m2", nome: "vm-rio", ligada: true };

  it("desligado: roda no Mac; com o Mac desligado, espera", () => {
    expect(resolverLugar(base)).toEqual({ tipo: "roda", lugar: { tipo: "mac", nome: "seu Mac" }, desvio: null });
    expect(resolverLugar({ ...base, aparelhoLigado: false })).toEqual({ tipo: "espera", motivo: "aparelho_desligado", nome: "seu Mac" });
  });

  it("0 máquinas: no nod; 1: nela; várias: onde o computador mora, senão a primeira", () => {
    expect(resolverLugar({ ...base, continuaSemMac: true })).toEqual({ tipo: "roda", lugar: { tipo: "nod" }, desvio: null });
    expect(resolverLugar({ ...base, continuaSemMac: true, maquinas: [sp] })).toMatchObject({ lugar: { tipo: "maquina", nome: "vm-sp" } });
    expect(resolverLugar({ ...base, continuaSemMac: true, maquinas: [sp, rio], maquinaDoComputador: "m2" })).toMatchObject({ lugar: { nome: "vm-rio" } });
    expect(resolverLugar({ ...base, continuaSemMac: true, maquinas: [sp, rio] })).toMatchObject({ lugar: { nome: "vm-sp" } });
    expect(resolverLugar({ ...base, continuaSemMac: true, maquinas: [sp, rio], escolha: "nod" })).toMatchObject({ lugar: { tipo: "nod" } });
  });

  it("sem app: sempre fora do Mac", () => {
    expect(resolverLugar({ ...base, temApp: false, aparelhoLigado: false })).toMatchObject({ tipo: "roda", lugar: { tipo: "nod" } });
  });

  it("máquina fora do ar: roda no nod com desvio, ou espera se travada", () => {
    const off = { ...sp, ligada: false };
    expect(resolverLugar({ ...base, continuaSemMac: true, maquinas: [off] })).toEqual({ tipo: "roda", lugar: { tipo: "nod" }, desvio: { de: "vm-sp", motivo: "fora_do_ar" } });
    expect(resolverLugar({ ...base, continuaSemMac: true, maquinas: [off], soNaMaquina: true })).toEqual({ tipo: "espera", motivo: "maquina_fora_do_ar", nome: "vm-sp" });
  });

  it("as frases dizem onde, com o nome que a pessoa conhece", () => {
    expect(fraseDoLugar({ tipo: "nod" })).toBe("no nod");
    expect(fraseDoLugar({ tipo: "maquina", maquinaId: "m1", nome: "vm-sp" })).toBe("na vm-sp");
    expect(fraseDoLugar({ tipo: "mac", nome: "seu Mac" })).toBe("no seu Mac");
    expect(subtituloDoInterruptor({ ...base, continuaSemMac: true }, "A Ada")).toBe("A Ada continua no nod");
    expect(subtituloDoInterruptor({ ...base, continuaSemMac: true, maquinas: [sp] }, "A Ada")).toBe("A Ada continua na vm-sp");
    expect(subtituloDoInterruptor(base, "A Ada")).toBe("A Ada espera o Mac ligar");
    expect(fraseDaPergunta({ maquinas: [], maquinaDoComputador: null, escolha: null }, "A Ada")).toEqual({ texto: "A Ada continua", lugar: "no nod", resto: "", trocar: false });
    expect(fraseDaPergunta({ maquinas: [sp], maquinaDoComputador: null, escolha: null }, "A Ada").resto).toBe(", que fica sempre ligada");
    expect(fraseDaPergunta({ maquinas: [sp, rio], maquinaDoComputador: "m1", escolha: null }, "A Ada")).toMatchObject({ resto: ", onde ela já trabalha", trocar: true });
    // M e N (Paper): o sujeito com o artigo, pela terminação do nome.
    expect(sujeitoDoBot("Ada")).toBe("A Ada");
    expect(sujeitoDoBot("Milton")).toBe("O Milton");
    expect(maquinaPreferida({ maquinas: [sp], maquinaDoComputador: null, escolha: "sumiu" })?.nome).toBe("vm-sp");
  });
});

describe("ensinar uma tarefa (T)", () => {
  it("grava em linguagem simples, junta digitação no mesmo campo e nunca guarda o texto", () => {
    let g = novaGravacao(0);
    for (const e of [{ tipo: "abriu", url: "https://www.itau.com.br/x" }, { tipo: "entrou", site: "itau.com.br" }, { tipo: "clicou", papel: "link", nome: "Faturas" }, { tipo: "digitou", campo: "Busca", protegido: false }, { tipo: "digitou", campo: "Busca", protegido: false }, { tipo: "escolheu", campo: "Mês", opcao: "Novembro" }] as const) g = gravar(g, e, 1000).gravacao;
    expect(g.eventos.map(fraseDoPasso)).toEqual(["Abriu itau.com.br/x", "Entrou em itau.com.br (senha não gravada)", 'Clicou em "Faturas"', 'Preencheu "Busca"', 'Escolheu "Novembro"']);
    expect(rotuloDaGravacao(g, 42_000)).toBe("0:42 · 5 passos");
    expect(arquivoDosPassos("Baixar a fatura do Itaú", g)).toContain("1. Abriu itau.com.br/x");
    // Ponto 15 dos cenários (22/11): o caminho fica, a busca e o fragmento (dados da sessão) não.
    expect(fraseDoPasso({ tipo: "abriu", url: "https://demoqa.com/text-box?sessao=abc#topo" })).toBe("Abriu demoqa.com/text-box");
    expect(fraseDoPasso({ tipo: "abriu", url: "https://demoqa.com/" })).toBe("Abriu demoqa.com");
    expect(nomeSugerido(g)).toBe("Faturas em itau.com.br");
  });

  it("para em 200 passos e em 10 minutos", () => {
    let g = novaGravacao(0);
    for (let i = 0; i < MAX_PASSOS_GRAVACAO; i++) g = gravar(g, { tipo: "clicou", papel: "button", nome: `b${i}` }, 1).gravacao;
    expect(gravar(g, { tipo: "clicou", papel: "button", nome: "x" }, 1).parou).toBe("passos");
    expect(gravar(novaGravacao(0), { tipo: "tecla", tecla: "Enter" }, 10 * 60_000 + 1).parou).toBe("tempo");
  });

  it("acha o host sem URL global", () => {
    expect(hostDaUrl("https://user@www.Itau.com.br:443/a?b")).toBe("itau.com.br");
  });
});

describe("campos sensíveis (L3)", () => {
  it("reconhece senha, cartão e código", () => {
    expect(campoEhSecreto({ papel: "textbox", nome: "Senha" })).toBe(true);
    expect(campoEhSecreto({ papel: "textbox", nome: "Número do cartão" })).toBe(true);
    expect(campoEhSecreto({ papel: "textbox", nome: "E-mail" })).toBe(false);
    expect(campoEhSecreto({ papel: "button", nome: "Esqueci a senha" })).toBe(false);
    expect(campoEhSecreto({ papel: "textbox", nome: "x", tipo: "password" })).toBe(true);
  });

  it("tira o valor da árvore e dos textos", () => {
    const arvore = '- textbox "E-mail" [ref=e1]: ana@x.com\n- textbox "Senha" [ref=e2]: hunter22\n- button "Entrar" [ref=e3]';
    const r = redigirArvore(arvore);
    expect(r).toContain('textbox "E-mail" [ref=e1]: ana@x.com');
    expect(r).toContain(`textbox "Senha" [ref=e2]: ${MARCA_PROTEGIDO}`);
    expect(r).not.toContain("hunter22");
    expect(redigirSegredos("a hunter22 b", ["hunter22"])).toBe(`a ${MARCA_PROTEGIDO} b`);
  });

  it("o segredo segue na página até a URL mudar", () => {
    expect(segredoAindaNaPagina("https://a.com/login#x", "https://a.com/login")).toBe(true);
    expect(segredoAindaNaPagina("https://a.com/login", "https://a.com/home")).toBe(false);
    expect(segredoAindaNaPagina(null, "https://a.com")).toBe(false);
  });
});

describe("vista e controle (D3, D4)", () => {
  it("pausa depois de 10 min sem uso, nunca com a pessoa no controle ou gravando", () => {
    const v = { estado: "ao_vivo" as const, controle: "bot" as const, atividadeEm: 0, gravacao: null, pedido: null };
    expect(deveriaPausar(v, PAUSA_APOS_MS - 1)).toBe(false);
    expect(deveriaPausar(v, PAUSA_APOS_MS)).toBe(true);
    expect(deveriaPausar({ ...v, controle: "pessoa" }, PAUSA_APOS_MS)).toBe(false);
    expect(deveriaPausar({ ...v, gravacao: { desde: 0, passos: [], parou: null } }, PAUSA_APOS_MS)).toBe(false);
  });

  it("assumir, devolver, pedir e resolver", () => {
    expect(proximoControle("bot", "assumir")).toBe("pessoa");
    expect(proximoControle("pessoa", "assumir")).toBeNull();
    expect(proximoControle("pessoa", "devolver")).toBe("bot");
    expect(proximoControle("bot", "devolver")).toBeNull();
    expect(proximoControle("bot", "pedir")).toBe("precisa_de_voce");
    expect(proximoControle("precisa_de_voce", "resolver")).toBe("bot");
    expect(botPodeAgir("pessoa")).toBe(false);
    expect(botPodeAgir("bot")).toBe(true);
  });
});

describe("entrada da pessoa no canal ao vivo", () => {
  const vp = { w: 1280, h: 720 };
  it("mouse: números finitos dentro do viewport, botão, cliques e modificadores no formato; o resto cai", () => {
    expect(lerEntradaNavegador({ t: "mouse", evento: "mousePressed", x: 10, y: 20, botao: "left", cliques: 1 }, vp)).toMatchObject({ t: "mouse", evento: "mousePressed", x: 10, y: 20, botao: "left", cliques: 1, modificadores: 0 });
    for (const ruim of [
      { t: "mouse", evento: "mousePressed", x: 1281, y: 1 }, { t: "mouse", evento: "mousePressed", x: -1, y: 1 }, { t: "mouse", evento: "mouseMoved", x: Number.NaN, y: 1 },
      { t: "mouse", evento: "mouseMoved", x: 1, y: "2" }, { t: "mouse", evento: "mouseDown", x: 1, y: 1 }, { t: "mouse", evento: "mousePressed", x: 1, y: 1, botao: "back" },
      { t: "mouse", evento: "mousePressed", x: 1, y: 1, cliques: 4 }, { t: "mouse", evento: "mouseWheel", x: 1, y: 1, dy: 1e9 }, { t: "mouse", evento: "mouseMoved", x: 1, y: 1, modificadores: 16 },
      { t: "outra" }, null, "texto", [],
    ]) expect(lerEntradaNavegador(ruim, vp)).toBeNull();
  });

  it("tecla: char exige texto até 4096; keyDown/keyUp exigem tecla até 64", () => {
    expect(lerEntradaNavegador({ t: "tecla", evento: "char", texto: "olá" }, vp)).toEqual({ t: "tecla", evento: "char", texto: "olá", modificadores: 0 });
    expect(lerEntradaNavegador({ t: "tecla", evento: "char", texto: "x".repeat(TEXTO_MAX_ENTRADA + 1) }, vp)).toBeNull();
    expect(lerEntradaNavegador({ t: "tecla", evento: "char", texto: "" }, vp)).toBeNull();
    expect(lerEntradaNavegador({ t: "tecla", evento: "keyDown" }, vp)).toBeNull();
    expect(lerEntradaNavegador({ t: "tecla", evento: "keyDown", tecla: "a".repeat(65) }, vp)).toBeNull();
    expect(lerEntradaNavegador({ t: "tecla", evento: "keyDown", tecla: "a", codigo: "KeyA", texto: "a", modificadores: 8 }, vp)).toMatchObject({ tecla: "a", codigo: "KeyA", texto: "a", modificadores: 8 });
  });

  it("tradução (medida em 2026-11-20): char vira insertText pelo relay; Backspace e atalhos vão como press; a tecla solta do press não vai", () => {
    const e = (cru: unknown) => comandosDaEntrada(lerEntradaNavegador(cru, vp)!);
    expect(e({ t: "tecla", evento: "char", texto: "1234" })).toEqual([{ via: "relay", comando: { action: "keyboard", subaction: "insertText", text: "1234" } }]);
    expect(e({ t: "tecla", evento: "keyDown", tecla: "Backspace" })).toEqual([{ via: "relay", comando: { action: "press", key: "Backspace" } }]);
    expect(e({ t: "tecla", evento: "keyUp", tecla: "Backspace" })).toEqual([]);
    expect(e({ t: "tecla", evento: "keyDown", tecla: "a", modificadores: 4 })).toEqual([{ via: "relay", comando: { action: "press", key: "Meta+a" } }]);
    expect(e({ t: "tecla", evento: "keyDown", tecla: "A", modificadores: 8 })).toEqual([{ via: "stream", mensagem: { type: "input_keyboard", eventType: "keyDown", key: "A", text: "A", modifiers: 8 } }]);
    expect(e({ t: "tecla", evento: "keyDown", tecla: "Shift", modificadores: 8 })).toEqual([]);
    expect(e({ t: "mouse", evento: "mousePressed", x: 5, y: 6 })).toEqual([{ via: "stream", mensagem: { type: "input_mouse", eventType: "mousePressed", x: 5, y: 6, button: "left", clickCount: 1, deltaX: 0, deltaY: 0, modifiers: 0 } }]);
    expect(e({ t: "mouse", evento: "mouseMoved", x: 5, y: 6 })[0]).toMatchObject({ mensagem: { button: "none", clickCount: 0 } });
  });

  it("o que conta como digitar (para a gravação)", () => {
    const d = (cru: unknown) => entradaDigita(lerEntradaNavegador(cru, vp)!);
    expect(d({ t: "tecla", evento: "char", texto: "a" })).toBe(true);
    expect(d({ t: "tecla", evento: "keyDown", tecla: "a" })).toBe(true);
    expect(d({ t: "tecla", evento: "keyDown", tecla: "Backspace" })).toBe(true);
    expect(d({ t: "tecla", evento: "keyDown", tecla: "Enter" })).toBe(false);
    expect(d({ t: "tecla", evento: "keyDown", tecla: "c", modificadores: 2 })).toBe(false);
    expect(d({ t: "tecla", evento: "keyUp", tecla: "a" })).toBe(false);
    expect(d({ t: "mouse", evento: "mousePressed", x: 1, y: 1 })).toBe(false);
  });
});

describe("gravação: clique e campo (T)", () => {
  const el = (o: Partial<ElementoNaPagina>): ElementoNaPagina => ({ papel: "button", nome: "", rotulo: "", tipo: null, autocomplete: null, editavel: false, ...o });
  it("clique em botão ou link vira passo; campo de digitar, texto solto e sem nome não", () => {
    expect(eventoDoClique(el({ nome: "Baixar fatura" }))).toEqual({ tipo: "clicou", papel: "button", nome: "Baixar fatura" });
    expect(eventoDoClique(el({ papel: "link", rotulo: "Faturas" }))).toEqual({ tipo: "clicou", papel: "link", nome: "Faturas" });
    expect(eventoDoClique(el({ papel: "textbox", nome: "E-mail", editavel: true }))).toBeNull();
    expect(eventoDoClique(el({ papel: "paragraph", nome: "Bem-vindo" }))).toBeNull();
    expect(eventoDoClique(el({ nome: "  " }))).toBeNull();
    expect(eventoDoClique(null)).toBeNull();
  });
  it("o campo leva o rótulo e diz se é secreto (senha pelo tipo, cartão pelo nome)", () => {
    expect(campoDoElemento(el({ papel: "textbox", rotulo: "E-mail", editavel: true }), campoEhSecreto)).toEqual({ campo: "E-mail", protegido: false });
    expect(campoDoElemento(el({ papel: "textbox", rotulo: "Entrar", tipo: "password", editavel: true }), campoEhSecreto)).toEqual({ campo: "Entrar", protegido: true });
    expect(campoDoElemento(el({ papel: "textbox", nome: "Número do cartão", editavel: true }), campoEhSecreto).protegido).toBe(true);
    expect(campoDoElemento(el({ papel: "textbox", editavel: true }), campoEhSecreto).campo).toBe("um campo");
  });
});

describe("liberações guardadas e vista que mudou", () => {
  it("lerLiberacoes descarta o que não tem formato e baixa o host", () => {
    expect(lerLiberacoes({ pagar: [{ host: "Loja.com", ateCentavos: 100 }, { host: "x", ateCentavos: 1.5 }, "lixo"], enviar: [{ host: "m.com", destino: " a@b " }, { host: "m.com" }] })).toEqual({ pagar: [{ host: "loja.com", ateCentavos: 100 }], enviar: [{ host: "m.com", destino: "a@b" }] });
    expect(lerLiberacoes(null)).toEqual(SEM_LIBERACOES);
    expect(lerLiberacoes([1, 2])).toEqual(SEM_LIBERACOES);
  });
  it("camposQueMudaram compara por valor, campo a campo", () => {
    const v = { agenteId: "a", estado: "ao_vivo", controle: "bot", abas: [{ id: "t1" }], viewport: { w: 1, h: 1 } } as never as VistaNavegador;
    expect(camposQueMudaram(v, { ...v, abas: [{ id: "t1" }] } as never)).toEqual([]);
    expect(camposQueMudaram(v, { ...v, controle: "pessoa", viewport: { w: 2, h: 1 } } as never)).toEqual(["controle", "viewport"]);
    expect(camposQueMudaram(null, v).length).toBe(Object.keys(v).length);
  });
});

describe("a espera do navegador em palavras (ADR-190, N)", () => {
  it("Mac desligado, PC desligado, app sem o navegador e máquina travada: a causa da vista e a instrução do bot, sem servidor/VM/nuvem", () => {
    const mac = esperaDoNavegador({ tipo: "espera", motivo: "aparelho_desligado", nome: "seu Mac" });
    expect(mac).toMatchObject({ motivo: "aparelho_desligado", causa: "Seu Mac está desligado" });
    expect(mac.instrucao).toContain("quando o Mac ligar");
    expect(esperaDoNavegador({ tipo: "espera", motivo: "aparelho_desligado", nome: "seu PC" }).causa).toBe("Seu PC está desligado");
    const antigo = esperaDoNavegador({ tipo: "espera", motivo: "aparelho_desligado", nome: "seu Mac" }, true);
    expect(antigo).toMatchObject({ motivo: "app_sem_navegador", causa: "O app do nod no seu Mac precisa ser atualizado para o navegador" });
    const travada = esperaDoNavegador({ tipo: "espera", motivo: "maquina_fora_do_ar", nome: "vm-sp" });
    expect(travada).toMatchObject({ motivo: "maquina_fora_do_ar", causa: "A vm-sp está fora do ar" });
    expect(travada.instrucao).toContain('"Só na vm-sp"');
    // O nome da máquina é o que a pessoa deu ("vm-sp"); a palavra VM, servidor ou nuvem nunca vem do nod.
    for (const e of [mac, antigo, travada]) expect(`${e.causa} ${e.instrucao}`.replaceAll("vm-sp", "")).not.toMatch(/servidor|\bVM\b|nuvem/i);
  });
});

describe("T3: a mensagem do ensinado", () => {
  it("o verbo do começo entra minúsculo no meio da frase (Paper: 'Ensinei: baixar a fatura do Itaú.')", () => {
    expect(mensagemDoEnsinado("Baixar a fatura do Itaú")).toBe("Ensinei: baixar a fatura do Itaú.");
    expect(mensagemDoEnsinado("Conferir o extrato.")).toBe("Ensinei: conferir o extrato.");
  });
  it("nome próprio, site ou sigla no começo ficam como a pessoa escreveu", () => {
    expect(mensagemDoEnsinado("Itaú: baixar a fatura")).toBe("Ensinei: Itaú: baixar a fatura.");
    expect(mensagemDoEnsinado("TAP check-in")).toBe("Ensinei: TAP check-in.");
    expect(mensagemDoEnsinado("Faturas em itau.com.br")).toBe("Ensinei: Faturas em itau.com.br.");
  });
});

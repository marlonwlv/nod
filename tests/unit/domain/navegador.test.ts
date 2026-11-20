import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NAVEGADOR, FERRAMENTAS_NAVEGADOR_CATALOGO, FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../../src/contracts/ferramentas-navegador.ts";
import { classificarAcao, classificarAlvo, decidirNoNavegador, SEM_LIBERACOES, valorDoRotulo } from "../../../src/domain/navegador-aprovacao.ts";
import { buscarNoCatalogo, ehDoCatalogo } from "../../../src/domain/navegador-catalogo.ts";
import { arquivoDosPassos, fraseDoPasso, gravar, hostDaUrl, MAX_PASSOS_GRAVACAO, nomeSugerido, novaGravacao, rotuloDaGravacao } from "../../../src/domain/navegador-ensinar.ts";
import { fraseDaPergunta, fraseDoLugar, maquinaPreferida, resolverLugar, subtituloDoInterruptor, type EntradaLugar } from "../../../src/domain/navegador-lugar.ts";
import { campoEhSecreto, MARCA_PROTEGIDO, redigirArvore, redigirSegredos, segredoAindaNaPagina } from "../../../src/domain/navegador-sensivel.ts";
import { botPodeAgir, deveriaPausar, PAUSA_APOS_MS, proximoControle } from "../../../src/domain/navegador-vista.ts";

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
    expect(fraseDaPergunta({ maquinas: [sp, rio], maquinaDoComputador: "m1", escolha: null }, "A Ada")).toMatchObject({ resto: ", onde já trabalha", trocar: true });
    expect(maquinaPreferida({ maquinas: [sp], maquinaDoComputador: null, escolha: "sumiu" })?.nome).toBe("vm-sp");
  });
});

describe("ensinar uma tarefa (T)", () => {
  it("grava em linguagem simples, junta digitação no mesmo campo e nunca guarda o texto", () => {
    let g = novaGravacao(0);
    for (const e of [{ tipo: "abriu", url: "https://www.itau.com.br/x" }, { tipo: "entrou", site: "itau.com.br" }, { tipo: "clicou", papel: "link", nome: "Faturas" }, { tipo: "digitou", campo: "Busca", protegido: false }, { tipo: "digitou", campo: "Busca", protegido: false }, { tipo: "escolheu", campo: "Mês", opcao: "Novembro" }] as const) g = gravar(g, e, 1000).gravacao;
    expect(g.eventos.map(fraseDoPasso)).toEqual(["Abriu itau.com.br", "Entrou em itau.com.br (senha não gravada)", 'Clicou em "Faturas"', 'Preencheu "Busca"', 'Escolheu "Novembro"']);
    expect(rotuloDaGravacao(g, 42_000)).toBe("0:42 · 5 passos");
    expect(arquivoDosPassos("Baixar a fatura do Itaú", g)).toContain("1. Abriu itau.com.br");
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
    expect(deveriaPausar({ ...v, gravacao: { desde: 0, passos: [] } }, PAUSA_APOS_MS)).toBe(false);
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

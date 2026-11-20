import { describe, expect, it } from "vitest";
import { ErroApi } from "../../../../../web/lib/erro-api.ts";
import {
  alternar, alternarTodos, alvoDoLote, avisoDoResultado, buscar, caixaDoLote, camposFaltando, categoriasDosChips, CATEGORIA_SEM_CURADORIA, detalheDaLinha,
  fraseDaConfirmacao, fraseDoFormulario, lotePedeConfirmacao, nomesDoLote, podeConectar, resultadoDoErro, rotuloDoAplicar, rotuloDoCampo, secoesDoInicio,
  textoDaSelecao, tituloDaLista, valoresDoFormulario,
} from "../../../../../web/react/marketplace/modelo.ts";
import { APPS_SIMULADOS, camposSimulados, criarApiSimulada } from "../../../../../web/react/marketplace/simulado.ts";
import type { AppDaVitrine, CampoNaTela } from "../../../../../web/react/marketplace/tipos.ts";

/**
 * As regras do Marketplace em modal sem React (web/react/marketplace/modelo.ts). Os números do Paper (D1, T1, T6, T6b)
 * saem da regra aplicada aos dados do simulador: se a regra muda, o simulador deixa de bater com o protótipo e isto acusa.
 */
const vitrine = (): readonly AppDaVitrine[] => criarApiSimulada({ latenciaMs: 0 }).ler().apps;
const app = (p: Partial<AppDaVitrine> & { slug: string }): AppDaVitrine => ({ nome: p.slug, descricao: "", categoria: "Outros", chave: false, logo: null, situacao: "nao_conectado", conectorId: null, falha: null, login: null, niveis: {}, ...p });

describe("a linha do app", () => {
  it("o app de chave diz 'Chave de API ·' antes da frase; o de login, só a frase (ou a descrição)", () => {
    expect(detalheDaLinha({ chave: true, resumo: "Vendas", descricao: "CRM" })).toBe("Chave de API · Vendas");
    expect(detalheDaLinha({ chave: false, resumo: "Resume reuniões", descricao: "x" })).toBe("Resume reuniões");
    expect(detalheDaLinha({ chave: false, descricao: "Equipes e mensagens" })).toBe("Equipes e mensagens");
  });
});

describe("as categorias dos chips", () => {
  it("Todos + as quatro mais frequentes (empate em ordem alfabética); o resto no Mais, em ordem alfabética", () => {
    const { chips, mais } = categoriasDosChips(APPS_SIMULADOS);
    expect(chips).toEqual(["Reuniões", "Comunicação", "Vendas", "Produtividade"]);
    expect(mais).toEqual([...mais].sort((a, b) => a.localeCompare(b, "pt-BR")));
    expect(mais).toContain("Projetos");
  });

  it("a categoria de quem não tem curadoria nunca vira chip, mesmo sendo a maior", () => {
    const apps = [...Array(9)].map(() => ({ categoria: CATEGORIA_SEM_CURADORIA })).concat([{ categoria: "Vendas" }]);
    const { chips, mais } = categoriasDosChips(apps);
    expect(chips).toEqual(["Vendas"]);
    expect(mais).toEqual([CATEGORIA_SEM_CURADORIA]);
  });
});

describe("a busca", () => {
  it("'reuniões' acha os três apps do T1, sem acento e sem caixa, na ordem do catálogo", () => {
    expect(buscar(vitrine(), "reuniões").map((a) => a.nome)).toEqual(["Fathom", "Fireflies", "Microsoft Teams"]);
    expect(buscar(vitrine(), "REUNIOES").map((a) => a.nome)).toEqual(["Fathom", "Fireflies", "Microsoft Teams"]);
  });

  it("o nome que começa com o termo vem antes do que só o contém, e este antes da descrição", () => {
    const apps = [app({ slug: "a", nome: "Meu Drive", descricao: "x" }), app({ slug: "b", nome: "Zeta", descricao: "drive do time" }), app({ slug: "c", nome: "Drive" })];
    expect(buscar(apps, "drive").map((a) => a.slug)).toEqual(["c", "a", "b"]);
  });

  it("a categoria filtra; com termo e categoria, os dois valem", () => {
    expect(buscar(vitrine(), "", "Vendas").every((a) => a.categoria === "Vendas")).toBe(true);
    expect(buscar(vitrine(), "crm", "Vendas").map((a) => a.slug)).toEqual(["zohocrm", "hubspot"]);
    expect(tituloDaLista(3, "reuniões", null)).toBe("3 apps para “reuniões”");
    expect(tituloDaLista(1, "crm", "Vendas")).toBe("1 app para “crm” em Vendas");
    expect(tituloDaLista(0, "", "Vendas")).toBe("Vendas");
  });
});

describe("o início (Paper D1)", () => {
  it("atenção com o Fireflies; Recomendados com os seis do protótipo; depois Produtividade com quatro", () => {
    const apps = vitrine();
    const { atencao, secoes } = secoesDoInicio(apps, categoriasDosChips(apps).chips);
    expect(atencao.map((a) => a.nome)).toEqual(["Fireflies"]);
    expect(secoes[0]?.titulo).toBe("Recomendados para você");
    expect(secoes[0]?.apps.map((a) => a.nome)).toEqual(["Fathom", "Pipedrive", "Microsoft Teams", "Freshdesk", "Asana", "Firecrawl"]);
    expect(secoes[1]?.titulo).toBe("Produtividade");
    expect(secoes[1]?.apps.map((a) => a.nome)).toEqual(["Notion", "Clockify", "ClickUp", "Google Calendar"]);
  });

  it("app conectado, desligado ou em atenção não aparece para conectar", () => {
    const apps = [app({ slug: "a", situacao: "conectado", recomendado: true }), app({ slug: "b", desligado: true, recomendado: true }), app({ slug: "c", recomendado: true })];
    expect(secoesDoInicio(apps, []).secoes[0]?.apps.map((a) => a.slug)).toEqual(["c"]);
  });
});

describe("o formulário da chave", () => {
  const um = camposSimulados("fireflies");
  const dois = camposSimulados("freshdesk");

  it("a frase do T2 (um campo) e a do T3 (endereço da conta e chave)", () => {
    const texto = (t: ReturnType<typeof fraseDoFormulario>) => t.map((x) => (typeof x === "string" ? x : `[${x.destaque}]`)).join("");
    expect(texto(fraseDoFormulario("Fireflies", um))).toBe("O Fireflies conecta com uma [chave de API]: um código que vale como senha, para o nod usar o Fireflies em seu nome.");
    expect(texto(fraseDoFormulario("Freshdesk", dois))).toBe("O Freshdesk conecta com o [endereço da sua conta] e uma [chave de API], o código que vale como senha para o nod usar o Freshdesk em seu nome.");
  });

  it("o segredo único se chama 'Chave de API'; com dois segredos, cada um fica com o rótulo do provedor", () => {
    expect(rotuloDoCampo(um[0] as CampoNaTela, um)).toBe("Chave de API");
    const duas: CampoNaTela[] = [{ nome: "a", rotulo: "Client secret", descricao: "", segredo: true, obrigatorio: true }, { nome: "b", rotulo: "API Key", descricao: "", segredo: true, obrigatorio: true }];
    expect(duas.map((c) => rotuloDoCampo(c, duas))).toEqual(["Client secret", "API Key"]);
  });

  it("Conectar só acende com todo obrigatório preenchido; o opcional não segura", () => {
    expect(podeConectar(dois, new Set())).toBe(false);
    expect(camposFaltando(dois, new Set(["subdominio"]))).toEqual(["api_key"]);
    expect(podeConectar(dois, new Set(["subdominio"]))).toBe(false);
    expect(podeConectar(dois, new Set(["subdominio", "api_key"]))).toBe(true);
    const comOpcional: CampoNaTela[] = [...um, { nome: "regiao", rotulo: "Região", descricao: "", segredo: false, obrigatorio: false }];
    expect(podeConectar(comOpcional, new Set(["api_key"]))).toBe(true);
  });

  it("os valores vão aparados e sem os vazios", () => {
    const lidos: Record<string, string> = { subdominio: "  acme ", api_key: "   " };
    expect(valoresDoFormulario(dois, (n) => lidos[n] ?? "")).toEqual({ subdominio: "acme" });
  });

  it("o erro da rota vira um resultado fechado, e o aviso nunca repete a mensagem do servidor", () => {
    expect(resultadoDoErro(new ErroApi(403, "integracao_autenticacao", "mensagem do servidor"))).toEqual({ tipo: "recusada" });
    expect(resultadoDoErro(new ErroApi(400, "entrada_invalida", "x"))).toEqual({ tipo: "invalida" });
    expect(resultadoDoErro(new ErroApi(409, "integracao_nao_configurada", "x"))).toEqual({ tipo: "nao_configurado" });
    expect(resultadoDoErro(new ErroApi(0, "servidor_indisponivel", "x"))).toEqual({ tipo: "rede" });
    expect(resultadoDoErro(new ErroApi(502, "integracao_indisponivel", "x"))).toEqual({ tipo: "indisponivel" });
    expect(resultadoDoErro(new Error("qualquer"))).toEqual({ tipo: "indisponivel" });
    expect(avisoDoResultado("Fireflies", { tipo: "recusada" })).toEqual({ frase: "O Fireflies recusou essa chave.", mais: "Confira se copiou a chave inteira, sem espaço no fim. Se ela foi apagada no Fireflies, gere outra e cole aqui." });
    expect(avisoDoResultado("Fireflies", { tipo: "conectado", conectorId: "c" })).toBeNull();
  });
});

describe("o lote do 'Quem pode usar' (Paper T6 e T6b)", () => {
  const ids = ["clarice", "ada", "frida", "cecilia", "dante"];

  it("a caixa do cabeçalho tem três estados e o texto acompanha", () => {
    expect([caixaDoLote(0, 5), caixaDoLote(2, 5), caixaDoLote(5, 5)]).toEqual(["nenhum", "misto", "todos"]);
    expect(textoDaSelecao(2, 5)).toBe("2 de 5 selecionados");
    expect(textoDaSelecao(1, 5)).toBe("1 de 5 selecionado");
    expect(textoDaSelecao(0, 5)).toBe("Selecionar todos");
    expect([rotuloDoAplicar(0), rotuloDoAplicar(1), rotuloDoAplicar(2)]).toEqual(["Aplicar a todos:", "Aplicar ao 1:", "Aplicar aos 2:"]);
  });

  it("marcar, desmarcar e a caixa do cabeçalho (todos marcados → limpa; senão → marca todos)", () => {
    const s = alternar(alternar(new Set(), "ada"), "clarice");
    expect([...s]).toEqual(["ada", "clarice"]);
    expect([...alternar(s, "ada")]).toEqual(["clarice"]);
    expect([...alternarTodos(s, ids)]).toEqual(ids);
    expect([...alternarTodos(new Set(ids), ids)]).toEqual([]);
  });

  it("sem seleção o lote vale para todos; com seleção, só os marcados que ainda são bots da pessoa", () => {
    expect(alvoDoLote(new Set(), ids)).toBe("todos");
    expect(alvoDoLote(new Set(["ada", "saiu"]), ids)).toEqual(["ada"]);
  });

  it("Ler e alterar para mais de um bot pede confirmação; para um só, ou outro nível, não", () => {
    expect(lotePedeConfirmacao("escrita", ["clarice", "ada"], 5)).toBe(true);
    expect(lotePedeConfirmacao("escrita", "todos", 5)).toBe(true);
    expect(lotePedeConfirmacao("escrita", ["ada"], 5)).toBe(false);
    expect(lotePedeConfirmacao("leitura", ["clarice", "ada"], 5)).toBe(false);
    expect(lotePedeConfirmacao("escrita", "todos", 1)).toBe(false);
  });

  it("a frase da confirmação do T6b", () => {
    expect(fraseDaConfirmacao("Fireflies", "lote", ["Clarice", "Ada"], "pôr o robô numa reunião e enviar áudio")).toEqual({
      titulo: "Liberar Ler e alterar no Fireflies para 2 bots?",
      detalhe: "Clarice e Ada poderão pôr o robô numa reunião e enviar áudio sem perguntar. Apagar fica de fora.",
    });
    expect(nomesDoLote(["A", "B", "C"])).toBe("A, B e C");
    expect(nomesDoLote(["A", "B", "C", "D", "E"])).toBe("Os 5 bots");
    expect(fraseDaConfirmacao("Notion", "padrao", [], "criar").titulo).toBe("Liberar Ler e alterar no Notion para os bots novos e quem segue o padrão?");
  });
});

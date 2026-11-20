import { beforeEach, describe, expect, it } from "vitest";
import { criarNavegadores, enderecoPermitido, type OpcoesNavegadores } from "../../../src/adapters/fundo/navegadores.ts";
import type { MotorNavegador, RefLida } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { FalhaNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../../src/contracts/ferramentas-navegador.ts";
import type { VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { PAUSA_APOS_MS } from "../../../src/domain/navegador-vista.ts";
import { executarItens } from "../../../src/use-cases/decidir.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/**
 * O portão do navegador do bot (ADR-190) com um motor falso: nunca sobe Chrome. Os repositórios são os do tamanho do
 * que o portão usa (trilha, turno, agente, parada, decisão); a decisão de aprovação e o pedido à pessoa entram pelas
 * costuras de teste (`pedirAprovacao`, `pedirAPessoa`), e o item que elas recebem é conferido.
 */
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const T0 = 1_700_000_000_000;

let agora: number;
let chamadas: { op: string; args: unknown[] }[];
let leitura: { url: string; arvore: string; refs: Record<string, RefLida> };
let urlAgora: string;
let trilha: { kind: string; motivo?: string; ferramenta: string }[];
let concluidos: Set<string>;
let modo: "manual" | "automatico" | "total";
let soLeitura: boolean;
let decisoes: Map<string, { estado: string }>;
let aprovacoes: { itens: { texto: string; destino: { conector: string; ferramenta: string; argumentos: Record<string, unknown> } }[] }[];
let pedidosAPessoa: { texto: string }[];
let vistas: VistaNavegador[];
let falhaNoClique: FalhaNavegador | null;

const motor: MotorNavegador = new Proxy({} as MotorNavegador, {
  get(_t, op: string) {
    if (op === "lugar") return { tipo: "nod" };
    return async (...args: unknown[]) => {
      chamadas.push({ op, args: args.slice(1) });
      switch (op) {
        case "abrir": urlAgora = String(args[1]); return { url: urlAgora, titulo: "Loja" };
        case "ler": return leitura;
        case "url": return urlAgora;
        case "abas": return [{ id: "t1", titulo: "Loja", url: urlAgora, ativa: true }];
        case "print": return { jpeg: "/9j/AAAA" };
        case "texto": return "Pagar agora";
        case "focado": return { papel: "button", nome: "Enviar mensagem" };
        case "clicar": if (falhaNoClique) throw falhaNoClique; return undefined;
        case "obter": return "valor";
        default: return undefined;
      }
    };
  },
});
const ops = () => chamadas.map((c) => c.op);

const deps = () => ({
  escopo: MARLON,
  agora: () => agora,
  repos: {
    trilha: { registrar: async (t: { kind: string; motivo?: string; ferramenta: string }) => { trilha.push(t); } },
    turnos: {
      buscar: async (id: string) => ({ id, estado: concluidos.has(id) ? "concluido" : "executando", agenteId: id.endsWith("b") ? B : A, ownerId: MARLON.pessoaId, conversaId: "conversa-1", pararSolicitadoEm: null, motivoInterrupcao: null }),
      pedirInterrupcao: async () => {},
    },
    agentes: { buscar: async (id: string) => ({ id, modoAprovacao: modo, soLeitura }), execucaoBloqueada: async () => false },
    paradas: { ativa: async () => false },
    decisoes: { buscar: async (id: string) => decisoes.get(id) ?? null },
    events: { gravarComOutbox: async () => {} },
  },
});

function criar(o: Partial<OpcoesNavegadores> = {}) {
  return criarNavegadores({
    dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => fn(deps() as never),
    motor: () => motor, cifrar: (s) => `c:${s}`, decifrar: (s) => s.slice(2), agora: () => agora,
    aoMudar: (_e, v) => { vistas.push(v); },
    pedirAprovacao: (async (_d: unknown, input: { itens: (typeof aprovacoes)[number]["itens"] }) => {
      aprovacoes.push({ itens: input.itens });
      const id = `decisao-${aprovacoes.length}`;
      decisoes.set(id, { estado: "pendente" });
      return { data: { estado: "pendente", decisao_id: id, instrucao: "encerre o turno; a decisão retoma depois" }, events: [] };
    }) as never,
    pedirAPessoa: (async (_d: unknown, input: { texto: string }) => {
      pedidosAPessoa.push({ texto: input.texto });
      const id = `pedido-${pedidosAPessoa.length}`;
      decisoes.set(id, { estado: "pendente" });
      return { data: { estado: "pendente", decisao_id: id, instrucao: "encerre o turno; a resposta retoma depois" }, events: [] };
    }) as never,
    ...o,
  });
}

const plano = (agenteId = A, o: { expiraEm?: number; ferramentas?: string[] } = {}) => ({
  tenantId: MARLON.tenantId, turnoId: `turno-${agenteId.slice(-1)}`, agenteId, conversaId: "conversa-1", expiraEm: o.expiraEm ?? Number.MAX_SAFE_INTEGER, confiancaEntrada: "confiavel",
  autoria: { conta_de_execucao: MARLON.pessoaId, sob_procuracao_de: null },
  catalogo: { ferramentas: (o.ferramentas ?? Object.keys(FERRAMENTAS_NAVEGADOR_DIRETAS)).map((nome) => ({ nome, origem: "navegador" })) },
}) as never;

const corpo = (r: unknown) => JSON.parse((r as { conteudo: string }).conteudo) as Record<string, unknown>;

beforeEach(() => {
  agora = T0;
  chamadas = [];
  urlAgora = "https://loja.exemplo.com/carrinho";
  leitura = { url: urlAgora, arvore: '- button "Pagar R$ 120,00" [ref=e1]\n- textbox "Senha" [ref=e2]: hunter22\n- button "Enviar" [ref=e3]\n- link "Alterar senha" [ref=e4]\n- button "Ver mais" [ref=e5]', refs: { e1: { papel: "button", nome: "Pagar R$ 120,00" }, e2: { papel: "textbox", nome: "Senha" }, e3: { papel: "button", nome: "Enviar" }, e4: { papel: "link", nome: "Alterar senha" }, e5: { papel: "button", nome: "Ver mais" } } };
  trilha = [];
  concluidos = new Set();
  modo = "manual";
  soLeitura = false;
  decisoes = new Map();
  aprovacoes = [];
  pedidosAPessoa = [];
  vistas = [];
  falhaNoClique = null;
});

describe("negações do portão (molde de computadores.chamar)", () => {
  it("fora do catálogo do plano, plano vencido, turno parado e esquema inválido viram negação na trilha, sem motor", async () => {
    const n = criar();
    expect(await n.chamar(MARLON, plano(A, { ferramentas: ["navegador_ler"] }), "navegador_clicar", { alvo: "@e1" })).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
    expect(await n.chamar(MARLON, plano(A, { expiraEm: T0 - 1 }), "navegador_ler", {})).toMatchObject({ ok: false, negacao: { motivo: "plano_expirado" } });
    concluidos.add("turno-a");
    expect(await n.chamar(MARLON, plano(A), "navegador_ler", {})).toMatchObject({ ok: false, negacao: { motivo: "parada_ativa" } });
    concluidos.clear();
    expect(await n.chamar(MARLON, plano(A), "navegador_clicar", {})).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
    expect(await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_rm_rf" })).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
    // O nome do catálogo entra só por navegador_usar: chamá-lo direto é fora do catálogo do plano.
    expect(await n.chamar(MARLON, plano(A), "navegador_texto", {})).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
    expect(trilha.map((t) => t.motivo)).toEqual(["fora_do_catalogo", "plano_expirado", "parada_ativa", "args_invalidos", "args_invalidos", "fora_do_catalogo"]);
    expect(chamadas).toEqual([]);
  });

  it("plano de outra pessoa é fora do catálogo", async () => {
    const r = await criar().chamar({ ...MARLON, pessoaId: "00000000-0000-4000-8000-0000000000ff" }, plano(A), "navegador_ler", {});
    expect(r).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
  });

  it("sem motor no lugar, responde indisponível com o motivo, sem negar nem subir Chrome", async () => {
    const n = criar({ motor: () => null, motivoIndisponivel: "O navegador do bot não roda neste servidor agora." });
    const r = await n.chamar(MARLON, plano(A), "navegador_abrir", { url: "https://exemplo.com" });
    expect(r).toMatchObject({ ok: true, isError: true });
    expect(corpo(r)).toMatchObject({ erro: "indisponivel", instrucao: expect.stringContaining("não roda neste servidor") });
    expect(n.disponivel()).toBe(false);
    expect(n.vivos()).toBe(0);
  });

  it("bot em só leitura lê, mas clicar é negado (ADR-166)", async () => {
    soLeitura = true;
    const n = criar();
    expect(await n.chamar(MARLON, plano(A), "navegador_ler", {})).toMatchObject({ ok: true });
    expect(await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e5" })).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });
  });
});

describe("catálogo: buscar e usar", () => {
  it("navegador_buscar responde do catálogo sem tocar no motor", async () => {
    const r = await criar().chamar(MARLON, plano(A), "navegador_buscar", { busca: "abas e voltar" });
    expect(chamadas).toEqual([]);
    const nomes = (corpo(r).ferramentas as { nome: string }[]).map((f) => f.nome);
    expect(nomes).toEqual(expect.arrayContaining(["navegador_abas", "navegador_historico"]));
  });

  it("navegador_usar chama a ferramenta do catálogo com os argumentos dela", async () => {
    const r = await criar().chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_texto", argumentos: {} });
    expect(r).toMatchObject({ ok: true, confianca: "nao_confiavel" });
    expect(corpo(r)).toMatchObject({ texto: "Pagar agora" });
    expect(ops()).toEqual(["texto"]);
  });
});

describe("ler → agir por referência", () => {
  it("a leitura sai com a senha trocada por [campo protegido] e não confiável", async () => {
    const r = await criar().chamar(MARLON, plano(A), "navegador_ler", {});
    expect(r).toMatchObject({ ok: true, confianca: "nao_confiavel" });
    const arvore = String(corpo(r).arvore);
    expect(arvore).toContain('textbox "Senha" [ref=e2]: [campo protegido]');
    expect(arvore).not.toContain("hunter22");
  });

  it("referência que não está na última leitura é recusada com 'leia de novo', sem clicar", async () => {
    const n = criar();
    const sem = await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e5" });
    expect(corpo(sem)).toMatchObject({ erro: "alvo_invalido", detalhe: expect.stringContaining("Leia de novo") });
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    const fora = await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e99" });
    expect(fora).toMatchObject({ ok: true, isError: true });
    expect(ops()).not.toContain("clicar");
  });

  it("clique livre passa direto; a página que muda invalida as referências", async () => {
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    urlAgora = "https://loja.exemplo.com/mais";
    const r = await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e5" });
    expect(corpo(r)).toMatchObject({ ok: true, url: "https://loja.exemplo.com/mais", instrucao: expect.stringContaining("leia de novo") });
    expect(ops()).toContain("clicar");
    expect(corpo(await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e5" }))).toMatchObject({ erro: "alvo_invalido" });
  });

  it("preencher um campo de senha é recusado (senha só por navegador_entrar)", async () => {
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    const r = await n.chamar(MARLON, plano(A), "navegador_preencher", { alvo: "@e2", texto: "x" });
    expect(corpo(r)).toMatchObject({ erro: "campo_protegido" });
    expect(ops()).not.toContain("preencher");
    const valor = await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_obter", argumentos: { o_que: "valor", alvo: "@e2" } });
    expect(corpo(valor)).toMatchObject({ erro: "campo_protegido" });
    const css = await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_obter", argumentos: { o_que: "atributo", alvo: "input[type=password]", nome: "value" } });
    expect(corpo(css)).toMatchObject({ erro: "campo_protegido" });
    expect(ops()).not.toContain("obter");
  });

  it("abrir só aceita http(s) da internet", async () => {
    const r = await criar().chamar(MARLON, plano(A), "navegador_abrir", { url: "http://127.0.0.1:5280/api" });
    expect(corpo(r)).toMatchObject({ erro: "endereco_recusado" });
    expect(ops()).not.toContain("abrir");
    expect(enderecoPermitido("https://www.exemplo.com.br/x")).toBe(true);
    for (const u of ["file:///etc/passwd", "http://localhost:3000", "http://169.254.169.254/latest", "http://10.0.0.5", "http://192.168.1.1", "http://[::1]/", "javascript:alert(1)", "http://metadata.google.internal/", "http://2130706433/"]) expect(enderecoPermitido(u), u).toBe(false);
  });

  it("navegador_ver devolve o print em JPEG", async () => {
    const r = await criar().chamar(MARLON, plano(A), "navegador_ver", {});
    expect(r).toMatchObject({ ok: true, confianca: "nao_confiavel", imagem: { mimeType: "image/jpeg", data: "/9j/AAAA" } });
  });
});

describe("aprovação no ponto sem volta (quadro A)", () => {
  it("pagar vira decisão com a ação cifrada no item; nada é clicado; a vista espera a pessoa", async () => {
    modo = "total";
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    const r = await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e1" });
    expect(r).toEqual({ aguardar: "decisao-1" });
    expect(ops()).not.toContain("clicar");
    const item = aprovacoes[0]!.itens[0]!;
    expect(item.texto).toBe("Pagar R$ 120,00 no loja.exemplo.com?");
    expect(item.destino).toMatchObject({ conector: "navegador", ferramenta: "executar", argumentos: { acaoId: expect.stringMatching(/^[0-9a-f-]{36}$/), acao: expect.stringMatching(/^c:/) } });
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "precisa_de_voce", pedido: { tipo: "aprovacao", decisaoId: "decisao-1", touchId: true } });
    // Enquanto a pessoa não responde, o bot espera.
    expect(corpo(await n.chamar(MARLON, plano(A), "navegador_ler", {}))).toMatchObject({ estado: "aguardando_pessoa" });
  });

  it("aprovada, a ação roda como foi pedida e o resultado volta uma vez ao turno", async () => {
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e1" });
    const { acaoId, acao } = aprovacoes[0]!.itens[0]!.destino.argumentos as { acaoId: string; acao: string };
    chamadas = [];
    await n.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId, acao });
    expect(chamadas.find((c) => c.op === "clicar")?.args).toEqual(["@e1", false]);
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "bot", pedido: null });
    expect(JSON.parse(n.resultadoDaAcao(MARLON, acaoId)!)).toMatchObject({ ok: true });
    expect(n.resultadoDaAcao(MARLON, acaoId)).toBeNull();
  });

  it("a ação aprovada não roda noutro turno nem noutro bot", async () => {
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e1" });
    const { acaoId, acao } = aprovacoes[0]!.itens[0]!.destino.argumentos as { acaoId: string; acao: string };
    await expect(n.executarAprovado({ ...MARLON, agenteId: B, turnoId: "turno-b", acaoId, acao })).rejects.toMatchObject({ codigo: "nao_permitido" });
  });

  it("enviar pede no manual e passa no total; apagar pede no automático", async () => {
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    expect(await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e3" })).toEqual({ aguardar: "decisao-1" });
    decisoes.set("decisao-1", { estado: "decidida" });
    modo = "total";
    expect(corpo(await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e3" }))).toMatchObject({ ok: true });
    // A decisão respondida devolveu o controle ao bot.
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "bot", pedido: null });
    leitura = { ...leitura, arvore: '- button "Excluir conta" [ref=e1]', refs: { e1: { papel: "button", nome: "Excluir conta" } } };
    modo = "automatico";
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    expect(await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e1" })).toEqual({ aguardar: "decisao-2" });
  });

  it("Enter num campo de formulário classifica pelo botão que ele dispara", async () => {
    expect(await criar().chamar(MARLON, plano(A), "navegador_tecla", { tecla: "Enter" })).toEqual({ aguardar: "decisao-1" });
    expect(ops()).toEqual(["focado"]);
  });

  it("seletor CSS no clique é classificado pelo texto do elemento (pior caso: botão)", async () => {
    expect(await criar().chamar(MARLON, plano(A), "navegador_clicar", { alvo: "#pagar" })).toEqual({ aguardar: "decisao-1" });
  });

  it("trocar senha é a pessoa que faz: instrução de pedir ajuda, sem clicar nem decisão", async () => {
    modo = "total";
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    const r = await n.chamar(MARLON, plano(A), "navegador_clicar", { alvo: "@e4" });
    expect(corpo(r)).toMatchObject({ erro: "a_pessoa_faz", instrucao: expect.stringContaining("navegador_pedir_ajuda") });
    expect(aprovacoes).toEqual([]);
    expect(ops()).not.toContain("clicar");
  });
});

describe("controle e pedidos à pessoa", () => {
  it("com a pessoa no controle, o bot recebe aguardando_pessoa e nada roda", async () => {
    const n = criar();
    expect(n.controlar(MARLON, A, "assumir")).toMatchObject({ controle: "pessoa" });
    const r = await n.chamar(MARLON, plano(A), "navegador_ler", {});
    expect(corpo(r)).toMatchObject({ estado: "aguardando_pessoa" });
    expect(chamadas).toEqual([]);
    n.controlar(MARLON, A, "devolver");
    expect(await n.chamar(MARLON, plano(A), "navegador_ler", {})).toMatchObject({ ok: true });
  });

  it("pedir ajuda e entrar criam o pedido, põem o controle em precisa_de_voce e a resposta devolve ao bot", async () => {
    const n = criar();
    const r = await n.chamar(MARLON, plano(A), "navegador_entrar", { site: "gmail.com", motivo: "ler a fatura" });
    expect(corpo(r)).toMatchObject({ estado: "pendente", decisao_id: "pedido-1" });
    expect(pedidosAPessoa[0]!.texto).toContain("gmail.com");
    expect(pedidosAPessoa[0]!.texto).toContain("A senha não passa por mim");
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "precisa_de_voce", pedido: { tipo: "login", site: "gmail.com" } });
    expect(corpo(await n.chamar(MARLON, plano(A), "navegador_ler", {}))).toMatchObject({ estado: "aguardando_pessoa" });
    decisoes.set("pedido-1", { estado: "respondida" });
    expect(await n.chamar(MARLON, plano(A), "navegador_ler", {})).toMatchObject({ ok: true, confianca: "nao_confiavel" });
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "bot", pedido: null });
    expect(chamadas.map((c) => c.op)).toEqual(["ler"]);
  });

  it("a vista é só da dona do bot", async () => {
    const n = criar();
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    expect(n.vista({ ...MARLON, pessoaId: "00000000-0000-4000-8000-0000000000ff" }, A)).toBeNull();
    expect(n.vista(MARLON, A)).toMatchObject({ agenteId: A, estado: "ao_vivo", lugar: { tipo: "nod" } });
    expect(vistas.some((v) => v.passo?.frase === "Lendo a página")).toBe(true);
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    expect(vistas.some((v) => v.passo?.frase === "Lendo loja.exemplo.com")).toBe(true);
  });
});

describe("segredo na página (L3)", () => {
  it("leitura, print e eval travam até a URL mudar", async () => {
    const n = criar();
    n.marcarSegredo(MARLON, A, urlAgora);
    expect(corpo(await n.chamar(MARLON, plano(A), "navegador_ler", {}))).toMatchObject({ erro: "segredo_na_pagina" });
    expect(await n.chamar(MARLON, plano(A), "navegador_ver", {})).not.toHaveProperty("imagem");
    expect(corpo(await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_avaliar", argumentos: { expressao: "1+1" } }))).toMatchObject({ erro: "segredo_na_pagina" });
    expect(ops()).not.toContain("ler");
    expect(ops()).not.toContain("print");
    urlAgora = "https://loja.exemplo.com/conta#topo";
    expect(await n.chamar(MARLON, plano(A), "navegador_ler", {})).toMatchObject({ ok: true });
    expect(n.vista(MARLON, A)).toMatchObject({ segredoNaPagina: false });
  });

  it("eval recusa cookie e armazenamento", async () => {
    const r = await criar().chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_avaliar", argumentos: { expressao: "document.cookie" } });
    expect(corpo(r)).toMatchObject({ erro: "expressao_recusada" });
    expect(ops()).not.toContain("avaliar");
  });
});

describe("limite de Chromes vivos (NOD_NAVEGADORES_MAX)", () => {
  it("sem vaga, o segundo bot fica na fila; o primeiro parado há 10 min cede a vaga e pausa", async () => {
    const n = criar({ max: 1 });
    await n.chamar(MARLON, plano(A), "navegador_ler", {});
    expect(n.vivos()).toBe(1);
    const fila = await n.chamar(MARLON, plano(B), "navegador_ler", {});
    expect(corpo(fila)).toMatchObject({ estado: "na_fila" });
    agora += PAUSA_APOS_MS;
    expect(await n.chamar(MARLON, plano(B), "navegador_ler", {})).toMatchObject({ ok: true, confianca: "nao_confiavel" });
    expect(n.vista(MARLON, A)).toMatchObject({ estado: "pausa" });
    expect(n.vivos()).toBe(1);
    expect(chamadas.filter((c) => c.op === "fechar")).toHaveLength(1);
  });
});

describe("script", () => {
  it("roda os passos pelo mesmo portão e para no que pede a pessoa", async () => {
    const n = criar();
    const r = await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_rodar_script", argumentos: { passos: [
      { ferramenta: "navegador_ler", argumentos: {} },
      { ferramenta: "navegador_clicar", argumentos: { alvo: "@e5" } },
      { ferramenta: "navegador_clicar", argumentos: { alvo: "@e1" } },
      { ferramenta: "navegador_clicar", argumentos: { alvo: "@e5" } },
    ] } });
    expect(r).toEqual({ aguardar: "decisao-1" });
    expect(ops().filter((o) => o === "clicar")).toHaveLength(1);
  });

  it("para no primeiro erro e diz o passo; script dentro de script não roda", async () => {
    falhaNoClique = new FalhaNavegador("alvo_invalido", "Unknown ref: e5");
    const n = criar();
    const r = await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_rodar_script", argumentos: { passos: [
      { ferramenta: "navegador_ler", argumentos: {} },
      { ferramenta: "navegador_clicar", argumentos: { alvo: "@e5" } },
      { ferramenta: "navegador_ler", argumentos: {} },
    ] } });
    expect(corpo(r)).toMatchObject({ parou_em: 2, erro: "alvo_invalido", passos: [expect.objectContaining({ passo: 1, ferramenta: "navegador_ler" })] });
    const aninhado = await n.chamar(MARLON, plano(A), "navegador_usar", { ferramenta: "navegador_rodar_script", argumentos: { passos: [{ ferramenta: "navegador_rodar_script", argumentos: { passos: [] } }] } });
    expect(corpo(aninhado)).toMatchObject({ parou_em: 1, erros: [expect.stringContaining("não roda num script")] });
  });
});

describe("decisão aprovada → executarItens", () => {
  it("o item do navegador vai ao portão do navegador; sem serviço, falhou na execução", async () => {
    const recebidos: unknown[] = [];
    const item = { id: "i1", decisaoId: "d1", selecionado: true, origemSensivel: false, destino: { conector: "navegador", ferramenta: "executar", argumentos: {} } } as never;
    const navegador = { tenantId: MARLON.tenantId, pessoaId: MARLON.pessoaId, agenteId: A, turnoId: "turno-a", acaoId: "x", acao: "c:{}" };
    const services = { conectores: {}, computadores: undefined, github: undefined, navegadores: { disponivel: () => true, executarAprovado: async (p: unknown) => { recebidos.push(p); } } } as never;
    expect(await executarItens(services, [{ item, conectorId: null, navegador }])).toEqual([{ itemId: "i1", desfecho: "executado" }]);
    expect(recebidos).toEqual([navegador]);
    expect(await executarItens({ conectores: {} } as never, [{ item, conectorId: null, navegador }])).toEqual([{ itemId: "i1", desfecho: "falhou_na_execucao" }]);
  });
});

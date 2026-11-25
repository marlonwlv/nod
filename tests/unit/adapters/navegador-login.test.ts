import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVISO_SEM_TOUCH_ID, CHROME_SEM_SESSAO, CONFIRME_NO_MAC, criarNavegadores, fraseDaMaquina, TROUXE_DO_CHROME, type OpcoesNavegadores } from "../../../src/adapters/fundo/navegadores.ts";
import type { MacDaPessoa } from "../../../src/adapters/navegador/mac-da-pessoa.ts";
import type { MotorNavegador, RefLida } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { FalhaNavegador, SELETOR_CAMPO } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../../../src/contracts/ferramentas-navegador.ts";
import type { EntradaNavegador, VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";
import { SEM_LIBERACOES, type LiberacoesNavegador } from "../../../src/domain/navegador-aprovacao.ts";
import { DIGITADO_DURA_MS, googleRecusouOLogin, MOTIVO_SEM_MAC } from "../../../src/domain/navegador-cofre.ts";
import type { ElementoNaPagina } from "../../../src/domain/navegador-ensinar.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/**
 * O login com cofre, o código por SMS, a oferta de guardar e a aprovação completa do navegador do bot (ADR-190, L e A;
 * ADR-177), no portão com um motor e um Mac falsos. O teste do segredo junta TUDO o que o portão gravou ou mandou
 * (vistas, pedidos, retomadas, aprovações, trilha, log, respostas e os argumentos do motor) e procura a senha e o código:
 * eles só podem aparecer no `inserirTexto` (o relay que digita no campo), nunca em outro lugar.
 */
const logs = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../../src/obs/log.ts", () => ({ log: (...a: unknown[]) => { logs.push(a); } }));

const A = "00000000-0000-4000-8000-00000000000a";
const LOGIN_ID = "00000000-0000-4000-8000-0000000000e1";
const MAC = "00000000-0000-4000-8000-0000000000c1";
const SENHA = "Segredo#Itau-2026";
const CODIGO = "918273";
const T0 = 1_700_000_000_000;

let agora: number;
let chamadas: { op: string; args: unknown[] }[];
let urlAgora: string;
let leitura: { url: string; arvore: string; refs: Record<string, RefLida> };
let campos: { usuario: boolean; senha: boolean; codigo: boolean };
let textoDaPagina: string;
let elemento: ElementoNaPagina | null;
let trilha: unknown[];
let decisoes: Map<string, { estado: string }>;
let aprovacoes: { resumo?: string; itens: { texto: string; destino: { argumentos: Record<string, unknown> } }[] }[];
let pedidosAPessoa: { texto: string }[];
let retomadas: { decisaoId: string; texto: string }[];
let vistas: VistaNavegador[];
let liberacoes: LiberacoesNavegador;
let gravadas: LiberacoesNavegador[];
let cofreCriados: { site: string; usuario: string; senhaCifrada: string }[];
let respostas: unknown[];
let mac: { ligado: boolean; lista: Awaited<ReturnType<MacDaPessoa["listar"]>>; chamadas: { op: string; args: unknown[] }[]; touch: "confirmado" | "recusado"; falhaLer: FalhaNavegador | null; cookies: { name: string; value: string; domain: string; path: string; expires: number; secure: boolean; httpOnly: boolean; sameSite: "Lax" }[] };
let lugarMac: boolean;
/** QA-203: o login do Itaú apagado na tela Cofre depois que o cartão montou as opções. */
let loginApagado: boolean;

const motor: MotorNavegador = new Proxy({} as MotorNavegador, {
  get(_t, op: string) {
    if (op === "lugar") return { tipo: "nod" };
    return async (...args: unknown[]) => {
      chamadas.push({ op, args: args.slice(1) });
      switch (op) {
        case "abrir": urlAgora = String(args[1]); return { url: urlAgora, titulo: "Itaú" };
        case "ler": return { ...leitura, url: urlAgora };
        case "url": return urlAgora;
        case "abas": return [{ id: "t1", titulo: "Itaú", url: urlAgora, ativa: true }];
        case "camposDeLogin": return campos;
        case "texto": return textoDaPagina;
        case "obter": return args[1] === "caixa" ? { x: 10, y: 20, w: 120, h: 40 } : args[1] === "titulo" ? "WhatsApp" : null;
        case "descreverElemento": return elemento;
        case "focado": return { papel: "button", nome: "Entrar" };
        default: return undefined;
      }
    };
  },
});

const macFalso: MacDaPessoa = {
  maquina: () => (mac.ligado ? MAC : null),
  listar: async (...a) => { mac.chamadas.push({ op: "listar", args: a.slice(1) }); return mac.lista; },
  preencher: async (...a) => { mac.chamadas.push({ op: "preencher", args: a.slice(1) }); return { usuario: true, senha: true }; },
  ler: async (...a) => { mac.chamadas.push({ op: "ler", args: a.slice(1) }); if (mac.falhaLer) throw mac.falhaLer; return { usuario: "marlon@exemplo.com", senha: SENHA }; },
  guardar: async (...a) => { mac.chamadas.push({ op: "guardar", args: a.slice(1, 4) }); },
  cookies: async (...a) => { mac.chamadas.push({ op: "cookies", args: a.slice(1) }); return a[3] ? mac.cookies.length : mac.cookies; },
  touchId: async (...a) => { mac.chamadas.push({ op: "touchId", args: a.slice(1) }); return mac.touch; },
};

const deps = () => ({
  escopo: MARLON,
  agora: () => agora,
  repos: {
    trilha: { registrar: async (t: unknown) => { trilha.push(t); } },
    turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: A, ownerId: MARLON.pessoaId, conversaId: "conversa-1", pararSolicitadoEm: null, motivoInterrupcao: null }), pedirInterrupcao: async () => {} },
    agentes: { buscar: async (id: string) => (id === A ? { id, ownerId: MARLON.pessoaId, modoAprovacao: "manual", soLeitura: false } : null), execucaoBloqueada: async () => false },
    navegadorPreferencias: {
      liberacoes: async () => liberacoes,
      gravar: async (_a: string, p: { liberacoes: LiberacoesNavegador }) => { gravadas.push(p.liberacoes); liberacoes = p.liberacoes; return { agenteId: A }; },
    },
    navegadorTarefas: { doAgente: async () => [] },
    cofreLogins: {
      listar: async () => [...(loginApagado ? [] : [{ id: LOGIN_ID, site: "itau.com.br", usuario: "marlon@exemplo.com", criadoEm: T0 }]), { id: "outro", site: "bradesco.com.br", usuario: "m", criadoEm: T0 }],
      paraPreencher: async (id: string) => (id === LOGIN_ID && !loginApagado ? { site: "itau.com.br", usuario: "marlon@exemplo.com", senhaCifrada: `c:${SENHA}` } : null),
      criar: async (l: { site: string; usuario: string; senhaCifrada: string }) => { cofreCriados.push(l); return { id: "novo", site: l.site, usuario: l.usuario, criadoEm: agora }; },
    },
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
    retomarPedido: async (_e, decisaoId, texto) => { retomadas.push({ decisaoId, texto }); decisoes.set(decisaoId, { estado: "respondida" }); },
    pedirAprovacao: (async (_d: unknown, input: (typeof aprovacoes)[number]) => {
      aprovacoes.push(input);
      const id = `decisao-${aprovacoes.length}`;
      decisoes.set(id, { estado: "pendente" });
      return { data: { estado: "pendente", decisao_id: id, instrucao: "encerre o turno" }, events: [] };
    }) as never,
    pedirAPessoa: (async (_d: unknown, input: { texto: string }) => {
      pedidosAPessoa.push({ texto: input.texto });
      const id = `pedido-${pedidosAPessoa.length}`;
      decisoes.set(id, { estado: "pendente" });
      return { data: { estado: "pendente", decisao_id: id, instrucao: "encerre o turno" }, events: [] };
    }) as never,
    mac: macFalso,
    maquinaDoLugar: () => (lugarMac ? MAC : null),
    ...o,
  });
}

const plano = (ferramentas = [...Object.keys(FERRAMENTAS_NAVEGADOR_DIRETAS)]) => ({
  tenantId: MARLON.tenantId, turnoId: "turno-a", agenteId: A, conversaId: "conversa-1", expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: "confiavel",
  autoria: { conta_de_execucao: MARLON.pessoaId, sob_procuracao_de: null },
  catalogo: { ferramentas: ferramentas.map((nome) => ({ nome, origem: "navegador" })) },
}) as never;
const corpo = (r: unknown) => JSON.parse((r as { conteudo: string }).conteudo) as Record<string, unknown>;

async function chamar(n: ReturnType<typeof criar>, nome: string, args: unknown) {
  const r = await n.chamar(MARLON, plano(), nome, args);
  respostas.push(r);
  return r;
}

/** A página de login do Itaú aberta e o cartão de login pedido. */
async function noLoginDoItau(n: ReturnType<typeof criar>) {
  await chamar(n, "navegador_abrir", { url: "https://www.itau.com.br/login" });
  await chamar(n, "navegador_entrar", { site: "Itaú", motivo: "baixar a fatura de novembro" });
  return "pedido-1";
}

/** Tudo o que o portão gravou ou mandou, menos a digitação do relay (onde o segredo TEM de ir). */
function tudoQueSaiu(): string {
  const doMotor = chamadas.filter((c) => c.op !== "inserirTexto");
  return JSON.stringify({ vistas, pedidosAPessoa, retomadas, aprovacoes, trilha, logs, respostas, doMotor, mac: mac.chamadas.filter((c) => c.op !== "guardar") });
}

beforeEach(() => {
  agora = T0;
  chamadas = [];
  urlAgora = "about:blank";
  leitura = { url: "https://web.whatsapp.com/", arvore: '- button "Enviar" [ref=e1]\n- button "Pagar R$ 3.780" [ref=e2]', refs: { e1: { papel: "button", nome: "Enviar" }, e2: { papel: "button", nome: "Pagar R$ 3.780" } } };
  campos = { usuario: true, senha: true, codigo: false };
  textoDaPagina = "Conversa com Pedro Álvares";
  elemento = null;
  trilha = [];
  decisoes = new Map();
  aprovacoes = [];
  pedidosAPessoa = [];
  retomadas = [];
  vistas = [];
  liberacoes = SEM_LIBERACOES;
  gravadas = [];
  cofreCriados = [];
  respostas = [];
  logs.length = 0;
  mac = { ligado: true, lista: [{ fonte: "1password", ref: "op://v1/i1/password", rotulo: "Itaú · marlon@…", disponivel: true }], chamadas: [], touch: "confirmado", falhaLer: null, cookies: [{ name: "sessao", value: "abc", domain: ".itau.com.br", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }] };
  lugarMac = false;
  loginApagado = false;
});

describe("L1: o cartão de login monta as opções sem segredo", () => {
  it("1Password primeiro, depois o cofre do nod do mesmo site (nunca o de outro), e o Chrome com o Mac ligado", async () => {
    const n = criar();
    await noLoginDoItau(n);
    expect(mac.chamadas).toEqual([{ op: "listar", args: [A, "www.itau.com.br"] }]);
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "pessoa", pedido: {
      tipo: "login", decisaoId: "pedido-1", site: "Itaú", etapa: "escolher", erro: null, podeTrazerDoChrome: true,
      opcoes: [{ fonte: "1password", ref: "op://v1/i1/password", rotulo: "Itaú · marlon@…", disponivel: true }, { fonte: "nod", ref: LOGIN_ID, rotulo: "itau.com.br · marlon@…", disponivel: true }],
    } });
    expect(pedidosAPessoa[0]!.texto).toContain("não passa por mim");
  });

  it("com o Mac desligado o cofre do nod vem primeiro e o 1Password visto antes fica cinza, sem o Chrome", async () => {
    const n = criar();
    await noLoginDoItau(n);
    decisoes.set("pedido-1", { estado: "respondida" });
    mac.ligado = false;
    await chamar(n, "navegador_entrar", { site: "Itaú", motivo: "de novo" });
    const p = n.vista(MARLON, A)!.pedido;
    expect(p).toMatchObject({ tipo: "login", podeTrazerDoChrome: false, opcoes: [{ fonte: "nod", disponivel: true }, { fonte: "1password", disponivel: false, motivoIndisponivel: MOTIVO_SEM_MAC }] });
  });

  it("sem cofre nenhum: só o cofre do nod do site (a web mostra 'Entrar eu mesmo' como principal se nada vier)", async () => {
    const n = criar({ mac: undefined });
    await chamar(n, "navegador_abrir", { url: "https://www.exemplo.com/" });
    await chamar(n, "navegador_entrar", { site: "exemplo.com", motivo: "x" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ tipo: "login", opcoes: [], podeTrazerDoChrome: false });
  });
});

describe("L3: preencher sem o bot ver", () => {
  it("QA-203: login apagado do cofre com o cartão aberto — a opção sai do cartão, que diz por quê; nada é digitado", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    loginApagado = true;
    const e = await n.escolherLogin(MARLON, A, decisao, { fonte: "nod", ref: LOGIN_ID }).catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: "estado_invalido", cause: "login_saiu" });
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "pessoa", pedido: { tipo: "login", decisaoId: decisao, etapa: "escolher", erro: expect.stringContaining("saiu do cofre"), opcoes: [{ fonte: "1password" }] } });
    expect(JSON.stringify(n.vista(MARLON, A)!.pedido)).not.toContain(LOGIN_ID);
    expect(ops()).not.toContain("inserirTexto");
    expect(retomadas).toEqual([]);
  });

  it("cofre do nod: o servidor decifra e digita pelo relay; a senha não aparece em mais nada; a página trava", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    const r = await n.escolherLogin(MARLON, A, decisao, { fonte: "nod", ref: LOGIN_ID });
    respostas.push(r);
    expect(r.aviso).toBeNull();
    const digitou = chamadas.filter((c) => c.op === "inserirTexto");
    expect(digitou).toEqual([{ op: "inserirTexto", args: [SELETOR_CAMPO.senha, SENHA] }]);
    expect(chamadas.find((c) => c.op === "preencher" && c.args[0] === SELETOR_CAMPO.usuario)?.args).toEqual([SELETOR_CAMPO.usuario, "marlon@exemplo.com"]);
    expect(ops()).not.toContain("clicar");
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "bot", pedido: null, segredoNaPagina: true });
    expect(retomadas).toEqual([{ decisaoId: decisao, texto: expect.stringContaining("Login preenchido no itau.com.br") }]);
    // O bot volta e a leitura está travada até a página mudar.
    expect(corpo(await chamar(n, "navegador_ler", {}))).toMatchObject({ erro: "segredo_na_pagina" });
    expect(tudoQueSaiu()).not.toContain(SENHA);
  });

  it("1Password com o navegador no servidor: o Mac lê, o servidor digita; a resposta diz 'Confirme no seu Mac'", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    const r = await n.escolherLogin(MARLON, A, decisao, { fonte: "1password", ref: "op://v1/i1/password" });
    respostas.push(r);
    expect(r).toMatchObject({ aviso: CONFIRME_NO_MAC, vista: { pedido: { etapa: "confirme_no_mac" } } });
    await n.esperarLogin(A);
    expect(mac.chamadas.at(-1)).toEqual({ op: "ler", args: [A, "1password", "op://v1/i1/password", "www.itau.com.br"] });
    expect(chamadas.filter((c) => c.op === "inserirTexto")).toEqual([{ op: "inserirTexto", args: [SELETOR_CAMPO.senha, SENHA] }]);
    expect(n.vista(MARLON, A)).toMatchObject({ pedido: null, segredoNaPagina: true });
    expect(tudoQueSaiu()).not.toContain(SENHA);
  });

  it("com o navegador no próprio Mac, o Mac preenche lá e o segredo nem passa pelo servidor", async () => {
    lugarMac = true;
    const n = criar({ lugarDe: async () => ({ tipo: "roda", lugar: { tipo: "mac", nome: "Mac" }, desvio: null }) });
    const decisao = await noLoginDoItau(n);
    await n.escolherLogin(MARLON, A, decisao, { fonte: "bitwarden", ref: "item-1" });
    await n.esperarLogin(A);
    expect(mac.chamadas.map((c) => c.op)).toEqual(["listar", "preencher"]);
    expect(chamadas.some((c) => c.op === "inserirTexto")).toBe(false);
    expect(n.vista(MARLON, A)).toMatchObject({ pedido: null, segredoNaPagina: true });
  });

  it("recusou no Mac: o cartão volta a escolher, com a frase; o bot continua esperando", async () => {
    mac.falhaLer = new FalhaNavegador("recusado", "cancelou");
    const n = criar();
    const decisao = await noLoginDoItau(n);
    await n.escolherLogin(MARLON, A, decisao, { fonte: "1password", ref: "op://v1/i1/password" });
    await n.esperarLogin(A);
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "pessoa", pedido: { etapa: "escolher", erro: "Você não confirmou no Mac. Escolha de novo." } });
    expect(retomadas).toEqual([]);
  });

  it("a página mudou de site depois do cartão: nada é preenchido; item de outro site nunca é usado", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    urlAgora = "https://itau.com.br.golpe.com/login";
    await expect(n.escolherLogin(MARLON, A, decisao, { fonte: "nod", ref: LOGIN_ID })).rejects.toThrow("estado_invalido");
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ erro: "A página mudou de site. Peça o login de novo." });
    urlAgora = "https://www.itau.com.br/login";
    await expect(n.escolherLogin(MARLON, A, decisao, { fonte: "nod", ref: "outro" })).rejects.toThrow("nao_encontrado");
    expect(chamadas.some((c) => c.op === "inserirTexto")).toBe(false);
  });

  it("página só com o usuário (login em duas etapas): preenche o usuário, não trava e diz ao bot para avançar", async () => {
    campos = { usuario: true, senha: false, codigo: false };
    const n = criar();
    const decisao = await noLoginDoItau(n);
    await n.escolherLogin(MARLON, A, decisao, { fonte: "nod", ref: LOGIN_ID });
    expect(chamadas.some((c) => c.op === "inserirTexto")).toBe(false);
    expect(n.vista(MARLON, A)).toMatchObject({ segredoNaPagina: false, pedido: null });
    expect(retomadas[0]!.texto).toContain("Preenchi só o usuário");
  });

  it("a decisão já respondida não aceita outra escolha", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    decisoes.set(decisao, { estado: "respondida" });
    await expect(n.escolherLogin(MARLON, A, decisao, { fonte: "nod", ref: LOGIN_ID })).rejects.toThrow("estado_invalido");
  });
});

describe("L1: trazer do meu Chrome", () => {
  it("navegador no servidor: os cookies do site vêm do Mac, entram pelo relay e a página recarrega", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    expect((await n.escolherLogin(MARLON, A, decisao, "chrome")).aviso).toBe(CONFIRME_NO_MAC);
    await n.esperarLogin(A);
    expect(mac.chamadas.at(-1)).toEqual({ op: "cookies", args: [A, "www.itau.com.br", false] });
    expect(chamadas.find((c) => c.op === "definirCookies")?.args).toEqual([mac.cookies]);
    expect(chamadas.find((c) => c.op === "historico")?.args).toEqual(["recarregar"]);
    expect(retomadas[0]!.texto).toContain("Trouxe do Chrome da pessoa a sessão de itau.com.br (1 cookies)");
  });

  it("navegador no Mac: os cookies vão direto para ele; sem sessão no Chrome, o cartão diz", async () => {
    lugarMac = true;
    mac.cookies = [];
    const n = criar({ lugarDe: async () => ({ tipo: "roda", lugar: { tipo: "mac", nome: "Mac" }, desvio: null }) });
    const decisao = await noLoginDoItau(n);
    await n.escolherLogin(MARLON, A, decisao, "chrome");
    await n.esperarLogin(A);
    expect(mac.chamadas.at(-1)).toEqual({ op: "cookies", args: [A, "www.itau.com.br", true] });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ etapa: "escolher", erro: "O seu Chrome não tem uma sessão deste site." });
  });

  it("sem o Mac ligado não há Chrome nem 1Password", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    mac.ligado = false;
    await expect(n.escolherLogin(MARLON, A, decisao, "chrome")).rejects.toThrow("estado_invalido");
    await expect(n.escolherLogin(MARLON, A, decisao, { fonte: "1password", ref: "" })).rejects.toThrow("estado_invalido");
  });
});

describe("2026-11-23: trazer do meu Chrome pelo ⋯ e na recusa do Google", () => {
  const REJEITADO = "https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fwww.linkedin.com&flowName=GlifWebSignIn";

  it("a tela de recusa do Google é reconhecida só nela", () => {
    expect(googleRecusouOLogin(REJEITADO)).toBe(true);
    expect(googleRecusouOLogin("https://accounts.google.com/signin/rejected")).toBe(true);
    expect(googleRecusouOLogin("https://accounts.google.com/v3/signin/identifier?x=1")).toBe(false);
    expect(googleRecusouOLogin("https://evil.com/accounts.google.com/v3/signin/rejected")).toBe(false);
    expect(googleRecusouOLogin("https://accounts.google.com.evil.com/v3/signin/rejected")).toBe(false);
  });

  it("o bot cai na recusa: a vista guarda o site de origem, o bot ouve para não contornar e a pessoa traz do Chrome", async () => {
    mac.cookies = [{ name: "li_at", value: "x", domain: ".linkedin.com", path: "/", expires: -1, secure: true, httpOnly: true, sameSite: "Lax" }];
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://www.linkedin.com/login" });
    const r = corpo(await chamar(n, "navegador_abrir", { url: REJEITADO }));
    expect(String(r.instrucao)).toContain("não tente de novo nem contorne");
    expect(String(r.instrucao)).toContain("linkedin.com");
    expect(n.vista(MARLON, A)!.googleRecusou).toEqual({ site: "www.linkedin.com" });
    const t = await n.trazerDoChrome(MARLON, A);
    expect(mac.chamadas.at(-1)).toEqual({ op: "cookies", args: [A, "www.linkedin.com", false] });
    expect(chamadas.find((c) => c.op === "definirCookies")?.args).toEqual([mac.cookies]);
    // A página de agora era a do Google: o navegador vai ao site, já com a sessão (e a recusa sai da vista).
    expect(chamadas.filter((c) => c.op === "abrir").at(-1)?.args[0]).toBe("https://www.linkedin.com/");
    expect(t).toMatchObject({ trazidos: 1, aviso: TROUXE_DO_CHROME("linkedin.com") });
    expect(n.vista(MARLON, A)!.googleRecusou).toBeNull();
  });

  it("pelo ⋯ no site da aba: recarrega; um pedido de login aberto fecha com a frase do Chrome e o bot segue", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    const t = await n.trazerDoChrome(MARLON, A);
    expect(mac.chamadas.at(-1)).toEqual({ op: "cookies", args: [A, "www.itau.com.br", false] });
    expect(chamadas.find((c) => c.op === "historico")?.args).toEqual(["recarregar"]);
    expect(t.trazidos).toBe(1);
    expect(retomadas).toEqual([{ decisaoId: decisao, texto: expect.stringContaining("Trouxe do Chrome da pessoa a sessão de itau.com.br") }]);
  });

  it("sem sessão, com o Chrome que pede a extensão e com o aparelho desligado", async () => {
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://www.itau.com.br/" });
    mac.cookies = [];
    expect(await n.trazerDoChrome(MARLON, A)).toMatchObject({ trazidos: 0, aviso: CHROME_SEM_SESSAO("itau.com.br") });
    const extensao = "instale a extensão do nod no seu Chrome e tente de novo";
    const n2 = criar({ mac: { ...macFalso, cookies: async () => { throw new FalhaNavegador("indisponivel", extensao); } } });
    await chamar(n2, "navegador_abrir", { url: "https://www.itau.com.br/" });
    expect(await n2.trazerDoChrome(MARLON, A)).toMatchObject({ trazidos: 0, aviso: fraseDaMaquina(extensao) });
    expect(fraseDaMaquina(extensao)).toBe("Instale a extensão do nod no seu Chrome e tente de novo.");
    mac.ligado = false;
    await expect(n.trazerDoChrome(MARLON, A)).rejects.toThrow("estado_invalido");
  });
});

describe("L5: entrar eu mesmo e a oferta de guardar", () => {
  const tecla = (t: string): EntradaNavegador => ({ t: "tecla", evento: "keyDown", tecla: t });
  const clique: EntradaNavegador = { t: "mouse", evento: "mousePressed", x: 10, y: 10 };
  const campoDeTexto: ElementoNaPagina = { papel: "textbox", nome: "", rotulo: "E-mail", tipo: "email", autocomplete: "username", editavel: true };
  const campoDeSenha: ElementoNaPagina = { papel: "textbox", nome: "", rotulo: "Senha", tipo: "password", autocomplete: "current-password", editavel: true };

  async function digitarLogin(n: ReturnType<typeof criar>) {
    elemento = campoDeTexto;
    await n.antesDaEntrada(MARLON, A, clique);
    for (const c of "ana@x.com") await n.antesDaEntrada(MARLON, A, tecla(c));
    elemento = campoDeSenha;
    await n.antesDaEntrada(MARLON, A, clique);
    await n.antesDaEntrada(MARLON, A, { t: "tecla", evento: "char", texto: SENHA });
  }

  it("o controle vai para a pessoa; depois de digitar e a página mudar, a vista oferece guardar; guardar no nod vai cifrado", async () => {
    const n = criar();
    const decisao = await noLoginDoItau(n);
    const r = await n.escolherLogin(MARLON, A, decisao, "eu_mesmo");
    expect(r.vista).toMatchObject({ controle: "pessoa", pedido: { tipo: "login", etapa: "eu_mesmo" } });
    await digitarLogin(n);
    expect(n.vista(MARLON, A)!.ofertaGuardar).toBeNull();
    // "Pronto, pode seguir" e a página muda (o stream manda a aba nova).
    await n.operar(MARLON, A, "resolver");
    n.doStream(MARLON, A, { abas: [{ id: "t1", titulo: "Itaú", url: "https://www.itau.com.br/conta", ativa: true }] });
    expect(n.vista(MARLON, A)!.ofertaGuardar).toEqual({ site: "itau.com.br", usuario: "ana@x.com", destinos: ["nod", "1password"], ate: T0 + DIGITADO_DURA_MS });
    await n.guardarLogin(MARLON, A, true, "nod");
    expect(cofreCriados).toEqual([{ site: "itau.com.br", usuario: "ana@x.com", senhaCifrada: `c:${SENHA}` }]);
    expect(n.vista(MARLON, A)!.ofertaGuardar).toBeNull();
    await expect(n.guardarLogin(MARLON, A, true, "nod")).rejects.toThrow("estado_invalido");
    // A oferta (com o usuário) está nas vistas; a senha nunca.
    expect(tudoQueSaiu()).not.toContain(SENHA);
  });

  it("guardar no 1Password vai pelo Mac; 'Não' descarta; depois de 5 min some sozinho", async () => {
    const n = criar();
    let decisao = await noLoginDoItau(n);
    await n.escolherLogin(MARLON, A, decisao, "eu_mesmo");
    await digitarLogin(n);
    n.doStream(MARLON, A, { abas: [{ id: "t1", titulo: "Itaú", url: "https://www.itau.com.br/conta", ativa: true }] });
    await n.guardarLogin(MARLON, A, true, "1password");
    expect(mac.chamadas.at(-1)).toEqual({ op: "guardar", args: [A, "1password", "itau.com.br"] });

    await n.operar(MARLON, A, "resolver");
    decisoes.set(decisao, { estado: "respondida" });
    urlAgora = "https://www.itau.com.br/login";
    await chamar(n, "navegador_entrar", { site: "Itaú", motivo: "de novo" });
    decisao = "pedido-2";
    await n.escolherLogin(MARLON, A, decisao, "eu_mesmo");
    await digitarLogin(n);
    n.doStream(MARLON, A, { abas: [{ id: "t1", titulo: "Itaú", url: "https://www.itau.com.br/conta2", ativa: true }] });
    await n.guardarLogin(MARLON, A, false, "nod");
    expect(n.vista(MARLON, A)!.ofertaGuardar).toBeNull();
    expect(cofreCriados).toEqual([]);

    await n.operar(MARLON, A, "resolver");
    decisoes.set(decisao, { estado: "respondida" });
    await chamar(n, "navegador_entrar", { site: "Itaú", motivo: "mais uma" });
    await n.escolherLogin(MARLON, A, "pedido-3", "eu_mesmo");
    await digitarLogin(n);
    n.doStream(MARLON, A, { abas: [{ id: "t1", titulo: "Itaú", url: "https://www.itau.com.br/conta3", ativa: true }] });
    agora += DIGITADO_DURA_MS + 1;
    await expect(n.guardarLogin(MARLON, A, true, "nod")).rejects.toThrow("estado_invalido");
    expect(n.vista(MARLON, A)!.ofertaGuardar).toBeNull();
  });

  it("código de uso único e cartão nunca são capturados como senha", async () => {
    const n = criar();
    await n.escolherLogin(MARLON, A, await noLoginDoItau(n), "eu_mesmo");
    elemento = { papel: "textbox", nome: "", rotulo: "Código de verificação", tipo: "text", autocomplete: "one-time-code", editavel: true };
    await n.antesDaEntrada(MARLON, A, clique);
    for (const c of CODIGO) await n.antesDaEntrada(MARLON, A, tecla(c));
    n.doStream(MARLON, A, { abas: [{ id: "t1", titulo: "Itaú", url: "https://www.itau.com.br/conta", ativa: true }] });
    expect(n.vista(MARLON, A)!.ofertaGuardar).toBeNull();
  });
});

describe("L4: o código por SMS", () => {
  it("o pedido com codigo não aceita texto no chat; o código vai direto ao campo e o pedido fecha com 'Código enviado'", async () => {
    campos = { usuario: false, senha: false, codigo: true };
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://www.itau.com.br/token" });
    await chamar(n, "navegador_pedir_ajuda", { motivo: "o banco mandou um SMS", codigo: true });
    expect(n.vista(MARLON, A)!.pedido).toEqual({ tipo: "ajuda", decisaoId: "pedido-1", motivo: "o banco mandou um SMS", codigo: true });
    await expect(n.enviarCodigo(MARLON, A, "pedido-1", "12\n3")).rejects.toThrow("entrada_invalida");
    const v = await n.enviarCodigo(MARLON, A, "pedido-1", CODIGO);
    expect(chamadas.filter((c) => c.op === "inserirTexto")).toEqual([{ op: "inserirTexto", args: [SELETOR_CAMPO.codigo, CODIGO] }]);
    expect(v).toMatchObject({ controle: "bot", pedido: null, segredoNaPagina: true });
    expect(retomadas).toEqual([{ decisaoId: "pedido-1", texto: expect.stringMatching(/^Código enviado\./) }]);
    respostas.push(v);
    expect(tudoQueSaiu()).not.toContain(CODIGO);
    await expect(n.enviarCodigo(MARLON, A, "pedido-1", CODIGO)).rejects.toThrow("estado_invalido");
  });

  it("sem campo de código claro, vai para o campo focado", async () => {
    campos = { usuario: false, senha: false, codigo: false };
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://www.itau.com.br/token" });
    await chamar(n, "navegador_pedir_ajuda", { motivo: "SMS", codigo: true });
    await n.enviarCodigo(MARLON, A, "pedido-1", CODIGO);
    expect(chamadas.filter((c) => c.op === "inserirTexto")).toEqual([{ op: "inserirTexto", args: [null, CODIGO] }]);
  });
});

describe("A1: a aprovação no ponto sem volta, na vista e no Touch ID", () => {
  it("pagar leva a pergunta, o botão, a caixa e o Touch ID; aprovar passa pelo Touch ID antes de clicar", async () => {
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://www.flytap.com/pagar" });
    await chamar(n, "navegador_ler", {});
    expect(await chamar(n, "navegador_clicar", { alvo: "@e2" })).toEqual({ aguardar: "decisao-1" });
    expect(n.vista(MARLON, A)!.pedido).toEqual({ tipo: "aprovacao", decisaoId: "decisao-1", pergunta: "Pagar R$ 3.780 no flytap.com?", botao: "Pagar R$ 3.780", classe: "pagar", touchId: true, avisoTouchId: null, caixa: { x: 10, y: 20, w: 120, h: 40 }, lembrar: null, citacao: null });
    const { acaoId, acao } = aprovacoes[0]!.itens[0]!.destino.argumentos as { acaoId: string; acao: string };
    mac.touch = "recusado";
    await expect(n.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId, acao })).rejects.toThrow("nao_permitido");
    expect(mac.chamadas.at(-1)).toEqual({ op: "touchId", args: [A, "Pagar R$ 3.780 no flytap.com"] });
    expect(ops()).not.toContain("clicar");
    expect(JSON.parse(n.resultadoDaAcao(MARLON, acaoId)!)).toMatchObject({ erro: "touch_id_recusado" });
    mac.touch = "confirmado";
    await n.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId, acao });
    expect(chamadas.find((c) => c.op === "clicar")?.args).toEqual(["@e2", false]);
  });

  it("sem o Mac: o cartão avisa que vai só pelo botão e aprovar clica sem Touch ID", async () => {
    mac.ligado = false;
    const n = criar({ mac: undefined });
    await chamar(n, "navegador_abrir", { url: "https://www.flytap.com/pagar" });
    await chamar(n, "navegador_ler", {});
    await chamar(n, "navegador_clicar", { alvo: "@e2" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ touchId: false, avisoTouchId: AVISO_SEM_TOUCH_ID });
  });
});

describe("o navegador no PC (2026-11-22): os textos dizem o PC e o Windows Hello", () => {
  it("com o PC ligado a vista diz pc; desligado, o aviso e a opção cinza falam do PC, não do Mac", async () => {
    let ligado = true;
    const pc: MacDaPessoa = { ...macFalso, maquina: () => (ligado ? MAC : null), aparelho: () => (ligado ? "pc" : null) };
    const n = criar({ mac: pc });
    await chamar(n, "navegador_abrir", { url: "https://www.flytap.com/pagar" });
    expect(n.vista(MARLON, A)).toMatchObject({ aparelho: "pc" });
    ligado = false;
    await chamar(n, "navegador_ler", {});
    await chamar(n, "navegador_clicar", { alvo: "@e2" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ touchId: false, avisoTouchId: "Seu PC está desligado: a confirmação vai só pelo botão, sem o Windows Hello." });
    expect(n.vista(MARLON, A)).toMatchObject({ aparelho: "pc" });
  });
});

describe("o PC oferece 'Trazer do meu Chrome' pela extensão do nod (2026-11-23)", () => {
  it("com o PC ligado, a opção vem junto dos cofres", async () => {
    const pc: MacDaPessoa = { ...macFalso, aparelho: () => "pc" };
    const n = criar({ mac: pc });
    await chamar(n, "navegador_abrir", { url: "https://www.itau.com.br/login" });
    await chamar(n, "navegador_entrar", { site: "itau.com.br", motivo: "ver a fatura" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ tipo: "login", podeTrazerDoChrome: true, opcoes: expect.arrayContaining([expect.objectContaining({ fonte: "1password" })]) });
  });
});

describe("A3: não perguntar de novo para o destino visto na página", () => {
  it("o destino que aparece na página leva o lembrar marcado; aprovado com 'sempre', o próximo envio para ele passa", async () => {
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://web.whatsapp.com/" });
    await chamar(n, "navegador_ler", {});
    await chamar(n, "navegador_clicar", { alvo: "@e1", para: "Pedro" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ tipo: "aprovacao", classe: "enviar", lembrar: { padrao: true, texto: "Não perguntar de novo para Pedro" } });
    const { acaoId, acao } = aprovacoes[0]!.itens[0]!.destino.argumentos as { acaoId: string; acao: string };
    await n.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId, acao, lembrar: true });
    expect(gravadas.at(-1)).toEqual({ pagar: [], enviar: [{ host: "web.whatsapp.com", destino: "Pedro" }] });
    chamadas = [];
    await chamar(n, "navegador_ler", {});
    expect(corpo(await chamar(n, "navegador_clicar", { alvo: "@e1", para: "pedro" }))).toMatchObject({ ok: true });
    expect(ops()).toContain("clicar");
  });

  it("destino que não está na página não oferece lembrar; dinheiro nunca oferece", async () => {
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://web.whatsapp.com/" });
    await chamar(n, "navegador_ler", {});
    await chamar(n, "navegador_clicar", { alvo: "@e1", para: "Carla" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ lembrar: null });
    const { acaoId, acao } = aprovacoes[0]!.itens[0]!.destino.argumentos as { acaoId: string; acao: string };
    await n.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId, acao, lembrar: true });
    expect(gravadas).toEqual([]);
    await chamar(n, "navegador_ler", {});
    await chamar(n, "navegador_clicar", { alvo: "@e2", para: "Pedro" });
    expect(n.vista(MARLON, A)!.pedido).toMatchObject({ classe: "pagar", lembrar: null });
  });
});

describe("A2: o combinado de antemão", () => {
  it("abre o cartão com o teto; 'Pode' passa pelo Touch ID e grava o teto; pagar dentro dele não pergunta, acima pergunta", async () => {
    const n = criar();
    await chamar(n, "navegador_abrir", { url: "https://www.flytap.com/" });
    const r = await chamar(n, "navegador_usar", { ferramenta: "navegador_combinar", argumentos: { site: "flytap.com", o_que: "1 passagem", ate_valor_centavos: 400_000 } });
    expect(r).toEqual({ aguardar: "decisao-1" });
    expect(aprovacoes[0]).toMatchObject({ resumo: "Com isso eu pago sem perguntar de novo, se o valor ficar dentro do limite.", itens: [{ texto: "Vou comprar em flytap.com: 1 passagem, até R$ 4.000" }] });
    expect(n.vista(MARLON, A)!.pedido).toEqual({ tipo: "combinar", decisaoId: "decisao-1", titulo: "Vou comprar em flytap.com: 1 passagem, até R$ 4.000", texto: "Com isso eu pago sem perguntar de novo, se o valor ficar dentro do limite.", sim: "Pode, até R$ 4.000", nao: "Me pergunte antes de pagar", touchId: true });
    const { acaoId, acao } = aprovacoes[0]!.itens[0]!.destino.argumentos as { acaoId: string; acao: string };
    await n.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId, acao });
    expect(mac.chamadas.at(-1)?.op).toBe("touchId");
    expect(gravadas.at(-1)).toEqual({ pagar: [{ host: "flytap.com", ateCentavos: 400_000 }], enviar: [] });
    expect(n.vista(MARLON, A)).toMatchObject({ controle: "bot", pedido: null });
    await chamar(n, "navegador_ler", {});
    expect(corpo(await chamar(n, "navegador_clicar", { alvo: "@e2" }))).toMatchObject({ ok: true });
    leitura = { ...leitura, refs: { ...leitura.refs, e2: { papel: "button", nome: "Pagar R$ 4.100" } } };
    await chamar(n, "navegador_ler", {});
    expect(await chamar(n, "navegador_clicar", { alvo: "@e2" })).toEqual({ aguardar: "decisao-2" });
  });

  it("sem teto nem destino é recusado; 'Me pergunte antes' (recusar) não grava nada", async () => {
    const n = criar();
    expect(corpo(await chamar(n, "navegador_usar", { ferramenta: "navegador_combinar", argumentos: { site: "flytap.com", o_que: "x" } }))).toMatchObject({ erro: "combinado_incompleto" });
    expect(aprovacoes).toEqual([]);
    expect(gravadas).toEqual([]);
  });
});

const ops = () => chamadas.map((c) => c.op);

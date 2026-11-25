import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { Navegadores } from "../../../src/adapters/fundo/navegadores.ts";
import { lerEscolhaLogin, lerNovoLogin, rotasCofreLogins, rotasNavegador } from "../../../src/adapters/http/rotas/navegador.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";

/**
 * As rotas novas do navegador do bot (ADR-190, L): login, código, guardar e o cofre do nod. O corpo é conferido antes do
 * portão (nenhum segredo no corpo do login; código numa linha), o 409 sai com a causa fixa e o cofre na tela nunca devolve
 * a senha. Portão e repositório de mentira.
 */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const BOT = "00000000-0000-4000-8000-0000000000b1";
const DECISAO = "00000000-0000-4000-8000-0000000000d1";
const LOGIN = "00000000-0000-4000-8000-0000000000e1";
const vista = { agenteId: BOT };

function montar(falha: unknown = null) {
  const chamadas: unknown[][] = [];
  const registrar = (nome: string, volta: unknown = vista) => async (...args: unknown[]) => { chamadas.push([nome, ...args.slice(2)]); if (falha) throw falha; return volta; };
  const navegadores = { escolherLogin: registrar("escolherLogin", { vista, aviso: "Confirme no seu Mac" }), enviarCodigo: registrar("enviarCodigo"), guardarLogin: registrar("guardarLogin") } as never as Navegadores;
  const cofre: unknown[] = [];
  const repos = {
    cofreLogins: {
      listar: async () => [{ id: LOGIN, site: "itau.com.br", usuario: "marlon@exemplo.com", criadoEm: 1 }],
      criar: async (l: { site: string; usuario: string; senhaCifrada: string }) => { cofre.push(l); return { id: LOGIN, site: l.site, usuario: l.usuario, criadoEm: 2 }; },
      apagar: async (id: string) => id === LOGIN,
    },
  };
  const rotas = [...rotasNavegador(navegadores), ...rotasCofreLogins({ dentro: async (_e, fn) => fn({ repos } as never), cifrar: (s) => `v1:${Buffer.from(s).toString("base64")}` })];
  const chamar = async (metodo: string, caminho: string, corpo: unknown = {}, id = BOT) => {
    const rota = rotas.find((r) => r.metodo === metodo && r.padrao.test(caminho))!;
    let resposta: { status: number; body: unknown } | null = null;
    const req = new IncomingMessage(new Socket());
    try {
      await rota.handler({ req, res: new ServerResponse(req), escopo: ESCOPO, params: { id }, corpo: async () => corpo, json: (status: number, body: unknown) => { resposta = { status, body }; } } as never);
    } catch (e) { return { status: 0, body: e instanceof ErroDeDominio ? e.codigo : String(e) }; }
    return resposta!;
  };
  return { chamar, chamadas, cofre, rotas };
}

describe("POST /agentes/:id/navegador/login", () => {
  it("aceita só a decisão e a escolha (fonte + referência do cofre), nunca um segredo", () => {
    expect(lerEscolhaLogin({ decisaoId: DECISAO, escolha: "eu_mesmo" })).toEqual({ decisaoId: DECISAO, escolha: "eu_mesmo" });
    expect(lerEscolhaLogin({ decisaoId: DECISAO, escolha: { fonte: "nod", ref: LOGIN } }).escolha).toEqual({ fonte: "nod", ref: LOGIN });
    expect(lerEscolhaLogin({ decisaoId: DECISAO, escolha: { fonte: "1password", ref: "op://v1/i1/password" } }).escolha).toMatchObject({ fonte: "1password" });
    expect(lerEscolhaLogin({ decisaoId: DECISAO, escolha: { fonte: "1password", ref: "" } }).escolha).toMatchObject({ ref: "" });
    for (const ruim of [
      { decisaoId: "x", escolha: "chrome" },
      { decisaoId: DECISAO, escolha: { fonte: "nod", ref: "nao-uuid" } },
      { decisaoId: DECISAO, escolha: { fonte: "nod", ref: LOGIN, senha: "x" } },
      { decisaoId: DECISAO, escolha: { fonte: "1password", ref: "op://v/i/p$(rm)" } },
      { decisaoId: DECISAO, escolha: { fonte: "bitwarden", ref: "a/b" } },
      { decisaoId: DECISAO, escolha: { fonte: "lastpass", ref: "" } },
      { decisaoId: DECISAO, escolha: "tudo" },
    ]) expect(() => lerEscolhaLogin(ruim)).toThrow("entrada_invalida");
  });

  it("a resposta leva a vista e o aviso do celular; a causa do 409 é a da tabela", async () => {
    const { chamar, chamadas } = montar();
    expect(await chamar("POST", `/agentes/${BOT}/navegador/login`, { decisaoId: DECISAO, escolha: "chrome" })).toEqual({ status: 200, body: { ok: true, vista, aviso: "Confirme no seu Mac" } });
    expect(chamadas).toEqual([["escolherLogin", DECISAO, "chrome"]]);
    const comFalha = montar(new ErroDeDominio("estado_invalido", { cause: "precisa_do_mac" }));
    expect(await comFalha.chamar("POST", `/agentes/${BOT}/navegador/login`, { decisaoId: DECISAO, escolha: "chrome" })).toMatchObject({ status: 409, body: { motivo: "precisa_do_mac" } });
  });
});

describe("POST /navegador/codigo e /navegador/guardar-login", () => {
  it("o código numa linha só; o guardar com o destino", async () => {
    const { chamar, chamadas } = montar();
    expect(await chamar("POST", `/agentes/${BOT}/navegador/codigo`, { decisaoId: DECISAO, codigo: "12\n34" })).toEqual({ status: 0, body: "entrada_invalida" });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/codigo`, { decisaoId: DECISAO, codigo: "918273" })).toMatchObject({ status: 200 });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/guardar-login`, { guardar: true })).toEqual({ status: 0, body: "entrada_invalida" });
    expect(await chamar("POST", `/agentes/${BOT}/navegador/guardar-login`, { guardar: true, destino: "keepass" })).toEqual({ status: 0, body: "entrada_invalida" });
    await chamar("POST", `/agentes/${BOT}/navegador/guardar-login`, { guardar: true, destino: "bitwarden" });
    await chamar("POST", `/agentes/${BOT}/navegador/guardar-login`, { guardar: false });
    expect(chamadas).toEqual([["enviarCodigo", DECISAO, "918273"], ["guardarLogin", true, "bitwarden"], ["guardarLogin", false, "nod"]]);
  });
});

describe("o cofre do nod na tela (/cofre/logins)", () => {
  it("listar não leva a senha e mascara o usuário; guardar cifra; apagar só o que existe", async () => {
    const { chamar, cofre } = montar();
    expect(await chamar("GET", "/cofre/logins")).toEqual({ status: 200, body: { logins: [{ id: LOGIN, site: "itau.com.br", usuario: "marlon@…", criadoEm: 1 }] } });
    const r = await chamar("POST", "/cofre/logins", { site: "https://www.Itau.com.br/pf", usuario: " marlon@exemplo.com ", senha: "s3nha" });
    expect(r).toEqual({ status: 200, body: { ok: true, login: { id: LOGIN, site: "itau.com.br", usuario: "marlon@…", criadoEm: 2 } } });
    expect(JSON.stringify(r)).not.toContain("s3nha");
    expect(cofre).toEqual([{ site: "itau.com.br", usuario: "marlon@exemplo.com", senhaCifrada: `v1:${Buffer.from("s3nha").toString("base64")}` }]);
    expect(await chamar("DELETE", `/cofre/logins/${LOGIN}`, {}, LOGIN)).toEqual({ status: 200, body: { ok: true } });
    expect(await chamar("DELETE", "/cofre/logins/00000000-0000-4000-8000-000000000999", {}, "00000000-0000-4000-8000-000000000999")).toEqual({ status: 0, body: "nao_encontrado" });
    expect(() => lerNovoLogin({ site: "Itaú", usuario: "a", senha: "b" })).toThrow("entrada_invalida");
    expect(() => lerNovoLogin({ site: "itau.com.br", usuario: "a", senha: "" })).toThrow("entrada_invalida");
  });

  it("as rotas que mudam declaram a ação do registro", () => {
    expect(montar().rotas.filter((r) => r.metodo !== "GET" && (r.acao?.startsWith("cofre.") || /login|codigo/.test(r.acao ?? ""))).map((r) => r.acao)).toEqual(["navegador.login", "navegador.codigo", "navegador.guardar_login", "cofre.criar_login", "cofre.apagar_login"]);
  });
});

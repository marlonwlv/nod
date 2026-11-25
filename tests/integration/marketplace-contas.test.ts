import { expect, it } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * ADR-196: duas contas do mesmo app. O Composio é um fetch falso que dá uma conta nova a cada `link` (como o medido na
 * sonda de 2026-11-24) e guarda o estado de cada uma; o "login" é o teste marcar a conta como ACTIVE.
 */
function montar() {
  const chave = chaveDe("teste-composio-contas");
  const cifra = (s: string) => cifrar(s, chave);
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => ({ ok: true, ferramentas: [{ nome: "GMAIL_SEND_EMAIL", descricao: "Envia", readOnlyHint: false, schema: { type: "object" } }] }) }) });
  let userId = "";
  let n = 0;
  const contas = new Map<string, { status: string; email: string | null }>();
  const apagadas: string[] = [];
  const corpos: Record<string, unknown>[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    if (body) corpos.push(body);
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/tool_router/session")) return Response.json({ session_id: `trs_${n + 1}`, mcp: { url: `https://app.composio.dev/tool_router/v3/trs_${n + 1}/mcp` } });
    if (u.endsWith("/link")) {
      n += 1;
      contas.set(`ca_${n}`, { status: "INITIALIZING", email: null });
      return Response.json({ redirect_url: `https://app.composio.dev/link/lt_${n}`, connected_account_id: `ca_${n}` });
    }
    const conta = /\/connected_accounts\/(ca_\d+)$/.exec(u)?.[1];
    if (conta && init?.method === "DELETE") { apagadas.push(conta); contas.delete(conta); return Response.json({}); }
    if (conta) {
      const c = contas.get(conta);
      if (!c) return Response.json({ error: "nao" }, { status: 404 });
      // O token do login fica no state.val; o nod só pode tirar dali o e-mail.
      return Response.json({ status: c.status, user_id: userId, toolkit: { slug: "gmail" }, state: { authScheme: "OAUTH2", val: { access_token: "ya29.segredo", ...(c.email ? { email: c.email } : {}) } } });
    }
    if (/\/tool_router\/session\/trs_\d+$/.test(u) && init?.method === "PATCH") return Response.json({ tool_router_tools: ["GMAIL_SEND_EMAIL"] });
    throw new Error(`endpoint inesperado ${init?.method ?? "GET"} ${u}`);
  };
  const op = { dentro: memoria.dentro, cifrar: cifra, decifrar: (s: string) => decifrar(s, chave), fetchImpl: fakeFetch, esperar: async () => undefined };
  return {
    memoria, contas, apagadas, corpos,
    async subir() {
      const srv = await servidorDeTeste([...rotasMarketplace(op), ...rotasConectores(op)]);
      const sessao = await srv.entrar("marlon");
      userId = `nod:${sessao.tenantId}:${sessao.pessoaId}`;
      expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "ak_segredo" })).status).toBe(200);
      return { srv, sessao };
    },
    /** O login terminou no Google: a última conta criada fica ativa, com o e-mail. */
    logar(email: string | null) { contas.set(`ca_${n}`, { status: "ACTIVE", email }); },
  };
}

it("a conta a mais nasce como outro conector, com o nome que a pessoa deu e o e-mail da conta", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail/conectar")).status).toBe(200);
    m.logar("marlon@empresa.example");
    expect(await (await srv.chamar(sessao, "POST", "marketplace/gmail/verificar")).json()).toMatchObject({ conectado: true });

    const r = await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "Pessoal" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ url: "https://app.composio.dev/link/lt_2" });
    // Sem `multi_account` (ele recusa o preload) e sem alias: o nome da conta mora no nod.
    expect(m.corpos.some((c) => "multi_account" in c || "alias" in c)).toBe(false);
    expect(await (await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/verificar")).json()).toEqual({ conectado: false });
    m.logar("Maria@Pessoal.example");
    expect(await (await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/verificar")).json()).toMatchObject({ conectado: true });

    const conectores = m.memoria.banco.conectores;
    expect(conectores.map((c) => [c.slug, c.nome, c.habilitado])).toEqual([["gmail", "Gmail", true], ["gmail--pessoal", "Gmail (Pessoal)", true]]);
    const sessoes = [...m.memoria.banco.composioSessoes.values()];
    expect(sessoes.map((s) => [s.toolkit, s.conta ?? null, s.contaId, s.email])).toEqual([["gmail", null, "ca_1", "marlon@empresa.example"], ["gmail", "pessoal", "ca_2", "maria@pessoal.example"]]);
    // O e-mail sai só do campo de e-mail: o token do state nunca chega à resposta nem ao banco.
    expect(JSON.stringify(sessoes)).not.toContain("ya29");
  } finally { await srv.close(); }
});

it("a conta a mais pede a primeira conectada, um nome que bate com a chave, fora do GitHub e até 5 contas", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "pessoal" })).status).toBe(409);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail/conectar")).status).toBe(200);
    m.logar(null);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "Trabalho" })).status).toBe(400);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "pes(soal)" })).status).toBe(400);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "x".repeat(21) })).status).toBe(400);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--/conectar")).status).toBe(404);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail---a/conectar")).status).toBe(404);
    expect((await srv.chamar(sessao, "POST", "marketplace/github--pessoal/conectar", { rotulo: "pessoal" })).status).toBe(400);
    // Sem rótulo, o nome é o da chave.
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--familia-silva/conectar", { rotulo: "Família Silva" })).status).toBe(200);
    for (const conta of ["a", "b", "c"]) expect((await srv.chamar(sessao, "POST", `marketplace/gmail--${conta}/conectar`)).status).toBe(200);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--d/conectar")).status).toBe(409);
    // Refazer o login de uma conta que já existe não conta de novo no limite.
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--a/conectar")).status).toBe(200);
    expect(m.memoria.banco.conectores.find((c) => c.slug === "gmail--familia-silva")?.nome).toBe("Gmail (Família Silva)");
  } finally { await srv.close(); }
});

it("refazer o login apaga no Composio a conta que ficou pela metade; a ativa fica", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail/conectar")).status).toBe(200);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail/conectar")).status).toBe(200);
    expect(m.apagadas).toEqual(["ca_1"]);
    m.logar(null);
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail/conectar")).status).toBe(200);
    expect(m.apagadas).toEqual(["ca_1"]);
  } finally { await srv.close(); }
});

it("renomear troca só o nome; remover tira a conta a mais, apaga no Composio e não alcança a primeira", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    await srv.chamar(sessao, "POST", "marketplace/gmail/conectar");
    m.logar(null);
    await srv.chamar(sessao, "POST", "marketplace/gmail/verificar");
    await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "pessoal" });
    m.logar(null);
    await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/verificar");
    const [primeira, pessoal] = m.memoria.banco.conectores;

    const renomeada = await srv.chamar(sessao, "PATCH", `conectores/${pessoal!.id}/nome`, { nome: "  Gmail (Família)  " });
    expect(renomeada.status).toBe(200);
    expect(pessoal).toMatchObject({ nome: "Gmail (Família)", slug: "gmail--pessoal" });
    expect((await srv.chamar(sessao, "PATCH", `conectores/${pessoal!.id}/nome`, { nome: "" })).status).toBe(400);
    expect((await srv.chamar(sessao, "PATCH", `conectores/${pessoal!.id}/nome`, { nome: "a\nb" })).status).toBe(400);
    expect((await srv.chamar(sessao, "PATCH", `conectores/${pessoal!.id}/nome`, { nome: "x".repeat(81) })).status).toBe(400);

    expect((await srv.chamar(sessao, "DELETE", `marketplace/contas/${primeira!.id}`)).status).toBe(400);
    expect((await srv.chamar(sessao, "DELETE", "marketplace/contas/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await srv.chamar(sessao, "DELETE", "marketplace/contas/nao-e-uuid")).status).toBe(404);
    expect((await srv.chamar(sessao, "DELETE", `marketplace/contas/${pessoal!.id}`)).status).toBe(200);
    expect(m.apagadas).toEqual(["ca_2"]);
    const lista = await (await srv.chamar(sessao, "GET", "conectores")).json() as { conectores: { slug: string }[] };
    expect(lista.conectores.map((c) => c.slug)).toEqual(["gmail"]);
    expect([...m.memoria.banco.composioSessoes.values()].map((s) => s.conta ?? null)).toEqual([null]);
    // Remover de novo, ou um conector que não é conta do Marketplace (MCP manual com `--`), não passa.
    expect((await srv.chamar(sessao, "DELETE", `marketplace/contas/${pessoal!.id}`)).status).toBe(404);
  } finally { await srv.close(); }
});

it("outra pessoa não renomeia nem remove a conta de quem conectou", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    await srv.chamar(sessao, "POST", "marketplace/gmail/conectar");
    m.logar(null);
    await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "pessoal" });
    const pessoal = m.memoria.banco.conectores.find((c) => c.slug === "gmail--pessoal")!;
    const ana = await srv.entrar("ana");
    expect((await srv.chamar(ana, "PATCH", `conectores/${pessoal.id}/nome`, { nome: "Meu" })).status).toBe(404);
    expect((await srv.chamar(ana, "DELETE", `marketplace/contas/${pessoal.id}`)).status).toBe(404);
    expect(pessoal.nome).toBe("Gmail (pessoal)");
    expect(m.apagadas).toEqual([]);
  } finally { await srv.close(); }
});

it("conectar de novo a conta tirada, com o mesmo nome, reusa o conector e volta sem acesso nenhum", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    await srv.chamar(sessao, "POST", "marketplace/gmail/conectar");
    m.logar(null);
    await srv.chamar(sessao, "POST", "marketplace/gmail/verificar");
    await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "pessoal" });
    m.logar(null);
    await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/verificar");
    const pessoal = m.memoria.banco.conectores.find((c) => c.slug === "gmail--pessoal")!;
    expect((await srv.chamar(sessao, "DELETE", `marketplace/contas/${pessoal.id}`)).status).toBe(200);
    // Um cartão antigo concedeu depois do remover (o caminho que a revisão do PR achou): a volta limpa de novo.
    m.memoria.banco.concessoes.push({ tenantId: sessao.tenantId, id: "g-velha", ownerId: sessao.pessoaId, agenteId: "a", conectorId: pessoal.id, capacidade: "GMAIL_SEND_EMAIL", mensagemId: "m", criadoEm: 0 });
    expect((await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/conectar", { rotulo: "Pessoal" })).status).toBe(200);
    expect(m.memoria.banco.conectores.filter((c) => c.slug === "gmail--pessoal")).toHaveLength(1);
    expect(pessoal).toMatchObject({ nome: "Gmail (Pessoal)" });
    expect(pessoal.removidoEm).toBeUndefined();
    expect(m.memoria.banco.concessoes.filter((g) => g.conectorId === pessoal.id)).toEqual([]);
    m.logar(null);
    expect(await (await srv.chamar(sessao, "POST", "marketplace/gmail--pessoal/verificar")).json()).toMatchObject({ conectado: true });
  } finally { await srv.close(); }
});

it("um MCP registrado à mão com `--` no slug não sai pelo Remover conta", async () => {
  const m = montar();
  const { srv, sessao } = await m.subir();
  try {
    const r = await srv.chamar(sessao, "POST", "conectores", { nome: "Meu MCP", slug: "meu--mcp", transporte: "http", url: "https://exemplo.invalid/mcp", declaracao: "nao-toca" });
    expect(r.status).toBe(201);
    const id = (await r.json() as { ids: { conector: string } }).ids.conector;
    expect((await srv.chamar(sessao, "DELETE", `marketplace/contas/${id}`)).status).toBe(400);
    expect(m.memoria.banco.conectores.find((c) => c.id === id)?.removidoEm).toBeUndefined();
  } finally { await srv.close(); }
});

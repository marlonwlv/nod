import { expect, it } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { sondarConector } from "../../src/adapters/mcp-proxy/probe.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { mcpComposioFalso, URL_SESSAO_COMPOSIO } from "../helpers/composio-mcp-falso.ts";

/**
 * Emenda ADR-057 (2026-11-18): apps de chave de API. A tela pede os campos, a pessoa cola, e uma chamada só cria (ou
 * reaproveita) a auth config, a conta, a sessão presa à conta e sonda. Os valores colados passam e não ficam.
 */

const CHAVE_DO_APP = "ff-chave-secreta-123";

const TOOLKIT_FRESHDESK = {
  slug: "freshdesk",
  get_current_user_endpoint: "https://{{subdomain}}.freshdesk.com/api/v2/agents/me",
  get_current_user_endpoint_method: "GET",
  auth_config_details: [{
    mode: "API_KEY",
    fields: {
      auth_config_creation: { required: [], optional: [] },
      connected_account_initiation: {
        required: [
          { name: "subdomain", displayName: "Freshdesk Account Subdomain", description: "The 'acme' in acme.freshdesk.com.", required: true, is_secret: false, user_visible: true },
          { name: "generic_api_key", displayName: "API Key", description: "Profile Settings → View API key.", required: true, is_secret: true, user_visible: true },
        ],
        optional: [{ name: "interno", displayName: "Interno", description: "", required: false, is_secret: false, user_visible: false }],
      },
    },
  }],
};

type Cenario = { configExistente?: { id: string; naSessao: boolean }; recusar?: boolean; appRecusa?: boolean };

function montar(c: Cenario = {}) {
  const chave = chaveDe("teste-apps-chave");
  const mcp = mcpComposioFalso({ ferramentas: [{ name: "FRESHDESK_LIST_TICKETS", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] });
  const pedidos: { metodo: string; url: string; body: unknown }[] = [];
  let userId = "";
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    const metodo = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u === URL_SESSAO_COMPOSIO) return mcp(u, init);
    pedidos.push({ metodo, url: u.replace("https://backend.composio.dev/api/v3.1", ""), body });
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/toolkits/freshdesk")) return Response.json(TOOLKIT_FRESHDESK);
    if (u.includes("/auth_configs?toolkit_slug=freshdesk")) {
      return Response.json({ items: c.configExistente ? [{ id: c.configExistente.id, type: "custom", auth_scheme: "API_KEY", status: "ENABLED", toolkit: { slug: "freshdesk" }, is_enabled_for_tool_router: c.configExistente.naSessao }] : [] });
    }
    if (u.endsWith("/auth_configs") && metodo === "POST") return Response.json({ auth_config: { id: "ac_novo" } }, { status: 201 });
    if (u.endsWith("/auth_configs") && metodo === "GET") return Response.json({ items: [] });
    if (u.includes("/auth_configs/") && metodo === "PATCH") return Response.json({});
    if (u.endsWith("/toolkits?limit=1000")) return Response.json({ items: [] });
    if (u.endsWith("/connected_accounts") && metodo === "POST") {
      userId = body.connection.user_id;
      if (c.recusar) return Response.json({ error: { code: "ConnectedAccount_CredentialValidationRejected", message: "Invalid API key ff-chave-secreta-123" } }, { status: 400 });
      return Response.json({ id: "ca_chave" }, { status: 201 });
    }
    if (u.endsWith("/tools/execute/proxy")) return Response.json(c.appRecusa ? { status: 401, data: { message: "Unauthorized" } } : { status: 200, data: { id: 7 } });
    if (u.endsWith("/connected_accounts/ca_chave") && metodo === "DELETE") return Response.json({});
    if (u.endsWith("/connected_accounts/ca_chave")) return Response.json({ status: "ACTIVE", user_id: userId, toolkit: { slug: "freshdesk" } });
    if (u.endsWith("/tool_router/session")) return Response.json({ session_id: "trs_chave", mcp: { url: URL_SESSAO_COMPOSIO } });
    if (u.endsWith("/tool_router/session/trs_chave") && metodo === "PATCH") return Response.json({ tool_router_tools: ["FRESHDESK_LIST_TICKETS"] });
    throw new Error(`endpoint inesperado: ${metodo} ${u}`);
  };
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => sondarConector({ nome: "freshdesk", transporte: "http", url: URL_SESSAO_COMPOSIO, env: { "x-api-key": "fake" } }, { fetchImpl: fakeFetch }) }) });
  const op = { dentro: memoria.dentro, cifrar: (s: string) => cifrar(s, chave), decifrar: (s: string) => decifrar(s, chave), fetchImpl: fakeFetch, esperar: async () => undefined };
  return { memoria, op, pedidos };
}

async function comServidor(c: Cenario, f: (x: ReturnType<typeof montar> & { srv: Awaited<ReturnType<typeof servidorDeTeste>>; sessao: Awaited<ReturnType<Awaited<ReturnType<typeof servidorDeTeste>>["entrar"]>> }) => Promise<void>) {
  const m = montar(c);
  const srv = await servidorDeTeste([...rotasMarketplace(m.op), ...rotasConectores(m.op)]);
  try {
    const sessao = await srv.entrar("ana");
    expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "fake" })).status).toBe(200);
    await f({ ...m, srv, sessao });
  } finally {
    await srv.close();
  }
}

it("lista os campos visíveis do esquema API_KEY, com o que é segredo", async () => {
  await comServidor({}, async ({ srv, sessao }) => {
    const r = await srv.chamar(sessao, "GET", "marketplace/freshdesk/campos");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ campos: [
      { nome: "subdomain", rotulo: "Freshdesk Account Subdomain", descricao: "The 'acme' in acme.freshdesk.com.", segredo: false, obrigatorio: true },
      { nome: "generic_api_key", rotulo: "API Key", descricao: "Profile Settings → View API key.", segredo: true, obrigatorio: true },
    ] });
  });
});

it("conecta numa chamada: cria a config, liga na sessão, cria a conta, prende a sessão e sonda", async () => {
  await comServidor({}, async ({ srv, sessao, pedidos, memoria }) => {
    const r = await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos: { subdomain: " acme ", generic_api_key: CHAVE_DO_APP } });
    expect(r.status).toBe(200);
    const corpo = await r.json() as { conectado: boolean; conectorId: string };
    expect(corpo.conectado).toBe(true);
    const userId = `nod:${sessao.tenantId}:${sessao.pessoaId}`;
    expect(pedidos.find((p) => p.metodo === "POST" && p.url === "/auth_configs")?.body).toEqual({ toolkit: { slug: "freshdesk" }, auth_config: { type: "use_custom_auth", authScheme: "API_KEY", name: "nod · freshdesk", credentials: {} } });
    expect(pedidos.find((p) => p.metodo === "PATCH" && p.url === "/auth_configs/ac_novo")?.body).toEqual({ type: "custom", is_enabled_for_tool_router: true });
    expect(pedidos.find((p) => p.url === "/connected_accounts")?.body).toEqual({ auth_config: { id: "ac_novo" }, connection: { user_id: userId, state: { authScheme: "API_KEY", val: { status: "ACTIVE", subdomain: "acme", generic_api_key: CHAVE_DO_APP } } } });
    const sessaoPedida = pedidos.find((p) => p.url === "/tool_router/session")?.body as Record<string, unknown>;
    expect(sessaoPedida.auth_configs).toEqual({ freshdesk: "ac_novo" });
    expect(sessaoPedida.user_id).toBe(userId);
    expect(pedidos.find((p) => p.metodo === "PATCH" && p.url === "/tool_router/session/trs_chave")?.body).toEqual({ connected_accounts: { freshdesk: ["ca_chave"] } });
    expect(memoria.banco.conectores[0]?.id).toBe(corpo.conectorId);
    // O valor colado passou pelo servidor e não ficou: nem em claro nem cifrado ele aparece no banco.
    expect(JSON.stringify(memoria.banco)).not.toContain(CHAVE_DO_APP);
  });
});

it("reaproveita a config de chave do projeto; só liga a sessão quando ela ainda não está ligada", async () => {
  await comServidor({ configExistente: { id: "ac_antiga", naSessao: true } }, async ({ srv, sessao, pedidos }) => {
    const r = await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos: { subdomain: "acme", generic_api_key: CHAVE_DO_APP } });
    expect(r.status).toBe(200);
    expect(pedidos.some((p) => p.metodo === "POST" && p.url === "/auth_configs")).toBe(false);
    expect(pedidos.some((p) => p.metodo === "PATCH" && p.url.startsWith("/auth_configs/"))).toBe(false);
    expect((pedidos.find((p) => p.url === "/connected_accounts")?.body as { auth_config: unknown }).auth_config).toEqual({ id: "ac_antiga" });
  });
  await comServidor({ configExistente: { id: "ac_desligada", naSessao: false } }, async ({ srv, sessao, pedidos }) => {
    expect((await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos: { subdomain: "acme", generic_api_key: CHAVE_DO_APP } })).status).toBe(200);
    expect(pedidos.find((p) => p.metodo === "PATCH" && p.url === "/auth_configs/ac_desligada")?.body).toEqual({ type: "custom", is_enabled_for_tool_router: true });
  });
});

it("chave recusada pelo app vira integracao_autenticacao, sem conector e sem o texto do provedor", async () => {
  await comServidor({ recusar: true }, async ({ srv, sessao, memoria }) => {
    const r = await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos: { subdomain: "acme", generic_api_key: CHAVE_DO_APP } });
    expect(r.status).toBe(403);
    const corpo = await r.json() as { codigo: string; mensagem: string };
    expect(corpo.codigo).toBe("integracao_autenticacao");
    expect(JSON.stringify(corpo)).not.toContain(CHAVE_DO_APP);
    expect(memoria.banco.conectores).toHaveLength(0);
  });
});

it("campo obrigatório vazio, campo desconhecido ou valor com quebra de linha são entrada_invalida antes do provedor", async () => {
  await comServidor({}, async ({ srv, sessao, pedidos }) => {
    for (const campos of [{ subdomain: "acme" }, { subdomain: "acme", generic_api_key: CHAVE_DO_APP, extra: "x" }, { subdomain: "acme", generic_api_key: "a\nb" }, { subdomain: "acme", generic_api_key: 12 }]) {
      const r = await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos });
      expect(r.status).toBe(400);
    }
    expect(pedidos.some((p) => p.url === "/connected_accounts")).toBe(false);
  });
});

it("sem chave do Composio no tenant, campos e conectar pedem a configuração", async () => {
  const m = montar();
  const srv = await servidorDeTeste([...rotasMarketplace(m.op), ...rotasConectores(m.op)]);
  try {
    const sessao = await srv.entrar("ana");
    expect((await srv.chamar(sessao, "GET", "marketplace/freshdesk/campos")).status).toBe(409);
    expect((await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos: {} })).status).toBe(409);
  } finally {
    await srv.close();
  }
});

it("chave aceita pelo Composio mas recusada pelo app: apaga a conta no Composio e responde recusada", async () => {
  await comServidor({ appRecusa: true }, async ({ srv, sessao, pedidos, memoria }) => {
    const r = await srv.chamar(sessao, "POST", "marketplace/freshdesk/conectar-com-chave", { campos: { subdomain: "acme", generic_api_key: CHAVE_DO_APP } });
    expect(r.status).toBe(403);
    expect((pedidos.find((p) => p.url === "/tools/execute/proxy")?.body as { endpoint: string }).endpoint).toBe("https://acme.freshdesk.com/api/v2/agents/me");
    expect(pedidos.some((p) => p.metodo === "DELETE" && p.url === "/connected_accounts/ca_chave")).toBe(true);
    expect(pedidos.some((p) => p.url === "/tool_router/session")).toBe(false);
    expect(memoria.banco.conectores).toHaveLength(0);
  });
});

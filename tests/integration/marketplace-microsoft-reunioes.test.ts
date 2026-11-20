import { expect, it } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { sondarConector } from "../../src/adapters/mcp-proxy/probe.ts";
import { criarClienteMcp } from "../../src/adapters/mcp-proxy/cliente-mcp.ts";
import { normalizarPedidoAcesso } from "../../src/domain/pedido-acesso.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { mcpComposioFalso, URL_SESSAO_COMPOSIO } from "../helpers/composio-mcp-falso.ts";

const APPS = [
  ["outlook", "outlook", "OUTLOOK_LIST_MESSAGES", "OUTLOOK_SEND_EMAIL"],
  ["outlook", "outlook", "OUTLOOK_LIST_EVENTS", "OUTLOOK_CALENDAR_CREATE_EVENT"],
  ["microsoft-teams", "microsoft_teams", "MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS", "MICROSOFT_TEAMS_CREATE_MEETING"],
  ["one-drive", "one_drive", "ONE_DRIVE_GET_DRIVE", "ONE_DRIVE_DELETE_ITEM"],
  ["share-point", "share_point", "SHARE_POINT_GET_CURRENT_USER", "SHARE_POINT_UPLOAD_FILE"],
  ["fathom", "fathom", "FATHOM_LIST_MEETINGS", "FATHOM_CREATE_WEBHOOK"],
  ["fireflies", "fireflies", "FIREFLIES_GET_TRANSCRIPTS", "FIREFLIES_ADD_TO_LIVE"],
  ["granola-mcp", "granola_mcp", "GRANOLA_MCP_LIST_MEETINGS", "GRANOLA_MCP_CREATE_FOLDER"],
  ["read-ai-mcp", "read_ai_mcp", "READ_AI_MCP_LIST_MEETINGS", "READ_AI_MCP_CREATE_MEETING_AGENT"],
  ["otter-ai-mcp", "otter_ai_mcp", "OTTER_AI_MCP_OTTER_SEARCH", "OTTER_AI_MCP_OTTER_FETCH"],
] as const;

it.each(APPS)("%s: rotas reais, sonda MCP, chamada de leitura e concessões isoladas", async (slug, remoto, leitura, semAnotacao) => {
  const chave = chaveDe("teste-apps-local");
  const cifra = (s: string) => cifrar(s, chave);
  const ferramentas = [
    { name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema: { type: "object" } },
    { name: leitura, inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    // Mesmo um nome GET/FETCH sem anotação não ganha acesso de leitura.
    { name: semAnotacao, inputSchema: { type: "object" } },
  ];
  const mcp = mcpComposioFalso({ ferramentas });
  let userId = "";
  let donoConta = "";
  let toolkitConta: string = remoto;
  let chamadasDeAcao = 0;
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u === URL_SESSAO_COMPOSIO) {
      if (body?.method === "tools/call") {
        expect(body.params).toEqual({ name: leitura, arguments: {} });
        chamadasDeAcao++;
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "resultado de teste" }] } });
      }
      return mcp(u, init);
    }
    if (u.endsWith("/auth_configs")) return Response.json({ items: [{ toolkit: { slug: remoto, name: remoto } }] });
    if (u.endsWith("/toolkits?limit=1000")) return Response.json({ items: [] });
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/session")) {
      expect(body.toolkits).toEqual({ enable: [remoto] });
      userId = String(body.user_id); donoConta = userId;
      return Response.json({ session_id: "trs_teste", mcp: { url: URL_SESSAO_COMPOSIO } });
    }
    if (u.endsWith("/link")) {
      expect(body).toEqual({ toolkit: remoto });
      return Response.json({ redirect_url: "https://connect.composio.dev/test", connected_account_id: "ca_teste" });
    }
    if (u.endsWith("/connected_accounts/ca_teste")) return Response.json({ status: "ACTIVE", user_id: donoConta, toolkit: { slug: toolkitConta } });
    if (init?.method === "PATCH") {
      expect(body).toEqual({ connected_accounts: { [remoto]: ["ca_teste"] } });
      return Response.json({ tool_router_tools: [leitura, semAnotacao] });
    }
    throw new Error("endpoint inesperado");
  };
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => sondarConector({ nome: slug, transporte: "http", url: URL_SESSAO_COMPOSIO, env: { "x-api-key": "fake" } }, { fetchImpl: fakeFetch }) }) });
  const op = { dentro: memoria.dentro, cifrar: cifra, decifrar: (s: string) => decifrar(s, chave), fetchImpl: fakeFetch };
  const srv = await servidorDeTeste([...rotasMarketplace(op), ...rotasConectores(op)]);
  try {
    const sessao = await srv.entrar("ana");
    expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "fake" })).status).toBe(200);
    expect((await srv.chamar(sessao, "POST", `marketplace/${slug}/conectar`)).status).toBe(200);
    expect(userId).toBe(`nod:${sessao.tenantId}:${sessao.pessoaId}`);
    expect(memoria.banco.conectores[0]?.habilitado).toBe(false);
    donoConta = "nod:outro:outra";
    expect(await (await srv.chamar(sessao, "POST", `marketplace/${slug}/verificar`)).json()).toEqual({ conectado: false });
    donoConta = userId; toolkitConta = "outro";
    expect(await (await srv.chamar(sessao, "POST", `marketplace/${slug}/verificar`)).json()).toEqual({ conectado: false });
    toolkitConta = remoto;
    expect(await (await srv.chamar(sessao, "POST", `marketplace/${slug}/verificar`)).json()).toMatchObject({ conectado: true });
    const conector = memoria.banco.conectores[0]!;
    expect(conector.slug).toBe(slug);
    expect(conector.catalogo.map((f) => f.nome)).toEqual([leitura, semAnotacao]);
    expect(memoria.banco.concessoes).toHaveLength(0);
    const pedido = { conector: slug, capacidades: [], nivel: "leitura" as const, nao_pedido: [] };
    expect(normalizarPedidoAcesso({ pedido, conector, emRotina: false }).capacidades).toEqual([leitura]);
    expect(() => normalizarPedidoAcesso({ pedido: { ...pedido, capacidades: ["ACAO_INVENTADA"] }, conector, emRotina: false })).toThrow();
    expect(() => normalizarPedidoAcesso({ pedido: { ...pedido, capacidades: [semAnotacao] }, conector, emRotina: true })).toThrow();
    expect(chamadasDeAcao).toBe(0);
    const cliente = criarClienteMcp({ nome: slug, transporte: "http", comando: null, args: [], url: URL_SESSAO_COMPOSIO, env: { "x-api-key": "fake" }, fetchImpl: fakeFetch });
    try {
      expect(await cliente.chamar(leitura, {}, { somenteLeitura: true })).toEqual({ conteudo: "resultado de teste", isError: false });
    } finally { await cliente.fechar(); }
    expect(chamadasDeAcao).toBe(1);
    const publico = await (await srv.chamar(sessao, "GET", "conectores")).text();
    expect(publico).not.toContain("envCifrado");
  } finally { await srv.close(); }
});

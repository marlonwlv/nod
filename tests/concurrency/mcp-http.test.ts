import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { TokenMcpEmitidoDto, TokensMcpDto } from "../../src/contracts/mcp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Servidor MCP do Nod pelo HTTP real (compor + boot): gerar o token nos Ajustes, pilotar pelo /api/mcp com ele (as rotas
 * da tela rodam com o escopo do token) e revogar — o pedido seguinte cai em 401.
 */
describeIntegracao("servidor MCP do Nod pelo HTTP real", () => {
  let srv: ServidorCompleto;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto();
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  });

  const mcp = (token: string, corpo: unknown) =>
    fetch(`${srv.url}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(corpo) });
  const ferramenta = async (token: string, name: string, args: unknown) => {
    const r = await mcp(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    expect(r.status).toBe(200);
    const c = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    return c.result;
  };

  it("gera o token, pilota (lista bots e manda mensagem) e, revogado, o cliente cai em 401", async () => {
    const emitido = await srv.json<TokenMcpEmitidoDto>("POST", "mcp/tokens", { nome: "Grok Bot" });
    expect(emitido.token.startsWith("nod_mcp_")).toBe(true);
    expect(emitido.endpoint.endsWith("/api/mcp")).toBe(true);
    // O token cru não volta na lista.
    expect(JSON.stringify(await srv.json<TokensMcpDto>("GET", "mcp/tokens"))).not.toContain(emitido.token);

    const b = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Piloto MCP" });
    agentes.push(b.agente.id);
    conversas.push(b.conversa.id);

    const init = await mcp(emitido.token, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Grok Bot", version: "1" } } });
    expect(init.status).toBe(200);

    const lista = await ferramenta(emitido.token, "nod_listar_bots", {});
    expect(lista.isError).toBeFalsy();
    expect(lista.content[0]!.text).toContain("Piloto MCP");

    const envio = await ferramenta(emitido.token, "nod_conversar", { bot: "Piloto MCP", texto: "oi pelo MCP", esperar_segundos: 0 });
    expect(envio.isError).toBeFalsy();
    const conversa = await srv.json<ConversaDto>("GET", `conversas/${b.conversa.id}/mensagens`);
    expect(conversa.mensagens.some((m) => m.texto === "oi pelo MCP" && m.autoria.autor_tipo === "pessoa")).toBe(true);

    // O uso e o cliente ficam na lista dos Ajustes.
    const depois = (await srv.json<TokensMcpDto>("GET", "mcp/tokens")).tokens.find((t) => t.id === emitido.dados.id);
    expect(depois).toMatchObject({ cliente: "Grok Bot", revogadoEm: null });
    expect(depois?.ultimoUsoEm).toBeTypeOf("number");

    // A rota dos tokens não é alcançável pelo MCP (um token não gera outro).
    const porDentro = JSON.parse((await ferramenta(emitido.token, "nod_chamar_rota", { metodo: "POST", caminho: "/mcp/tokens", corpo: { nome: "outro" } })).content[0]!.text) as { status: number };
    expect(porDentro.status).toBe(404);

    expect((await srv.chamar("DELETE", `mcp/tokens/${emitido.dados.id}`)).status).toBe(200);
    expect((await mcp(emitido.token, { jsonrpc: "2.0", id: 2, method: "ping" })).status).toBe(401);
    expect((await mcp(`${emitido.token}x`, { jsonrpc: "2.0", id: 3, method: "ping" })).status).toBe(401);
  });

  it("nome vazio é 400 e o id malformado na revogação não vira 500", async () => {
    expect((await srv.chamar("POST", "mcp/tokens", { nome: "  " })).status).toBe(400);
    expect((await srv.chamar("DELETE", "mcp/tokens/nao-e-uuid")).status).toBe(404);
    expect((await srv.chamar("DELETE", "mcp/tokens/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

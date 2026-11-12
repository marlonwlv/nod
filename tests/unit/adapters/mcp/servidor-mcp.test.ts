import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listen } from "../../../../src/adapters/http/server.ts";
import type { Rota } from "../../../../src/adapters/http/roteador.ts";
import { ErroDeDominio } from "../../../../src/domain/erro.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../../helpers/ids.ts";

const TOKEN = "nod_mcp_valido";
const BOT = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const DECISAO = "33333333-3333-4333-8333-333333333333";
const TAREFA = "44444444-4444-4444-8444-444444444444";
const QUADRO = "55555555-5555-4555-8555-555555555555";

/** As rotas falsas da tela: guardam o que o servidor MCP chamou, como a tela chamaria. */
function rotasFalsas() {
  const chamadas: { metodo: string; caminho: string; corpo: unknown; escopo: unknown }[] = [];
  let leituras = 0;
  const registrar = async (ctx: Parameters<Rota["handler"]>[0], metodo: string, caminho: string) => {
    chamadas.push({ metodo, caminho, corpo: metodo === "GET" ? null : await ctx.corpo(), escopo: ctx.escopo });
  };
  const rotas: Rota[] = [
    { metodo: "GET", padrao: /^\/frota$/, async handler(ctx) { await registrar(ctx, "GET", "/frota"); ctx.json(200, { agentes: [{ id: BOT, nome: "Ada", titulo: "PM", conversaId: CONVERSA, naoLido: true, ultimaMensagem: { previa: "oi", em: 0 } }] }); } },
    { metodo: "POST", acao: "conversas.enviar", padrao: /^\/conversas\/(?<id>[^/]+)\/mensagens$/, async handler(ctx) { await registrar(ctx, "POST", `/conversas/${ctx.params.id}/mensagens`); ctx.json(201, { ok: true, ids: { mensagem: "m-pessoa", turno: "t-1" } }); } },
    { metodo: "GET", padrao: /^\/conversas\/(?<id>[^/]+)\/mensagens$/, async handler(ctx) {
      leituras += 1;
      const pessoa = { id: "m-pessoa", turnoId: null, kind: "texto", texto: "bom dia", criadoEm: 1, autoria: { autor_tipo: "pessoa" } };
      if (leituras === 1) { ctx.json(200, { mensagens: [pessoa], turnosEmCurso: [{ id: "t-1" }], turnosPendentes: [] }); return; }
      ctx.json(200, { mensagens: [pessoa, { id: "m-bot", turnoId: "t-1", kind: "texto", texto: "Bom dia, Marlon!", criadoEm: 2, autoria: { autor_tipo: "agente" } }], turnosEmCurso: [], turnosPendentes: [] });
    } },
    { metodo: "GET", padrao: /^\/sua-vez$/, async handler(ctx) { ctx.json(200, { itens: [{ decisao: { id: DECISAO, tipo: "aprovacao", frase: "Enviar o e-mail?", criadoEm: "2026-11-12T10:00:00Z" }, agenteNome: "Ada", itensAprovacao: [{ id: "i-1", textoFinal: "Enviar", selecionado: true }] }] }); } },
    { metodo: "GET", padrao: /^\/nao-lidos$/, async handler(ctx) { ctx.json(200, { conversas: [{ conversaId: CONVERSA, tipo: "propria", agenteId: BOT, total: 3 }] }); } },
    { metodo: "POST", acao: "cartoes.decidir", padrao: /^\/decisoes\/(?<id>[^/]+)\/decidir$/, async handler(ctx) { await registrar(ctx, "POST", `/decisoes/${ctx.params.id}/decidir`); ctx.json(200, { ok: true, ids: { decisao: ctx.params.id } }); } },
    { metodo: "GET", padrao: /^\/quadro\/tarefas\/(?<codigo>[^/]+)$/, async handler(ctx) {
      if (ctx.params.codigo !== "ADA-1") throw new ErroDeDominio("nao_encontrado", { cause: "tarefa" });
      ctx.json(200, { agenteId: BOT, quadroId: QUADRO, tarefaId: TAREFA, codigo: "ADA-1", codigoAtual: "ADA-1" });
    } },
    { metodo: "PATCH", acao: "quadro.mudar_tarefa", padrao: /^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas\/(?<tid>[^/]+)$/, async handler(ctx) {
      await registrar(ctx, "PATCH", `${new URL(ctx.req.url ?? "/", "http://x").pathname}${new URL(ctx.req.url ?? "/", "http://x").search}`);
      ctx.json(200, { ok: true });
    } },
    { metodo: "POST", acao: "quadro.criar_tarefa", padrao: /^\/agentes\/(?<id>[^/]+)\/quadro\/tarefas$/, async handler(ctx) { await registrar(ctx, "POST", `/agentes/${ctx.params.id}/quadro/tarefas`); ctx.json(201, { ok: true, tarefa: "ADA-2" }); } },
    // Uma ação que o registro marca "nunca" no chat (leva segredo): o MCP não chega nela, nem pelo nod_chamar_rota.
    { metodo: "POST", acao: "maquinas.criar_chave", padrao: /^\/maquinas\/chaves$/, async handler(ctx) { await registrar(ctx, "POST", "/maquinas/chaves"); ctx.json(201, { chave: "segredo" }); } },
    { metodo: "GET", padrao: /^\/mcp\/tokens$/, async handler(ctx) { await registrar(ctx, "GET", "/mcp/tokens"); ctx.json(200, { tokens: [] }); } },
  ];
  return { rotas, chamadas };
}

describe("servidor MCP do Nod (POST /api/mcp)", () => {
  let url = "";
  let close: () => Promise<void> = async () => {};
  const clientes: (string | null)[] = [];
  const falsas = rotasFalsas();

  beforeAll(async () => {
    const srv = await listen(0, "127.0.0.1", {
      rotas: falsas.rotas,
      segredoSessao: "segredo-de-teste",
      mcp: {
        versaoNod: "1.2.3",
        dormir: async () => {},
        async autorizar(token, cliente) {
          clientes.push(cliente);
          return token === TOKEN ? { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, tokenId: "tok-1" } : null;
        },
      },
    });
    url = `http://127.0.0.1:${srv.port}/api/mcp`;
    close = srv.close;
  });
  afterAll(async () => close());

  const rpc = async (corpo: unknown, headers: Record<string, string> = {}) =>
    fetch(url, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(corpo) });
  const chamarFerramenta = async (name: string, args: unknown) => {
    const r = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    return { erro: corpo.result.isError === true, texto: corpo.result.content[0]!.text };
  };

  it("sem token, com token inválido ou com Origin: recusa antes de qualquer rota", async () => {
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer outro" })).status).toBe(401);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://site.exemplo" })).status).toBe(403);
    expect((await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405);
  });

  it("initialize anuncia ferramentas e grava o nome do cliente; notificação dá 202", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Grok Bot", version: "1" } } });
    const corpo = (await r.json()) as { result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string; version: string } } };
    expect(corpo.result.protocolVersion).toBe("2025-06-18");
    expect(corpo.result.capabilities.tools).toBeDefined();
    expect(corpo.result.serverInfo).toMatchObject({ name: "nod", version: "1.2.3" });
    expect(clientes).toContain("Grok Bot");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const outra = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json()) as { result: { protocolVersion: string } };
    expect(outra.result.protocolVersion).toBe("2025-06-18");
  });

  it("tools/list traz a 1ª leva com schema; método desconhecido é -32601", async () => {
    const corpo = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" })).json()) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    const nomes = corpo.result.tools.map((t) => t.name);
    for (const n of ["nod_listar_bots", "nod_conversar", "nod_o_que_espera_por_mim", "nod_decidir", "nod_ver_quadro", "nod_criar_tarefa", "nod_mudar_tarefa", "nod_listar_rotinas", "nod_rodar_rotina", "nod_chamar_rota"]) expect(nomes).toContain(n);
    expect(corpo.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    const errado = (await (await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json()) as { error: { code: number } };
    expect(errado.error.code).toBe(-32601);
  });

  it("nod_conversar manda a mensagem na conversa do bot (pelo nome) e devolve a resposta quando o turno acaba", async () => {
    const r = await chamarFerramenta("nod_conversar", { bot: "ada", texto: "bom dia" });
    expect(r.texto && r.erro ? r.texto : false).toBe(false);
    const saida = JSON.parse(r.texto) as { terminou: boolean; resposta: { quem: string; texto: string }[] };
    expect(saida.terminou).toBe(true);
    expect(saida.resposta).toEqual([expect.objectContaining({ quem: "Ada", texto: "Bom dia, Marlon!" })]);
    const envio = falsas.chamadas.find((c) => c.caminho === `/conversas/${CONVERSA}/mensagens`);
    expect(envio?.corpo).toMatchObject({ texto: "bom dia" });
    // A rota roda com o escopo do token, como a sessão da tela.
    expect(envio?.escopo).toEqual({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON });
  });

  it("o que espera e decidir: recusar uma aprovação desmarca todos os itens, como a tela", async () => {
    const espera = JSON.parse((await chamarFerramenta("nod_o_que_espera_por_mim", {})).texto) as { pedidos: { id: string; como_decidir: string }[]; nao_lidos: unknown[] };
    expect(espera.pedidos[0]).toMatchObject({ id: DECISAO, como_decidir: expect.stringContaining("nod_decidir") });
    expect(espera.nao_lidos).toEqual([{ bot: "Ada", mensagens: 3 }]);
    const rec = await chamarFerramenta("nod_decidir", { pedido_id: DECISAO, decisao: "recusar" });
    expect(rec.erro ? rec.texto : false).toBe(false);
    expect(falsas.chamadas.filter((c) => c.caminho === `/decisoes/${DECISAO}/decidir`).at(-1)?.corpo).toEqual({ itens: [{ id: "i-1", selecionado: false }] });
    expect((await chamarFerramenta("nod_decidir", { pedido_id: DECISAO, decisao: "aprovar" })).erro).toBe(false);
    expect(falsas.chamadas.filter((c) => c.caminho === `/decisoes/${DECISAO}/decidir`).at(-1)?.corpo).toEqual({});
  });

  it("criar e mover tarefa passam pelas rotas do quadro; a recusa da rota volta como isError com a frase da tabela", async () => {
    expect((await chamarFerramenta("nod_criar_tarefa", { bot: "Ada", titulo: "Nova", coluna: "Priorizado" })).erro).toBe(false);
    expect(falsas.chamadas.find((c) => c.caminho === `/agentes/${BOT}/quadro/tarefas`)?.corpo).toEqual({ titulo: "Nova", status: "Priorizado" });
    expect((await chamarFerramenta("nod_mudar_tarefa", { tarefa: "ADA-1", coluna: "Done" })).erro).toBe(false);
    const patch = falsas.chamadas.find((c) => c.metodo === "PATCH");
    expect(patch).toMatchObject({ caminho: `/agentes/${BOT}/quadro/tarefas/${TAREFA}?quadro=${QUADRO}`, corpo: { status: "Done" } });
    const falha = await chamarFerramenta("nod_mudar_tarefa", { tarefa: "XYZ-9", coluna: "Done" });
    expect(falha.erro).toBe(true);
    expect(falha.texto).toContain("Não encontramos");
  });

  it("nod_chamar_rota alcança rotas da tela, mas não as de segredo nem a dos próprios tokens MCP", async () => {
    const frota = JSON.parse((await chamarFerramenta("nod_chamar_rota", { metodo: "GET", caminho: "/frota" })).texto) as { status: number };
    expect(frota.status).toBe(200);
    const chave = JSON.parse((await chamarFerramenta("nod_chamar_rota", { metodo: "POST", caminho: "/maquinas/chaves", corpo: { nome: "x" } })).texto) as { status: number };
    expect(chave.status).toBe(404);
    const tokens = JSON.parse((await chamarFerramenta("nod_chamar_rota", { metodo: "GET", caminho: "/mcp/tokens" })).texto) as { status: number };
    expect(tokens.status).toBe(404);
    expect(falsas.chamadas.some((c) => c.caminho === "/maquinas/chaves" || c.caminho === "/mcp/tokens")).toBe(false);
  });
});

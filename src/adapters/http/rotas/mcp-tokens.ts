import type { IncomingMessage } from "node:http";
import type { TokenMcpEmitidoDto, TokensMcpDto } from "../../../contracts/mcp.ts";
import { assertUuid } from "../../../use-cases/apoio-l7.ts";
import { emitirTokenMcp, revogarTokenMcp } from "../../../use-cases/tokens-mcp.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

/**
 * O endereço que a pessoa cola no cliente MCP: NOD_URL_PUBLICA quando o servidor a conhece; senão o host do pedido
 * (o mesmo endereço por onde a tela chegou), com o esquema do proxy quando houver um.
 */
export function endpointMcp(req: Pick<IncomingMessage, "headers">, urlPublica?: string): string {
  const base = urlPublica?.trim().replace(/\/$/, "");
  if (base) return `${base}/api/mcp`;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() || "http";
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "127.0.0.1:8888").split(",")[0]?.trim();
  return `${proto === "https" ? "https" : "http"}://${host}/api/mcp`;
}

/**
 * Os tokens do servidor MCP (0173) nos Ajustes: listar, gerar (o token cru sai só nesta resposta) e revogar. O servidor
 * MCP nunca chama estas rotas (chamador-interno.ts): um token não gera outro.
 */
export function rotasMcpTokens(deps: { dentro: DentroDeTx; urlPublica?: string }): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/mcp\/tokens$/,
      async handler(ctx) {
        const tokens = await deps.dentro(ctx.escopo, (d) => d.repos.mcpTokens.listar());
        const corpo: TokensMcpDto = { tokens, endpoint: endpointMcp(ctx.req, deps.urlPublica) };
        ctx.json(200, corpo);
      },
    },
    {
      metodo: "POST", acao: "mcp.criar_token",
      padrao: /^\/mcp\/tokens$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown };
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, emitirTokenMcp, { nome: corpo?.nome }));
        const resposta: TokenMcpEmitidoDto = { ...r, endpoint: endpointMcp(ctx.req, deps.urlPublica) };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "DELETE", acao: "mcp.revogar_token",
      padrao: /^\/mcp\/tokens\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const id = ctx.params.id ?? "";
        assertUuid(id, "id");
        ctx.json(200, await deps.dentro(ctx.escopo, (d) => executar(d, revogarTokenMcp, { id })));
      },
    },
  ];
}

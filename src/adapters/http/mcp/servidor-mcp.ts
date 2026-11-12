import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "../../../obs/log.ts";
import type { Escopo } from "../../../shared/types.ts";
import { json, lerCorpo } from "../util.ts";
import type { ChamadorInterno } from "./chamador-interno.ts";
import { DEFINICOES_MCP, executarFerramentaMcp } from "./ferramentas.ts";

/**
 * Servidor MCP do Nod: o endpoint `POST /api/mcp` no transporte Streamable HTTP do MCP, sem estado (cada pedido traz o
 * token; não há sessão nem SSE). Responde JSON-RPC 2.0 com `application/json`, que a especificação permite no lugar do
 * stream: initialize, ping, tools/list e tools/call; notificações (sem id) recebem 202. GET e DELETE dão 405 (o servidor
 * não abre stream do lado dele nem guarda sessão para encerrar).
 *
 * Autenticação: `Authorization: Bearer nod_mcp_…` (o token gerado nos Ajustes, 0173), validado a cada pedido — revogar
 * derruba o cliente no pedido seguinte. Um pedido com `Origin` é recusado (403) antes do token, como as rotas internas
 * (ADR-021): o cliente MCP é um programa, não uma página; isso fecha o DNS rebinding que a especificação manda evitar.
 */

/** As versões do protocolo que este servidor fala; a primeira é a que ele propõe quando o cliente pede outra. */
export const VERSOES_MCP = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type IdentidadeDoToken = Escopo & { tokenId: string };

export interface DepsServidorMcp {
  /** Valida o token (autorizarTokenMcp); `cliente` é o clientInfo.name do initialize, quando o pedido é um. */
  autorizar(token: string, cliente: string | null): Promise<IdentidadeDoToken | null>;
  chamar: ChamadorInterno;
  versaoNod: string;
  agora?(): number;
  dormir?(ms: number): Promise<void>;
}

type PedidoRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type IdRpc = string | number | null;

const INSTRUCOES =
  "Este servidor pilota o Nod da pessoa: os bots dela, as conversas, o que espera por ela (aprovações e perguntas), o quadro de tarefas e as rotinas. " +
  "Comece por nod_listar_bots ou nod_o_que_espera_por_mim. Tudo roda com as permissões da pessoa, como na tela: confirme com ela antes de aprovar um pedido com efeito externo ou de mover trabalho de um bot.";

const erroRpc = (id: IdRpc, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const okRpc = (id: IdRpc, result: unknown) => ({ jsonrpc: "2.0", id, result });

function idDoPedido(p: PedidoRpc): IdRpc | undefined {
  return typeof p.id === "string" || typeof p.id === "number" ? p.id : p.id === null ? null : undefined;
}

function clienteDoInitialize(corpo: unknown): string | null {
  const um = Array.isArray(corpo) ? corpo.find((p: PedidoRpc) => p?.method === "initialize") : corpo;
  const nome = (um as { method?: unknown; params?: { clientInfo?: { name?: unknown } } } | null)?.method === "initialize" ? (um as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name : undefined;
  return typeof nome === "string" && nome.trim() ? nome.trim().slice(0, 80) : null;
}

export function criarServidorMcp(deps: DepsServidorMcp): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const agora = deps.agora ?? (() => Date.now());
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function responderUm(identidade: IdentidadeDoToken, p: PedidoRpc): Promise<object | null> {
    const id = idDoPedido(p);
    if (p === null || typeof p !== "object" || p.jsonrpc !== "2.0" || typeof p.method !== "string") return erroRpc(id ?? null, -32600, "Pedido JSON-RPC inválido.");
    // Notificação (sem id): nada a responder (notifications/initialized, notifications/cancelled…).
    if (id === undefined) return null;
    const params = (typeof p.params === "object" && p.params !== null ? p.params : {}) as Record<string, unknown>;
    switch (p.method) {
      case "initialize": {
        const pedida = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const versao = (VERSOES_MCP as readonly string[]).includes(pedida) ? pedida : VERSOES_MCP[0];
        return okRpc(id, { protocolVersion: versao, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nod", title: "Nod", version: deps.versaoNod }, instructions: INSTRUCOES });
      }
      case "ping":
        return okRpc(id, {});
      case "tools/list":
        return okRpc(id, { tools: DEFINICOES_MCP });
      case "tools/call": {
        const nome = typeof params.name === "string" ? params.name : "";
        const inicio = agora();
        const r = await executarFerramentaMcp({ escopo: { tenantId: identidade.tenantId, pessoaId: identidade.pessoaId }, chamar: deps.chamar, agora, dormir }, nome, params.arguments);
        if (!r) return erroRpc(id, -32602, `Ferramenta desconhecida: ${nome}`);
        // Só o nome e o desfecho (ADR-004): nunca os argumentos nem a saída, que levam texto da pessoa.
        log("info", "mcp_ferramenta", { token: identidade.tokenId, ferramenta: nome, erro: r.isError === true, ms: agora() - inicio });
        return okRpc(id, r);
      }
      default:
        return erroRpc(id, -32601, `Método não suportado: ${p.method}`);
    }
  }

  return async (req, res) => {
    if (req.headers.origin !== undefined) {
      json(res, 403, { codigo: "nao_permitido", mensagem: "O endpoint MCP não aceita pedido de navegador." });
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(erroRpc(null, -32000, "Use POST: este servidor MCP não abre stream nem guarda sessão.")));
      return;
    }
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    let corpo: unknown;
    try {
      corpo = await lerCorpo(req, { daPessoa: true });
    } catch {
      json(res, 400, erroRpc(null, -32700, "Corpo JSON inválido."));
      return;
    }
    const identidade = token ? await deps.autorizar(token, clienteDoInitialize(corpo)) : null;
    if (!identidade) {
      res.writeHead(401, { "www-authenticate": 'Bearer realm="nod"', "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(erroRpc(null, -32001, "Token do Nod ausente, inválido ou revogado. Gere um nos Ajustes do Nod, em Conectar por MCP.")));
      return;
    }
    if (Array.isArray(corpo)) {
      if (corpo.length === 0) { json(res, 400, erroRpc(null, -32600, "Lote vazio.")); return; }
      const respostas = (await Promise.all(corpo.map((p: PedidoRpc) => responderUm(identidade, p)))).filter((r): r is object => r !== null);
      if (respostas.length === 0) { res.writeHead(202); res.end(); return; }
      json(res, 200, respostas);
      return;
    }
    const resposta = await responderUm(identidade, corpo as PedidoRpc);
    if (!resposta) { res.writeHead(202); res.end(); return; }
    json(res, 200, resposta);
  };
}

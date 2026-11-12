import type { Readable, Writable } from "node:stream";
import type { JsonSchema } from "../../contracts/json-schema.ts";
import { PROTOCOLO_MCP } from "../mcp-proxy/cliente-mcp.ts";
import { CODIGO, erro, interpretar, resposta } from "../mcp-proxy/jsonrpc.ts";
import { criarLineSplitter } from "../mcp-proxy/line-splitter.ts";

/**
 * Servidor MCP stdio mínimo para os conectores locais do assistente pessoal (ADR-176): o mesmo JSON-RPC 2.0 sem SDK do
 * conector `github` (uma linha por mensagem, respostas em ordem), sem o que é do GitHub. O nod o spawna como qualquer
 * conector stdio, então a sonda, a concessão, a aprovação e a moldura de não confiável seguem o caminho de sempre: este
 * processo só executa. NUNCA escreve fora do JSON-RPC no stdout: é o canal.
 */
export type FerramentaMcp = { nome: string; descricao: string; schema: JsonSchema; readOnlyHint: boolean; destructiveHint?: boolean };

/** O que a ferramenta devolve: texto (JSON, para o modelo) ou falha com o motivo em português (o modelo lê e corrige). */
export type ResultadoMcp = { ok: true; texto: string } | { ok: false; motivo: string };

export type ServidorMcpSimples = { tratarLinha(linha: string): Promise<string | null>; ligar(entrada: Readable, saida: Writable): Promise<void> };

export function criarServidorMcpSimples(o: {
  nome: string;
  ferramentas: readonly FerramentaMcp[];
  executar: (nome: string, args: Record<string, unknown>) => Promise<ResultadoMcp>;
}): ServidorMcpSimples {
  let fila: Promise<unknown> = Promise.resolve();
  const nomes = new Set(o.ferramentas.map((f) => f.nome));

  async function chamar(params: unknown): Promise<unknown> {
    const p = (typeof params === "object" && params !== null ? params : {}) as { name?: unknown; arguments?: unknown };
    const nome = typeof p.name === "string" ? p.name : "";
    const args = (typeof p.arguments === "object" && p.arguments !== null && !Array.isArray(p.arguments) ? p.arguments : {}) as Record<string, unknown>;
    const falha = (texto: string) => ({ content: [{ type: "text", text: texto }], isError: true });
    if (!nomes.has(nome)) return falha(`ferramenta desconhecida: ${nome || "(sem nome)"}`);
    try {
      const r = await o.executar(nome, args);
      return r.ok ? { content: [{ type: "text", text: r.texto }] } : falha(r.motivo);
    } catch {
      // O erro de verdade fica no processo: a mensagem de uma exceção pode trazer dado do provedor (AGENTS.md).
      return falha("falha interna do conector; tente de novo em instantes");
    }
  }

  async function tratarDentro(linha: string): Promise<string | null> {
    const m = interpretar(linha);
    if (m.tipo === "invalida") return m.motivo === "json_invalido" ? erro(null, CODIGO.parseError, "JSON inválido") : erro(m.id, CODIGO.invalidRequest, "requisição inválida");
    if (m.tipo !== "requisicao") return null;
    switch (m.metodo) {
      case "initialize": {
        const pv = typeof m.params === "object" && m.params !== null ? (m.params as { protocolVersion?: unknown }).protocolVersion : undefined;
        return resposta(m.id, { protocolVersion: typeof pv === "string" ? pv : PROTOCOLO_MCP, capabilities: { tools: { listChanged: false } }, serverInfo: { name: o.nome, version: "1" } });
      }
      case "ping":
        return resposta(m.id, {});
      case "tools/list":
        return resposta(m.id, {
          tools: o.ferramentas.map((f) => ({ name: f.nome, description: f.descricao, inputSchema: f.schema, annotations: { readOnlyHint: f.readOnlyHint, ...(f.destructiveHint !== undefined ? { destructiveHint: f.destructiveHint } : {}) } })),
        });
      case "tools/call":
        return resposta(m.id, await chamar(m.params));
      default:
        return erro(m.id, CODIGO.methodNotFound, `método não suportado: ${m.metodo}`);
    }
  }

  function tratarLinha(linha: string): Promise<string | null> {
    const r = fila.then(() => tratarDentro(linha));
    fila = r.catch(() => undefined);
    return r;
  }

  return {
    tratarLinha,
    ligar(entrada, saida) {
      const splitter = criarLineSplitter();
      const escrever = (l: string | null) => {
        if (l !== null) saida.write(`${l}\n`);
      };
      const tratar = (l: string) => tratarLinha(l).then(escrever, () => escrever(erro(null, CODIGO.internalError, "falha interna")));
      return new Promise<void>((resolve) => {
        entrada.on("data", (chunk: Buffer | string) => {
          for (const l of splitter.alimentar(chunk)) void tratar(l);
        });
        entrada.on("end", () => {
          for (const l of splitter.encerrar()) void tratar(l);
          void fila.then(() => resolve());
        });
      });
    },
  };
}

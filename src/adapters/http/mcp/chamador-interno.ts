import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Escopo } from "../../../shared/types.ts";
import { REGISTRO_DE_ACOES } from "../../../domain/acoes/index.ts";
import { responderErro } from "../erros.ts";
import { casar, type Ctx, type Metodo, type Rota } from "../roteador.ts";

export type PedidoInterno = { metodo: Metodo; caminho: string; corpo?: unknown };
export type RespostaInterna = { status: number; corpo: unknown };
export type ChamadorInterno = (escopo: Escopo, pedido: PedidoInterno) => Promise<RespostaInterna>;

/**
 * Rotas que o cliente MCP nunca chama, nem pelo `nod_chamar_rota`: os próprios tokens MCP (um token não gera outro nem se
 * esconde da lista) e o canal SSE (`/eventos`, que não termina). As ações que o registro marca `nunca` no chat (as que
 * levam um segredo, a senha ou o pareamento) também ficam de fora: o motivo de não irem pela conversa vale para um
 * cliente de fora.
 */
const CAMINHOS_FORA = [/^\/mcp(\/|$)/, /^\/eventos$/];
const ACOES_NUNCA = new Set<string>(REGISTRO_DE_ACOES.filter((a) => a.chat.estado === "nunca").map((a) => a.id));

export function rotaForaDoMcp(rota: Rota, caminho: string): boolean {
  if (CAMINHOS_FORA.some((p) => p.test(caminho))) return true;
  return rota.acao !== undefined && ACOES_NUNCA.has(rota.acao);
}

/**
 * Servidor MCP do Nod: roda uma rota de pessoa (a família /api/t/:tenant/…) por dentro, com o escopo do token, sem
 * passar pela rede nem pela sessão de cookie. O handler é o MESMO que a tela chama (mesmo caso de uso, mesmas
 * permissões, mesma RLS, mesmo registro de ações), então a paridade com a tela é de graça: o que a tela faz pela rota, o
 * cliente MCP faz igual. A resposta é capturada (ctx.json, ou o que o handler escreveu no res, como o erro de
 * responderErro) e devolvida como dado.
 */
export function criarChamadorInterno(rotas: readonly Rota[]): ChamadorInterno {
  const daPessoa = rotas.filter((r) => !r.interno && !r.publica && !r.maquina);
  return async (escopo, pedido) => {
    const url = new URL(pedido.caminho, "http://127.0.0.1");
    const caminho = url.pathname;
    const achado = casar(daPessoa, pedido.metodo, caminho, () => true);
    if (!achado || rotaForaDoMcp(achado.rota, caminho)) return { status: 404, corpo: { codigo: "nao_encontrado", mensagem: "Essa rota não existe ou não está disponível pelo MCP." } };

    const req = new IncomingMessage(new Socket());
    req.method = pedido.metodo;
    req.url = `${caminho}${url.search}`;
    req.headers = { "x-nod-origem": "mcp" };
    const res = new ServerResponse(req);
    let status = 200;
    let capturado: { corpo: unknown } | null = null;
    const partes: Buffer[] = [];
    const paraBuffer = (c: unknown): Buffer | null => (c === undefined || c === null || typeof c === "function" ? null : Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
    // O res não tem socket de verdade: tudo que o handler escreve fica aqui, e o "finish" sai quando ele termina.
    res.writeHead = ((s: number) => { status = s; res.statusCode = s; return res; }) as typeof res.writeHead;
    res.setHeader = (() => res) as typeof res.setHeader;
    res.write = ((c: unknown) => { const b = paraBuffer(c); if (b) partes.push(b); return true; }) as typeof res.write;
    res.end = ((c?: unknown) => { const b = paraBuffer(c); if (b) partes.push(b); res.emit("finish"); return res; }) as typeof res.end;

    const ctx: Ctx = {
      req,
      res,
      escopo,
      params: achado.params,
      corpo: () => Promise.resolve(pedido.corpo ?? {}),
      json: (s, body) => {
        status = s;
        res.statusCode = s;
        capturado = { corpo: body };
        res.emit("finish");
      },
    };
    try {
      await (achado.rota.handler as (c: Ctx) => Promise<void>)(ctx);
    } catch (err) {
      responderErro(res, err, { metodo: pedido.metodo, caminho });
    }
    if (capturado) return { status, corpo: (capturado as { corpo: unknown }).corpo };
    const texto = Buffer.concat(partes).toString("utf8");
    try {
      return { status, corpo: texto ? JSON.parse(texto) : null };
    } catch {
      return { status, corpo: texto };
    }
  };
}

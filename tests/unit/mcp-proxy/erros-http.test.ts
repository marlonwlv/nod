import { expect, it } from "vitest";
import { criarClienteNod } from "../../../src/adapters/executor/cliente-nod.ts";
import { criarProxy } from "../../../src/adapters/mcp-proxy/proxy.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

it("preserva 4xx tipado como erro da chamada, sem afirmar que o serviço está indisponível", async () => {
  const plano = planoHarness();
  plano.expiraEm = 10_000;
  plano.catalogo.ferramentas = [{ nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } }];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const caminho = String(_url);
    if (caminho.endsWith("/plano")) return new Response(JSON.stringify(plano), { status: 200 });
    expect(init?.method).toBe("POST");
    return new Response(JSON.stringify({ codigo: "nao_permitido", mensagem: "Use computador_interagir diretamente." }), { status: 403 });
  };
  const cliente = criarClienteNod({ url: "http://nod", token: "t", fetchImpl });
  expect(await cliente.ferramenta("pedir_aprovacao", {})).toEqual({ erroHttp: { status: 403, codigo: "nao_permitido", mensagem: "Use computador_interagir diretamente." } });

  const proxy = criarProxy({ cliente, agora: () => 1 });
  await proxy.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  const bruto = await proxy.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pedir_aprovacao", arguments: {} } }));
  const texto = JSON.parse(bruto!).result.content[0].text as string;
  expect(texto).toContain("nao_permitido");
  expect(texto).toContain("computador_interagir");
  expect(texto).not.toContain("indisponível");
  expect(proxy.estado().servidorForaDesde).toBeNull();
});

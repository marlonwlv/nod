import { expect, it } from "vitest";
import type { ClienteNod } from "../../src/adapters/executor/cliente-nod.ts";
import { criarProxy } from "../../src/adapters/mcp-proxy/proxy.ts";
import { planoHarness } from "../helpers/plano-harness.ts";

/** ADR-190: a resposta do navegador do bot ganha a moldura de não confiável mesmo curta, e o print vai em JPEG. */
const ferramenta = { nome: "navegador_ver", nomeMcp: "mcp__nod__navegador_ver" as const, origem: "navegador" as const, conectorId: null, readOnlyHint: true, tocaDadoPessoal: true, schema: { type: "object" as const } };

async function chamar(cliente: Partial<ClienteNod>) {
  const plano = planoHarness();
  plano.expiraEm = 1000;
  plano.catalogo.ferramentas = [ferramenta];
  const proxy = criarProxy({ cliente: { plano: async () => ({ ok: true, plano }), aguardar: async () => ({ estado: "pendente" }), negacao: async () => {}, chamarFerramenta: async () => ({ conteudo: "", isError: false }), ferramenta: async () => ({ ok: true, conteudo: "", confianca: "confiavel" }), ...cliente } as ClienteNod, agora: () => 1, fatiasAprovacao: 1 });
  await proxy.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  return JSON.parse((await proxy.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "navegador_ver", arguments: {} } })))!);
}

it("texto curto da página vai moldurado e a imagem JPEG passa inteira", async () => {
  const r = await chamar({ ferramenta: async () => ({ ok: true, conteudo: "{\"url\":\"https://a\"}", confianca: "nao_confiavel", imagem: { mimeType: "image/jpeg", data: "/9j/AAAA" } }) });
  expect(r.result.content[0].text).toContain("origem=\"navegador_ver\"");
  expect(r.result.content[1]).toEqual({ type: "image", mimeType: "image/jpeg", data: "/9j/AAAA" });
});

it("o resultado da ação aprovada no navegador volta moldurado com a origem do navegador", async () => {
  const r = await chamar({
    ferramenta: async () => ({ aguardar: "d1" }),
    aguardar: async () => ({ estado: "decidida", itens: [{ idx: 0, desfecho: "executado", resultado: "{\"ok\":true}", origem: "navegador" }] }),
  });
  const texto = String(r.result.content[0].text);
  expect(texto).toContain("origem=\"navegador\"");
  expect(texto).not.toContain("\"origem\":\"navegador\"");
});

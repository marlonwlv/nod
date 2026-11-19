import { expect, it } from "vitest";
import { criarClienteComposio } from "../../../src/adapters/integracoes/composio.ts";
import { mesclarCatalogo } from "../../../src/domain/catalogo-marketplace.ts";
import { reduzir, estadoInicial } from "../../../web/estado/reducer.ts";
import type { AppComLogo } from "../../../src/contracts/marketplace.ts";
import { appsDeLogin } from "../../../web/telas/marketplace.ts";

/** Emenda ADR-057 (2026-11-18): o catálogo público passa a trazer os apps de chave de API, marcados. */

const toolkits = (items: unknown[]): typeof fetch => async () => Response.json({ items });

it("o catálogo público traz o app só de chave marcado; o de login gerenciado segue sem marca, mesmo aceitando chave", async () => {
  const c = criarClienteComposio("fake", toolkits([
    { slug: "fireflies", name: "Fireflies", composio_managed_auth_schemes: [], auth_schemes: ["API_KEY"] },
    { slug: "pipedrive", name: "Pipedrive", composio_managed_auth_schemes: ["OAUTH2"], auth_schemes: ["OAUTH2", "API_KEY"] },
    { slug: "so_oauth", name: "Só OAuth próprio", composio_managed_auth_schemes: [], auth_schemes: ["OAUTH2"] },
    { slug: "dcr", name: "DCR", composio_managed_auth_schemes: [], auth_schemes: ["DCR_OAUTH"] },
    { slug: "sem_login", name: "Sem login", composio_managed_auth_schemes: [], auth_schemes: ["API_KEY"], no_auth: true },
  ]));
  const apps = await c.gerenciados();
  expect(apps.map((a) => [a.slug, a.conexao ?? "conta"])).toEqual([["fireflies", "chave"], ["pipedrive", "conta"]]);
});

it("com auth config no painel o app usa o login do projeto: a marca de chave não passa", () => {
  const publico = [{ slug: "fireflies", nome: "Fireflies", logo: null, descricao: "", categorias: [], conexao: "chave" as const }, { slug: "clockify", nome: "Clockify", logo: null, descricao: "", categorias: [], conexao: "chave" as const }];
  const apps = mesclarCatalogo([{ slug: "clockify", nome: "Clockify", logo: null }], publico);
  expect(apps.find((a) => a.slug === "clockify")?.conexao).toBeUndefined();
  expect(apps.find((a) => a.slug === "fireflies")?.conexao).toBe("chave");
});

it("os campos vêm do esquema API_KEY: o invisível sai, o nome fora do formato sai, sem obrigatório é nao_encontrado", async () => {
  const detalhe = (campos: unknown[]): typeof fetch => async () => Response.json({ auth_config_details: [{ mode: "OAUTH2", fields: {} }, { mode: "API_KEY", fields: { connected_account_initiation: { required: campos, optional: [] } } }] });
  const c = criarClienteComposio("fake", detalhe([
    { name: "generic_api_key", displayName: "API Key", description: " Settings → API ", required: true, is_secret: true, user_visible: true },
    { name: "oculto", displayName: "Oculto", required: true, user_visible: false },
    { name: "Nome Ruim", displayName: "x", required: true },
  ]));
  expect((await c.esquemaDaChave("fireflies")).campos).toEqual([{ nome: "generic_api_key", rotulo: "API Key", descricao: "Settings → API", segredo: true, obrigatorio: true }]);
  await expect(criarClienteComposio("fake", detalhe([])).esquemaDaChave("x")).rejects.toMatchObject({ codigo: "nao_encontrado" });
  await expect(criarClienteComposio("fake", async () => Response.json({ auth_config_details: [{ mode: "OAUTH2" }] })).esquemaDaChave("x")).rejects.toMatchObject({ codigo: "nao_encontrado" });
});

it("o estado guarda o catálogo inteiro (o modal conecta os dois jeitos); a grade antiga, que só abre login, esconde os de chave", () => {
  const app = (slug: string, conexao?: "chave"): AppComLogo => ({ slug, nome: slug, descricao: "", categoria: "", logo: null, ...(conexao ? { conexao } : {}) });
  const e = reduzir(estadoInicial, { tipo: "hidratar-conectores", conectores: [], marketplace: [app("slack"), app("fireflies", "chave")], composioConfigurado: true });
  expect(e.marketplace.map((a) => a.slug)).toEqual(["slack", "fireflies"]);
  expect(appsDeLogin(e.marketplace).map((a) => a.slug)).toEqual(["slack"]);
});

it("confere a chave pelo endpoint de usuário atual: 401/403 ou erro de autenticação no corpo = recusada", async () => {
  const pedidos: unknown[] = [];
  const proxy = (resposta: unknown): typeof fetch => async (_u, init) => { pedidos.push(JSON.parse(String(init?.body))); return Response.json(resposta); };
  const conf = { endpoint: "https://{{subdomain}}.freshdesk.com/api/v2/agents/me", metodo: "GET" as const };
  const valores = { subdomain: "acme", generic_api_key: "k" };
  expect(await criarClienteComposio("x", proxy({ status: 200, data: { id: 1 } })).conferirChave("ca_1", conf, valores)).toBe("valida");
  expect(pedidos[0]).toEqual({ endpoint: "https://acme.freshdesk.com/api/v2/agents/me", method: "GET", connected_account_id: "ca_1", parameters: [{ type: "header", name: "apollo-require-preflight", value: "true" }] });
  expect(await criarClienteComposio("x", proxy({ status: 401, data: {} })).conferirChave("ca_1", conf, valores)).toBe("recusada");
  // O Fireflies responde 500 com auth_failed para chave errada (teste real de 18/11/2026).
  expect(await criarClienteComposio("x", proxy({ status: 500, data: { errors: [{ code: "auth_failed" }] } })).conferirChave("ca_1", conf, valores)).toBe("recusada");
  expect(await criarClienteComposio("x", proxy({ status: 503, data: { errors: [{ code: "unavailable" }] } })).conferirChave("ca_1", conf, valores)).toBe("inconclusiva");
  expect(await criarClienteComposio("x", proxy({ status: 200 })).conferirChave("ca_1", null, valores)).toBe("inconclusiva");
  expect(await criarClienteComposio("x", proxy({ status: 200 })).conferirChave("ca_1", conf, { generic_api_key: "k" })).toBe("inconclusiva");
});

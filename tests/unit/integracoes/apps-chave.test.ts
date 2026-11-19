import { expect, it } from "vitest";
import { criarClienteComposio } from "../../../src/adapters/integracoes/composio.ts";
import { mesclarCatalogo } from "../../../src/domain/catalogo-marketplace.ts";
import { reduzir, estadoInicial } from "../../../web/estado/reducer.ts";
import type { AppComLogo } from "../../../src/contracts/marketplace.ts";

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
  expect(await c.camposDaChave("fireflies")).toEqual([{ nome: "generic_api_key", rotulo: "API Key", descricao: "Settings → API", segredo: true, obrigatorio: true }]);
  await expect(criarClienteComposio("fake", detalhe([])).camposDaChave("x")).rejects.toMatchObject({ codigo: "nao_encontrado" });
  await expect(criarClienteComposio("fake", async () => Response.json({ auth_config_details: [{ mode: "OAUTH2" }] })).camposDaChave("x")).rejects.toMatchObject({ codigo: "nao_encontrado" });
});

it("a tela antiga não mostra app de chave: ela só sabe abrir login", () => {
  const app = (slug: string, conexao?: "chave"): AppComLogo => ({ slug, nome: slug, descricao: "", categoria: "", logo: null, ...(conexao ? { conexao } : {}) });
  const e = reduzir(estadoInicial, { tipo: "hidratar-conectores", conectores: [], marketplace: [app("slack"), app("fireflies", "chave")], composioConfigurado: true });
  expect(e.marketplace.map((a) => a.slug)).toEqual(["slack"]);
});

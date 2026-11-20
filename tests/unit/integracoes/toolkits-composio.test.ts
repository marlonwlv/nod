import { expect, it } from "vitest";
import { criarClienteComposio } from "../../../src/adapters/integracoes/composio.ts";
import { slugDoToolkit, toolkitComposio } from "../../../src/adapters/integracoes/toolkits-composio.ts";
import { catalogoDoPiso, mesclarCatalogo } from "../../../src/domain/catalogo-marketplace.ts";

const ALIASES = [
  ["microsoft-teams", "microsoft_teams"], ["one-drive", "one_drive"],
  ["share-point", "share_point"], ["granola-mcp", "granola_mcp"],
  ["read-ai-mcp", "read_ai_mcp"], ["otter-ai-mcp", "otter_ai_mcp"],
  ["outlook", "outlook"], ["fathom", "fathom"], ["fireflies", "fireflies"],
];

it.each(ALIASES)("%s mantém o toolkit exato em sessão, login, conta e fixação", async (slug, remoto) => {
  let dono = "nod:tenant:pessoa";
  let toolkit = remoto;
  const f: typeof fetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.endsWith("/session")) {
      expect(body.toolkits).toEqual({ enable: [remoto] });
      expect(body.user_id).toBe(dono);
      expect(body.manage_connections).toEqual({ enable: false });
      return Response.json({ session_id: "trs_test", mcp: { url: "https://backend.composio.dev/mcp" } });
    }
    if (u.endsWith("/link")) {
      expect(body).toEqual({ toolkit: remoto });
      return Response.json({ redirect_url: "https://connect.composio.dev/login", connected_account_id: "ca_test" });
    }
    if (init?.method === "PATCH") {
      expect(body).toEqual({ connected_accounts: { [remoto!]: ["ca_test"] } });
      return Response.json({ tool_router_tools: ["COMPOSIO_SEARCH_TOOLS", "EXAMPLE_GET"] });
    }
    return Response.json({ status: "ACTIVE", user_id: dono, toolkit: { slug: toolkit } });
  };
  const c = criarClienteComposio("fake", f);
  await c.criarSessao(dono, slug!);
  await c.autorizar("trs_test", slug!);
  expect(await c.conectado("ca_test", dono, slug!)).toBe(true);
  expect(await c.fixarConta("trs_test", slug!, "ca_test")).toEqual({ ferramentas: 1, avisos: [] });
  dono = "nod:outro:outra";
  expect(await c.conectado("ca_test", "nod:tenant:pessoa", slug!)).toBe(false);
  dono = "nod:tenant:pessoa";
  toolkit = "outro_toolkit";
  expect(await c.conectado("ca_test", dono, slug!)).toBe(false);
});

it("descobre aliases sem transformar slugs desconhecidos nem inventar disponibilidade", async () => {
  const f: typeof fetch = async (url) => Response.json({ items: String(url).includes("auth_configs")
    ? ["granola_mcp", "fireflies", "read_ai_mcp", "otter_ai_mcp"].map((slug) => ({ toolkit: { slug, name: slug } }))
    : [
      ...["outlook", "microsoft_teams", "one_drive", "share_point", "fathom"].map((slug) => ({ slug, name: slug, composio_managed_auth_schemes: ["OAUTH2"] })),
      { slug: "granola_mcp", composio_managed_auth_schemes: [] },
      { slug: "fireflies", composio_managed_auth_schemes: [] },
    ] });
  const c = criarClienteComposio("fake", f);
  const gerenciados = await c.gerenciados();
  const apps = mesclarCatalogo(await c.catalogo(), gerenciados);
  for (const [slug, remoto] of ALIASES) {
    expect(apps.filter((a) => a.slug === slug)).toHaveLength(1);
    expect(toolkitComposio(slug!)).toBe(remoto);
    expect(slugDoToolkit(remoto!)).toBe(slug);
    expect(catalogoDoPiso().some((a) => a.slug === slug)).toBe(false);
  }
  expect(mesclarCatalogo([], gerenciados).some((a) => a.slug === "granola-mcp")).toBe(false);
  expect(mesclarCatalogo([], gerenciados).some((a) => a.slug === "fireflies")).toBe(false);
  expect(toolkitComposio("google-search-console")).toBe("google_search_console");
  expect(slugDoToolkit("google_search_console")).toBe("google-search-console");
});

it("libera qualquer toolkit gerenciado com sublinhado, sem curadoria, e o conecta pelo slug exato", async () => {
  const pedidos: unknown[] = [];
  const f: typeof fetch = async (url, init) => {
    if (init?.body) pedidos.push(JSON.parse(String(init.body)));
    if (String(url).includes("/toolkits")) return Response.json({ items: [
      { slug: "google_maps", name: "Google Maps", composio_managed_auth_schemes: ["OAUTH2"], meta: { description: "Maps", categories: [] } },
      { slug: "zoho_books", name: "Zoho Books", composio_managed_auth_schemes: ["OAUTH2"] },
      { slug: "sem_login", name: "Sem login", composio_managed_auth_schemes: [] },
    ] });
    if (String(url).endsWith("/session")) return Response.json({ session_id: "trs_test", mcp: { url: "https://backend.composio.dev/mcp" } });
    return Response.json({ redirect_url: "https://connect.composio.dev/login", connected_account_id: "ca_test" });
  };
  const c = criarClienteComposio("fake", f);
  const apps = mesclarCatalogo([], await c.gerenciados());
  expect(apps.filter((a) => a.doCatalogo).map((a) => a.slug)).toEqual(["google-maps", "zoho-books"]);
  await c.criarSessao("nod:tenant:pessoa", "zoho-books");
  await c.autorizar("trs_test", "zoho-books");
  expect(pedidos).toEqual([expect.objectContaining({ toolkits: { enable: ["zoho_books"] } }), { toolkit: "zoho_books" }]);
});

it("recusa colisão com alias reservado no catálogo remoto e mantém falha OAuth fechada", async () => {
  const f: typeof fetch = async () => Response.json({ items: [
    { slug: "one-drive", name: "colisao", toolkit: { slug: "one-drive", name: "colisao" }, composio_managed_auth_schemes: ["OAUTH2"] },
    { slug: "one_drive", name: "oficial", toolkit: { slug: "one_drive", name: "oficial" }, composio_managed_auth_schemes: ["OAUTH2"] },
  ] });
  const c = criarClienteComposio("fake", f);
  expect(await c.catalogo()).toEqual([{ slug: "one-drive", nome: "oficial", logo: null }]);
  expect(await c.gerenciados()).toEqual([{ slug: "one-drive", nome: "oficial", logo: null, descricao: "", categorias: [] }]);
  const recusado = criarClienteComposio("fake", async () => Response.json({ error: "admin approval required" }, { status: 403 }));
  await expect(recusado.autorizar("trs_test", "microsoft-teams")).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
});

import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { comporApp } from "../../src/adapters/http/compor.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { catalogoComposio, mcpComposioFalso } from "../helpers/composio-mcp-falso.ts";

describeIntegracao("instalação limpa: composição, HTTP, Postgres/RLS e MCP", () => {
  it("conecta e reconecta duas pessoas e outro tenant com a chave somente no backend", async () => {
    const tenant = randomUUID();
    const escopos = [tenant, tenant, randomUUID()].map((tenantId) => ({ tenantId, pessoaId: randomUUID() }));
    for (const e of escopos) {
      await dbDono`insert into tenants (id, nome) values (${e.tenantId}, 'Teste apps') on conflict do nothing`;
      await dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${e.tenantId}, ${e.pessoaId}, 'Pessoa teste', 'PT')`;
    }
    const segredo = "credencial-ficticia-hospedada";
    const fetchReal = globalThis.fetch;
    const contas = new Map<string, string>();
    let sequencia = 0;
    const mcp = mcpComposioFalso({ ferramentas: catalogoComposio("SLACK", 1) });
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("http://127.0.0.1:")) return fetchReal(url, init);
      expect(new Headers(init?.headers).get("x-api-key")).toBe(segredo);
      if (u.startsWith("https://app.composio.dev/")) return mcp(u, init);
      expect(u).toMatch(/^https:\/\/backend\.composio\.dev\//);
      if (u.endsWith("/session")) {
        sequencia++;
        const body = JSON.parse(String(init?.body)) as { user_id: string };
        contas.set(`ca_${sequencia}`, body.user_id);
        return Response.json({ session_id: `trs_${sequencia}`, mcp: { url: `https://app.composio.dev/tool_router/v3/trs_${sequencia}/mcp` } });
      }
      if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/teste", connected_account_id: `ca_${sequencia}` });
      if (u.includes("/connected_accounts/")) return Response.json({ status: "ACTIVE", user_id: contas.get(u.split("/").at(-1)!), toolkit: { slug: "slack" } });
      if (init?.method === "PATCH") return Response.json({});
      return Response.json({ items: [] });
    });
    const app = comporApp({ db, env: { NOD_MODO: "compartilhado", NOD_EXECUTOR: "catcher", NOD_APPS_HOSPEDADOS: "1", NOD_COMPOSIO_API_KEY: segredo, NOD_CREDENTIAL_KEY: "cifra-ficticia" }, listarPessoas: async () => [] });
    const srv = await servidorDeTeste(app.rotas);
    const ids: string[] = [];
    try {
      for (const e of escopos) {
        const sessao = { ...e, cookie: `nod_sessao=${cunharCookie(e, "segredo-de-teste")}` };
        const conectar = async () => {
          const r = await srv.chamar(sessao, "POST", "marketplace/slack/conectar");
          expect(r.status).toBe(200);
          return await r.json() as { conectorId: string };
        };
        const primeiro = await conectar(); ids.push(primeiro.conectorId);
        expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
        expect((await conectar()).conectorId).toBe(primeiro.conectorId);
        expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
        const lista = await (await srv.chamar(sessao, "GET", "conectores")).text();
        expect(lista).not.toContain(segredo);
        expect(JSON.parse(lista)).toMatchObject({ appsHospedados: true, composioConfigurado: true, conectores: [{ id: primeiro.conectorId }] });
        await abrirTxEscopada(db, e)(async (tx) => {
          expect(await tx`select id from composio_configuracoes`).toHaveLength(0);
          expect(await tx`select id from concessoes`).toHaveLength(0);
        });
      }
      expect(new Set(ids).size).toBe(3);
      for (const e of escopos) await app.dentro(e, async (d) => {
        expect((await d.repos.conectores.listar()).map((c) => c.id)).toEqual([ids[escopos.indexOf(e)]]);
        for (const id of ids.filter((i) => i !== ids[escopos.indexOf(e)])) expect(await d.repos.conectores.buscar(id)).toBeNull();
      });
    } finally {
      await srv.close();
      await app.fechar();
      vi.unstubAllGlobals();
      for (const e of escopos) await abrirTxEscopada(db, e)(async (tx) => {
        await tx`delete from composio_sessoes`;
        await tx`delete from conectores`;
      });
    }
  }, 60_000);
});

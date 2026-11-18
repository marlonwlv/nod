import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { comAppsHospedados } from "../../src/adapters/http/apps-hospedados.ts";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";

async function montar(configurado = true) {
  const segredo = "credencial-ficticia-do-provedor";
  const chave = chaveDe("cifra-apenas-do-teste");
  const cifra = (s: string) => cifrar(s, chave);
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => ({ ok: true, ferramentas: [{ nome: "SLACK_READ", descricao: "", readOnlyHint: true, schema: {} }] }) }) });
  const dentro: typeof memoria.dentro = (e, fn) => memoria.dentro(e, (d) => {
    // O fake genérico só filtra tenant; aqui emula RLS privado. A prova de RLS real está em composio-rls.
    const visiveis = () => memoria.banco.conectores.filter((c) => c.tenantId === e.tenantId && c.ownerId === e.pessoaId);
    const deps = { ...d, repos: { ...d.repos, conectores: { ...d.repos.conectores,
      buscarPorSlug: async (slug: string) => visiveis().find((c) => c.slug === slug) ?? null,
      listar: async () => visiveis(),
    } } };
    return fn(comAppsHospedados(deps, configurado ? cifra(segredo) : null));
  });
  const contas = new Map<string, string>();
  let contaErrada = false;
  let falha = false;
  let sequencia = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    expect(new Headers(init?.headers).get("x-api-key")).toBe(segredo);
    const u = String(url);
    if (falha) return new Response("não revelar corpo do provedor", { status: 401 });
    if (u.endsWith("/session")) {
      const body = JSON.parse(String(init?.body)) as { user_id: string };
      const id = String(++sequencia);
      contas.set(`ca_${id}`, body.user_id);
      return Response.json({ session_id: `trs_${id}`, mcp: { url: `https://app.composio.dev/tool_router/v3/trs_${id}/mcp` } });
    }
    if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/teste", connected_account_id: `ca_${sequencia}` });
    if (u.includes("/connected_accounts/")) return Response.json({ status: "ACTIVE", user_id: contaErrada ? "outro" : contas.get(u.split("/").at(-1)!), toolkit: { slug: "slack" } });
    if (init?.method === "PATCH") return Response.json({});
    return Response.json({ items: [] });
  };
  const op = { dentro, appsHospedados: true, cifrar: cifra, decifrar: (s: string) => decifrar(s, chave), fetchImpl };
  const srv = await servidorDeTeste([...rotasMarketplace(op), ...rotasConectores(op)]);
  const tenantId = randomUUID();
  const pessoa = (tenant = tenantId) => {
    const escopo = { tenantId: tenant, pessoaId: randomUUID() };
    return { ...escopo, cookie: `nod_sessao=${cunharCookie(escopo, "segredo-de-teste")}` };
  };
  return { srv, memoria, pessoa, segredo, contas, errarConta: () => { contaErrada = true; }, falhar: () => { falha = true; } };
}

it("instalação limpa usa backend, isola OAuth por pessoa/tenant e reconecta sem chave local", async () => {
  const m = await montar();
  try {
    const a = m.pessoa(); const b = m.pessoa(); const c = m.pessoa(randomUUID());
    expect(m.memoria.banco.composioChaves.size).toBe(0);
    expect((await m.srv.chamar({ ...a, cookie: "" }, "POST", "marketplace/slack/conectar")).status).toBe(401);
    const ids: string[] = [];
    for (const p of [a, b, c]) {
      const inicio = await m.srv.chamar(p, "POST", "marketplace/slack/conectar");
      expect(inicio.status).toBe(200);
      const corpo = await inicio.json() as { url: string; conectorId: string };
      expect(corpo.url).toContain("/link/"); ids.push(corpo.conectorId);
      expect(m.contas.get(`ca_${ids.length}`)).toBe(`nod:${p.tenantId}:${p.pessoaId}`);
      expect(await (await m.srv.chamar(p, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
      const lista = await (await m.srv.chamar(p, "GET", "conectores")).text();
      expect(lista).not.toContain(m.segredo);
      expect(lista).not.toContain("envCifrado");
      expect(JSON.parse(lista)).toMatchObject({ appsHospedados: true, composioConfigurado: true });
    }
    expect(new Set(ids).size).toBe(3);
    const nova = await (await m.srv.chamar(a, "POST", "marketplace/slack/conectar")).json() as { conectorId: string };
    expect(nova.conectorId).toBe(ids[0]);
    expect(await (await m.srv.chamar(a, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    m.errarConta();
    expect(await (await m.srv.chamar(a, "POST", "marketplace/slack/verificar")).json()).toEqual({ conectado: false });
    expect(m.memoria.banco.composioChaves.size).toBe(0);
    expect(m.memoria.banco.concessoes).toHaveLength(0);
    expect((await m.srv.chamar(a, "POST", "marketplace/configurar", { chave: "troca" })).status).toBe(403);
  } finally { await m.srv.close(); }
});

it("infraestrutura ausente e falha do provedor não viram app desconectado nem pedido de chave", async () => {
  const m = await montar(false);
  try {
    const p = m.pessoa();
    expect(await (await m.srv.chamar(p, "GET", "conectores")).json()).toMatchObject({ appsHospedados: true, composioConfigurado: false });
    expect((await m.srv.chamar(p, "POST", "marketplace/slack/conectar")).status).toBe(502);
    expect(m.contas.size).toBe(0);
    expect((await m.srv.chamar(p, "POST", "marketplace/slack/verificar")).status).toBe(502);
    for (let i = 0; i < 28; i++) await m.srv.chamar(p, "POST", "marketplace/slack/conectar");
    expect((await m.srv.chamar(p, "POST", "marketplace/slack/conectar")).status).toBe(429);
  } finally { await m.srv.close(); }
  const n = await montar();
  try {
    const p = n.pessoa();
    await n.srv.chamar(p, "POST", "marketplace/slack/conectar");
    n.falhar();
    const resposta = await n.srv.chamar(p, "POST", "marketplace/slack/verificar");
    expect(resposta.status).toBe(502);
    expect(await resposta.text()).not.toContain("não revelar corpo do provedor");
  } finally { await n.srv.close(); }
});

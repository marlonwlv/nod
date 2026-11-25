// Sonda da ADR-196 (2026-11-24): duas contas do mesmo toolkit para o mesmo user_id no Composio (v3.1).
// Uso: node scripts/sondas/composio-multiconta.mjs <arquivo-com-a-chave> [toolkit]
// Usa um user_id descartável, não abre login, não imprime a chave nem as URLs de login inteiras e apaga no fim as
// contas que criou. Os resultados de referência estão na seção "Medido" da ADR-196.
import { readFileSync } from "node:fs";

// Sem console (regra do eslint): a saída vai pelo stdout.
const dizer = (...partes) => process.stdout.write(partes.join(" ") + "\n");

const chave = readFileSync(process.argv[2], "utf8").trim();
const toolkit = process.argv[3] ?? "gmail";
const BASE = "https://backend.composio.dev/api/v3.1";
const userId = `nod-sonda-multiconta-${Date.now()}`;
const criadas = new Set();

async function api(metodo, path, body) {
  const r = await globalThis.fetch(BASE + path, {
    method: metodo,
    headers: { "x-api-key": chave, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let corpo = null;
  try { corpo = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, corpo };
}
const resumoErro = (c) => JSON.stringify(c?.error ?? c ?? null).slice(0, 400);
const host = (u) => { try { return new globalThis.URL(u).host; } catch { return null; } };

const BASE_SESSAO = {
  user_id: userId, toolkits: { enable: [toolkit] }, preload: { tools: "all" },
  manage_connections: { enable: false }, workbench: { enable: false, enable_proxy_execution: false },
  search: { enable: false }, execute: { enable_multi_execute: false },
};

async function sessao(rotulo, extra = {}) {
  const r = await api("POST", "/tool_router/session", { ...BASE_SESSAO, ...extra });
  dizer(`\n## ${rotulo}: POST /tool_router/session → ${r.status}`);
  if (r.status >= 300) { dizer("  erro:", resumoErro(r.corpo)); return null; }
  dizer("  session_id:", r.corpo.session_id, "| config.multi_account:", JSON.stringify(r.corpo.config?.multi_account ?? null));
  const ferramentas = r.corpo.tool_router_tools ?? r.corpo.tools;
  if (Array.isArray(ferramentas)) dizer("  ferramentas na criação:", ferramentas.length);
  return r.corpo.session_id;
}

async function link(sid, rotulo, extra = {}) {
  const r = await api("POST", `/tool_router/session/${sid}/link`, { toolkit, ...extra });
  const ca = r.corpo?.connected_account_id ?? null;
  if (ca) criadas.add(ca);
  dizer(`  link ${rotulo} → ${r.status} | connected_account_id: ${ca} | redirect host: ${host(r.corpo?.redirect_url)}${r.status >= 300 ? " | erro: " + resumoErro(r.corpo) : ""}`);
  return ca;
}

async function listarContas(rotulo) {
  const r = await api("GET", `/connected_accounts?user_ids=${encodeURIComponent(userId)}&toolkit_slugs=${toolkit}&limit=50`);
  const itens = Array.isArray(r.corpo?.items) ? r.corpo.items : [];
  for (const i of itens) criadas.add(i.id);
  dizer(`\n## contas do user_id (${rotulo}) → ${r.status}: ${itens.length}`);
  for (const i of itens) dizer(`  ${i.id} status=${i.status} alias=${JSON.stringify(i.alias ?? null)} auth_config=${i.auth_config?.id ?? "?"}`);
  return itens;
}

dizer("toolkit:", toolkit, "| user_id de teste:", userId);

// 1. Sessão de hoje (como o nod cria), dois links seguidos.
const s1 = await sessao("1. sessão como a do nod (sem multi_account)");
if (s1) {
  const a = await link(s1, "1º");
  const b = await link(s1, "2º");
  dizer("  mesma conta nos dois links?", a === b);
}
// 1b. Sessão NOVA (o nod cria uma por conexão), terceiro link.
const s1b = await sessao("1b. outra sessão sem multi_account, mesmo user_id");
if (s1b) await link(s1b, "3º (sessão nova)");
await listarContas("depois do passo 1");

// 2. Alias no link de sessão sem multi_account (o jeito da ADR-196), e o alias repetido.
const s2 = await sessao("2. sessão sem multi_account, link com alias");
if (s2) {
  await link(s2, "alias=pessoal", { alias: "pessoal" });
  await link(s2, "alias=pessoal repetido (deve recusar)", { alias: "pessoal" });
}
// 2b. Sessão com multi_account: com preload (deve recusar) e sem preload.
const MULTI = { multi_account: { enable: true, max_accounts_per_toolkit: 5, require_explicit_selection: true } };
await sessao("2b. sessão com multi_account e preload (deve recusar)", MULTI);
await sessao("2c. sessão com multi_account, sem preload", { ...MULTI, preload: undefined });
const contas = await listarContas("depois do passo 2");

// 3. Sessão presa a uma conta ainda não autorizada (INITIATED), como fixarConta faz.
if (contas[0]) {
  await sessao("3. sessão presa a 1 conta (connected_accounts na criação)", { connected_accounts: { [toolkit]: [contas[0].id] } });
  if (contas[1]) await sessao("3b. sessão sem multi_account presa a 2 contas (deve recusar)", { connected_accounts: { [toolkit]: [contas[0].id, contas[1].id] } });
}

// 4. Rótulo depois: PATCH alias.
if (contas[0]) {
  const r = await api("PATCH", `/connected_accounts/${contas[0].id}`, { alias: "renomeada" });
  dizer(`\n## 4. PATCH alias → ${r.status}${r.status >= 300 ? " | erro: " + resumoErro(r.corpo) : ""}`);
}

// Limpeza.
dizer("\n## limpeza");
for (const id of criadas) {
  const r = await api("DELETE", `/connected_accounts/${id}`);
  dizer(`  DELETE ${id} → ${r.status}`);
}

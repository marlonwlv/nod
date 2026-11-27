// XUM-11: servidor MCP falso do eval (avaliar.ts). Lista as ferramentas do plano como o proxy (ferramentasMcp) e responde
// apps_buscar e apps_usar com o MESMO domínio do servidor (itensDaBusca, respostaDaBusca, decidirAppsUsar); o resto
// devolve dados fictícios. Cada chamada vai para o log (nome, argumentos, a capacidade resolvida e se deu erro).
// Uso: tsx mcp-falso.ts <plano.json> <log.jsonl> [<entidades do pedido em JSON>]
import { appendFileSync, readFileSync } from "node:fs";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { ferramentasMcp } from "../../src/adapters/mcp-proxy/catalogo.ts";
import { decidirAppsUsar, ferramentasDeAppDoPlano, itensDaBusca, respostaDaBusca } from "../../src/domain/catalogo-de-apps.ts";
import { errosDoSchema } from "../../src/domain/schema-args.ts";
import { semPrefixoDoApp } from "../../src/use-cases/pedir-aprovacao.ts";

const [arquivoPlano, log] = process.argv.slice(2) as [string, string];
const plano = JSON.parse(readFileSync(arquivoPlano, "utf8")) as PlanoTurno;
const tools = ferramentasMcp(plano);

/**
 * Dados fictícios plausíveis, num mundo em que as coisas que o pedido cita existem (o id do e-mail, a pasta, o calendário,
 * a página): leitura de um item devolve esse item; listagem traz esses itens primeiro; escrita devolve um id novo.
 */
const entidades: string[] = JSON.parse(process.argv[4] ?? "[]") as string[];
function dadosFicticios(cap: string): string {
  const item = (id: string) => ({ id, name: id, title: id, summary: id, subject: "Reunião de terça", from: "ana@empresa.com", receivedDateTime: "2026-11-27T10:00:00Z", parent: { type: "page_id", page_id: "pai-123" } });
  if (/(^|_)(GET|RETRIEVE)(_|$)/.test(cap) && !/(^|_)(LIST|SEARCH|QUERY|FIND)(_|$)/.test(cap)) return JSON.stringify({ successful: true, data: item(entidades[0] ?? "AAMk-1"), nota: "dados fictícios do teste" });
  if (/(^|_)(LIST|SEARCH|FETCH|QUERY|FIND|READ|GET)(_|$)/.test(cap)) {
    return JSON.stringify({ successful: true, data: { value: [...entidades.map(item), { id: "AAMk-1", subject: "Fatura ACME novembro", from: "financeiro@acme.com", name: "Fornecedores" }, { id: "AAMk-2", subject: "Proposta comercial", from: "vendas@beta.com", name: "Promoções" }] }, nota: "dados fictícios do teste" });
  }
  return JSON.stringify({ successful: true, data: { id: "novo-1", status: "ok" }, nota: "dados fictícios do teste" });
}

const registrar = (l: Record<string, unknown>) => appendFileSync(log, `${JSON.stringify(l)}\n`);
const texto = (t: string, erro = false) => ({ content: [{ type: "text", text: t }], ...(erro ? { isError: true } : {}) });

function chamar(nome: string, args: Record<string, unknown>) {
  const ferramenta = plano.catalogo.ferramentas.find((f) => f.nome === nome);
  if (!ferramenta) { registrar({ nome, args, erro: "fora_do_catalogo" }); return texto("negado (terminal): fora do catálogo", true); }
  if (nome === "apps_buscar") {
    const r = respostaDaBusca({ busca: String(args.busca ?? ""), app: typeof args.app === "string" ? args.app : null, itens: itensDaBusca(plano, []) });
    registrar({ nome, args, resultados: r.resultados.map((x) => x.ferramenta) });
    return texto(JSON.stringify(r));
  }
  if (nome === "apps_usar") {
    const d = decidirAppsUsar({ plano, conectores: [], pedida: String(args.ferramenta ?? ""), argumentos: args.argumentos });
    if ("chamar" in d) {
      registrar({ nome, args, alvo: d.chamar.nome });
      return texto(dadosFicticios(d.chamar.nome.slice(d.chamar.nome.indexOf("__") + 2)));
    }
    registrar({ nome, args, erro: String(d.resposta.erro) });
    return texto(JSON.stringify(d.resposta), true);
  }
  if (nome === "pedir_aprovacao") {
    // O lote de aprovação também chama capacidades de app: cada item conta como chamada (com a mesma normalização do servidor).
    const itens = Array.isArray(args.itens) ? args.itens as { destino?: { conector?: string; ferramenta?: string; argumentos?: unknown } }[] : [];
    const todas = ferramentasDeAppDoPlano(plano);
    const resolvidos = itens.map((i) => {
      const conector = String(i.destino?.conector ?? "");
      const cap = semPrefixoDoApp(conector, String(i.destino?.ferramenta ?? ""));
      const f = todas.find((x) => x.nome === `${conector}__${cap}`);
      const erros = f ? errosDoSchema(f.schema, i.destino?.argumentos ?? {}) : ["fora do catálogo"];
      return { alvo: `${conector}__${cap}`, args: i.destino?.argumentos ?? {}, ...(erros.length ? { erro: f ? "args_invalidos" : "fora_do_catalogo" } : {}) };
    });
    registrar({ nome, args, itens: resolvidos });
    const falhou = resolvidos.find((r) => r.erro);
    return falhou ? texto(JSON.stringify({ estado: "recusada", erros: [`${falhou.alvo}: ${falhou.erro}`] }), true) : texto(JSON.stringify({ estado: "decidida", itens: resolvidos.map((_, idx) => ({ idx, desfecho: "executado" })), nota: "teste: aprovado e executado" }));
  }
  if (ferramenta.origem === "conector") {
    // O servidor confere o esquema na chamada direta (args_invalidos, transitória).
    const erros = errosDoSchema(ferramenta.schema, args);
    if (erros.length) { registrar({ nome, args, alvo: nome, erro: "args_invalidos" }); return texto(`negado (transitório): argumentos inválidos (${erros.slice(0, 3).join("; ")}). Você pode seguir por outro caminho.`, true); }
    registrar({ nome, args, alvo: nome });
    return texto(dadosFicticios(nome.slice(nome.indexOf("__") + 2)));
  }
  registrar({ nome, args });
  return texto("ok (teste: a ação foi feita; responda em uma frase o que fez)");
}

// Conferência de sanidade do plano (o eval quebra cedo se o plano não tiver o que promete).
if (plano.catalogo.sobDemanda && !ferramentasDeAppDoPlano(plano).length) throw new Error("plano sem ferramentas de app");

process.on("uncaughtException", (e) => registrar({ nome: "(processo)", erro: "excecao_do_teste", detalhe: String(e?.stack ?? e) }));
let buf = "";
const resp = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    let m: { id?: unknown; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } };
    try { m = JSON.parse(l); } catch { continue; }
    if (m.method === "initialize") resp(m.id, { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nod", version: "1" } });
    else if (m.method === "tools/list") resp(m.id, { tools });
    else if (m.method === "tools/call") {
      try { resp(m.id, chamar(String(m.params?.name ?? ""), (m.params?.arguments ?? {}) as Record<string, unknown>)); }
      catch (e) { registrar({ nome: String(m.params?.name ?? ""), args: m.params?.arguments, erro: "excecao_do_teste", detalhe: String(e) }); resp(m.id, texto(`erro do teste: ${String(e)}`, true)); }
    }
    else if (m.id !== undefined) resp(m.id, {});
  }
});

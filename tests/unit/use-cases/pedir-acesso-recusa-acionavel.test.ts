import { expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { pedirAcesso, pedirAcessoDoBot } from "../../../src/use-cases/pedir-acesso.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

/**
 * QA-99 (2026-11-19): no chat real, `pedir_acesso` com slug inexistente ou capacidade inventada voltava
 * "400 entrada_invalida — Algum dado do pedido não está certo", sem dizer qual. O bot não tinha como se corrigir.
 * O caminho do bot devolve agora a recusa com o campo, sem proposta, decisão nem evento.
 */
async function cenario() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const conector = await deps.repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  conector.habilitado = true;
  conector.catalogo = [{ nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true }];
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: "veja meus e-mails", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
  if (!turno) throw new Error("turno");
  const args = (conector: string, capacidades: string[]) => ({ turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, conector, capacidades, nivel: "leitura" as const, nao_pedido: [] });
  const semEfeito = () => {
    expect(banco.propostas.filter((p) => p.payload.kind === "acesso")).toHaveLength(0);
    expect(banco.decisoes.filter((d) => d.tipo === "acesso")).toHaveLength(0);
  };
  return { deps, args, semEfeito };
}

it("slug que não existe: recusa conector_desconhecido citando o slug, sem card", async () => {
  const c = await cenario();
  const r = await pedirAcessoDoBot(c.deps, c.args("qa-slug-inexistente", []));
  expect(r.data).toMatchObject({ estado: "recusado", erro: "conector_desconhecido" });
  expect("instrucao" in r.data && r.data.instrucao).toMatch(/"qa-slug-inexistente" não existe.*Nada foi pedido/);
  expect(r.events).toEqual([]);
  c.semEfeito();
});

it("capacidade fora do catálogo: recusa capacidade_desconhecida com o nome e a saída por [], sem card", async () => {
  const c = await cenario();
  const r = await pedirAcessoDoBot(c.deps, c.args("gmail", ["GMAIL_FETCH_EMAILS", "inventada_🚀"]));
  expect(r.data).toMatchObject({ estado: "recusado", erro: "capacidade_desconhecida" });
  const instrucao = "instrucao" in r.data ? r.data.instrucao : "";
  expect(instrucao).toContain('"inventada_🚀"');
  expect(instrucao).not.toContain("GMAIL_FETCH_EMAILS");
  expect(instrucao).toMatch(/capacidades \[\]/);
  c.semEfeito();
});

it("slug longo com emoji é citado inteiro até 60 caracteres sem partir o emoji; lista longa resume o excesso", async () => {
  const c = await cenario();
  const slug = `${"a".repeat(59)}🚀fim`;
  const r = await pedirAcessoDoBot(c.deps, c.args(slug, []));
  const instrucao = "instrucao" in r.data ? r.data.instrucao : "";
  expect(instrucao).toContain(`"${"a".repeat(59)}🚀…"`);
  expect(instrucao).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  const muitas = await pedirAcessoDoBot(c.deps, c.args("gmail", ["x1", "x2", "x3", "x4", "x5", "x6", "x7"]));
  expect("instrucao" in muitas.data && muitas.data.instrucao).toMatch(/"x5" e mais 2\./);
  c.semEfeito();
});

it("pedido válido segue o caminho de sempre; quem chama pedirAcesso direto ainda recebe entrada_invalida", async () => {
  const c = await cenario();
  const ok = await pedirAcessoDoBot(c.deps, c.args("gmail", []));
  expect(ok.data).toMatchObject({ estado: "aguardando_pessoa" });
  await expect(pedirAcesso(c.deps, c.args("qa-slug-inexistente", []))).rejects.toMatchObject({ codigo: "entrada_invalida" });
});

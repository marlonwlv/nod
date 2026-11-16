import { expect, it } from "vitest";
import { LINHAS_MAX_CSV } from "../../../src/domain/decisoes.ts";
import { aplicarExportacaoDecisoes, decisoesNoChat } from "../../../src/use-cases/decisoes-no-chat.ts";
import { depsFalsos } from "./deps-l5.ts";

it("NOD-414: valida os recortes mensais sem rejeitar o período longo inteiro", async () => {
  const agora = Date.parse("2026-11-13T12:00:00Z");
  const { deps, banco } = depsFalsos({ agora });
  const agente = await deps.repos.agentes.criar({ nome: "Bia CSV", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: agora + 60_000, profundidade: 0, entradaTexto: "exporte", entradaConfianca: "confiavel", modelo: "m" });

  const r = await decisoesNoChat(deps, {
    turnoId: turno?.id ?? "",
    agenteId: agente?.id ?? "",
    conversaId: conversa?.id ?? "",
    acao: "exportar",
    de: "2026-09-15",
    ate: "2026-11-13",
    fuso: "UTC",
    desfecho: "tudo",
  });

  expect(r.data).toMatchObject({ ok: true, estado: "pendente", arquivos: 3 });
  expect(banco.anexos).toHaveLength(0);
  expect(banco.propostas).toHaveLength(1);
});

// medido em 2026-11-16: 14 s nesta máquina para ordenar e exportar 50.001 linhas do repositório em memória.
it("avisa no chat quando o CSV confirmado chega ao teto e deixa decisões de fora", async () => {
  const agora = Date.parse("2026-11-13T12:00:00Z");
  const { deps, banco } = depsFalsos({ agora });
  const agente = await deps.repos.agentes.criar({ nome: "Bia CSV", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: agora + 60_000, profundidade: 0, entradaTexto: "exporte", entradaConfianca: "confiavel", modelo: "m" });
  for (let i = 0; i <= LINHAS_MAX_CSV; i += 1) {
    banco.trilha.push({ tenantId: deps.escopo.tenantId, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, ownerId: deps.escopo.pessoaId, agenteId: agente?.id ?? "", turnoId: null, conectorId: "c1", ferramenta: "github__create_issue", kind: "tool_call", motivo: null, regra: "regra:modo_automatico", regraVersao: 1, em: new Date(agora - i * 100).toISOString() });
  }

  const proposta = await decisoesNoChat(deps, { turnoId: turno?.id ?? "", agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", acao: "exportar", de: "2026-11-13", ate: "2026-11-13", fuso: "UTC", desfecho: "tudo" });
  if (!proposta.data.ok || !("decisao_id" in proposta.data)) throw new Error("proposta");
  await aplicarExportacaoDecisoes(deps, { propostaId: proposta.data.decisao_id, recusar: false });

  expect(banco.mensagens.at(-1)?.texto).toContain("1 arquivo chegou ao limite de 50.000 decisões");
  expect(banco.mensagens.at(-1)?.texto).toContain("escolha um período menor para ver o resto");
}, 60_000);

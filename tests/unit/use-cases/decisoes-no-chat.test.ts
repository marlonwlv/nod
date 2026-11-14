import { expect, it } from "vitest";
import { decisoesNoChat } from "../../../src/use-cases/decisoes-no-chat.ts";
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

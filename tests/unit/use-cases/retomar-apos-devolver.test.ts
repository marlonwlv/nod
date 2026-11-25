import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { notaDaDevolucao, retomarAposDevolverNavegador } from "../../../src/use-cases/retomar-apos-devolver.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

/** 2026-11-22 (teste do dono, IMDb): devolver o navegador assumido à mão continua o turno que esbarrou nele. */
async function preparar() {
  const { deps } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const enfileirar = (texto: string) => deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
  const turno = await enfileirar("descobre o filme mais bem avaliado de 2024 no IMDb");
  if (!turno) throw new Error("turno");
  return { deps, turno, enfileirar };
}

describe("retomar depois de devolver o navegador", () => {
  it("devolver continua o turno pela retomada, com a nota do que aconteceu", async () => {
    const { deps, turno } = await preparar();
    const r = await retomarAposDevolverNavegador(deps, { turnoId: turno.id, automatico: false });
    expect(r.data.turnoId).toBeTruthy();
    const retomada = await deps.repos.turnos.buscar(r.data.turnoId!);
    expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: turno.id });
    expect(retomada?.entradaTexto).toContain(notaDaDevolucao(false));
    expect(r.events?.map((e) => e.kind)).toEqual(["turno_criado"]);
  });

  it("a volta sozinha diz que a pessoa parou de mexer", async () => {
    const { deps, turno } = await preparar();
    const r = await retomarAposDevolverNavegador(deps, { turnoId: turno.id, automatico: true });
    expect((await deps.repos.turnos.buscar(r.data.turnoId!))?.entradaTexto).toContain("ficou alguns minutos sem mexer");
  });

  it("com mensagem nova da pessoa depois do turno, não retoma: o turno dela faz o trabalho", async () => {
    const { deps, turno, enfileirar } = await preparar();
    (deps as { agora: () => number }).agora = (() => { const t = deps.agora() + 60_000; return () => t; })();
    await enfileirar("deixa, agora vê outra coisa");
    const r = await retomarAposDevolverNavegador(deps, { turnoId: turno.id, automatico: false });
    expect(r.data.turnoId).toBeNull();
    expect(r.events ?? []).toEqual([]);
  });

  it("turno que não existe não retoma", async () => {
    const { deps } = await preparar();
    expect((await retomarAposDevolverNavegador(deps, { turnoId: "00000000-0000-4000-8000-000000000000", automatico: false })).data.turnoId).toBeNull();
  });
});

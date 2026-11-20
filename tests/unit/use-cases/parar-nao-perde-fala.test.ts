import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../../src/use-cases/enviar-mensagem.ts";
import { parar } from "../../../src/use-cases/parar.ts";
import { confirmarNaSessao, marcarLidosNaSessao } from "../../../src/use-cases/sessao-viva.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

/** ADR-185: o Parar para o trabalho do bot, não o que a pessoa disse. */
async function chatRodando() {
  const { deps } = depsEmMemoria();
  const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
  const conversaId = criado.conversa.id;
  await executar(deps, enviarMensagem, { conversaId, texto: "faça 10 tópicos", inventario: PRONTO });
  const { data: d } = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
  const vivo = d.plano?.turnoId ?? "";
  const falar = async (texto: string) => (await executar(deps, enviarMensagem, { conversaId, texto, inventario: PRONTO })).data.turno.id;
  return { deps, conversaId, vivo, falar };
}

describe("ADR-185: o Parar não perde o que a pessoa disse", () => {
  it("com o chat rodando, a fala que espera na fila fica pendente e roda depois", async () => {
    const c = await chatRodando();
    const naFila = await c.falar("na verdade, só 3");
    await executar(c.deps, parar, { conversaId: c.conversaId });
    expect((await c.deps.repos.turnos.buscar(naFila))?.estado).toBe("pendente");
    expect((await c.deps.repos.turnos.buscar(c.vivo))?.pararSolicitadoEm).not.toBeNull();
  });

  it("a fala escrita na sessão e ainda não lida volta à fila; a lida fica com o turno parado", async () => {
    const c = await chatRodando();
    const naoLida = await c.falar("resume em 3");
    const lida = await c.falar("e em português");
    await executar(c.deps, confirmarNaSessao, { turnoId: c.vivo, executor: "local", ids: [naoLida, lida], informaLeitura: true });
    expect(await c.deps.repos.turnos.buscar(naoLida)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", lidoNaSessaoEm: null });
    const { events: doLido } = await executar(c.deps, marcarLidosNaSessao, { turnoId: c.vivo, executor: "local", ids: [lida] });
    expect(doLido.map((e) => e.kind)).toEqual(["turno_lido"]);

    const { events } = await executar(c.deps, parar, { conversaId: c.conversaId });
    expect(await c.deps.repos.turnos.buscar(naoLida)).toMatchObject({ estado: "pendente", motivoInterrupcao: null, absorvidoPor: null });
    expect(await c.deps.repos.turnos.buscar(lida)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: c.vivo });
    expect(events.some((e) => e.kind === "turno_criado" && e.turnoId === naoLida && e.dados?.devolvido_pelo_parar === true)).toBe(true);
  });

  it("o app que não informa leitura (antigo, Codex) tem a fala absorvida já lida, como antes: o Parar não a devolve", async () => {
    const c = await chatRodando();
    const absorvida = await c.falar("resume em 3");
    await executar(c.deps, confirmarNaSessao, { turnoId: c.vivo, executor: "local", ids: [absorvida] });
    expect((await c.deps.repos.turnos.buscar(absorvida))?.lidoNaSessaoEm).not.toBeNull();
    await executar(c.deps, parar, { conversaId: c.conversaId });
    expect((await c.deps.repos.turnos.buscar(absorvida))?.estado).toBe("interrompido");
  });

  it("a conversa diz quais falas o turno vivo absorveu e se o bot já as leu", async () => {
    const c = await chatRodando();
    const naoLida = await c.falar("resume em 3");
    const lida = await c.falar("e em português");
    await executar(c.deps, confirmarNaSessao, { turnoId: c.vivo, executor: "local", ids: [naoLida, lida], informaLeitura: true });
    await executar(c.deps, marcarLidosNaSessao, { turnoId: c.vivo, executor: "local", ids: [lida] });
    const { data } = await executar(c.deps, lerConversa, { conversaId: c.conversaId });
    const porTurno = new Map((data.turnosNaSessao ?? []).map((t) => [t.id, t]));
    expect(porTurno.get(naoLida)).toMatchObject({ absorvidoPor: c.vivo, lidoEm: null });
    expect(porTurno.get(lida)?.lidoEm).not.toBeNull();
  });
});

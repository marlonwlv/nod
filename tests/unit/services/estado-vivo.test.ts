import { describe, expect, it } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { criarBarramento } from "../../../src/services/barramento.ts";
import { criarEstadoVivo } from "../../../src/services/estado-vivo.ts";

const PESSOA = "p0000000-0000-4000-8000-000000000001";
const BOT = "a0000000-0000-4000-8000-000000000001";

describe("serviço do estado vivo sobre o barramento", () => {
  it("o frame sai antes do agente.estado que ele causou; igual não repete", () => {
    const vivo = criarEstadoVivo(criarBarramento(), { agora: () => 7 });
    const vistos: FrameSse[] = [];
    vivo.barramento.inscrever(PESSOA, (f) => vistos.push(f));
    vivo.barramento.publicar(PESSOA, "turno.iniciado", { kind: "turno_despachado", turnoId: "t1", conversaId: "c1", agente_id: BOT });
    vivo.barramento.publicar(PESSOA, "turno.tarefas", { turnoId: "t1", agenteId: BOT, tarefas: [] });
    expect(vistos.map((f) => f.tipo)).toEqual(["turno.iniciado", "agente.estado", "turno.tarefas"]);
    expect(vistos[1]!.dados).toMatchObject({ agenteId: BOT, estado: { rodando: true, turnoId: "t1" } });
  });

  it("sinal do motor publica só o agente.estado; retrato traz os bots conhecidos", () => {
    const vivo = criarEstadoVivo(criarBarramento(), { agora: () => 9 });
    const vistos: FrameSse[] = [];
    vivo.barramento.inscrever(PESSOA, (f) => vistos.push(f));
    vivo.sinal(PESSOA, { agenteId: BOT, turnoId: "t1", conversaId: "c1" }, "compondo");
    expect(vistos.map((f) => f.tipo)).toEqual(["agente.estado"]);
    expect(vivo.retrato(PESSOA)).toEqual({ agentes: [expect.objectContaining({ agenteId: BOT, rodando: true, compondo: true })], em: 9 });
    expect(vivo.retrato("outra").agentes).toEqual([]);
    expect(vivo.estado(PESSOA, BOT)?.compondo).toBe(true);
  });
});

describe("item 5: estado vivo durável (hidratar do banco depois do reinício)", () => {
  const semente = { vivos: [{ agenteId: BOT, turnoId: "t9", conversaId: "c1" }], decisoes: [{ decisaoId: "d1", agenteId: BOT, tipo: "pergunta", desde: 3, venceEm: 99 }] };

  it("semeia uma vez: o bot volta rodando e aguardando a pergunta, com o prazo; a segunda conexão não relê o banco", async () => {
    const vivo = criarEstadoVivo(criarBarramento(), { agora: () => 10 });
    const vistos: FrameSse[] = [];
    vivo.barramento.inscrever(PESSOA, (f) => vistos.push(f));
    let leituras = 0;
    const carregar = async () => { leituras += 1; return semente; };
    await vivo.hidratar(PESSOA, carregar);
    await vivo.hidratar(PESSOA, carregar);
    expect(leituras).toBe(1);
    expect(vistos.map((f) => f.tipo)).toEqual(["agente.estado"]);
    expect(vivo.estado(PESSOA, BOT)).toMatchObject({ rodando: true, turnoId: "t9", aguardando: { motivo: "pergunta", desde: 3 }, vence_em: 99 });
  });

  it("não pisa no que a projeção já viu: turno fechado não religa", async () => {
    const vivo = criarEstadoVivo(criarBarramento(), { agora: () => 10 });
    vivo.barramento.publicar(PESSOA, "turno.iniciado", { kind: "turno_despachado", turnoId: "t9", conversaId: "c1", agente_id: BOT });
    vivo.barramento.publicar(PESSOA, "turno.encerrado", { turnoId: "t9" });
    await vivo.hidratar(PESSOA, async () => ({ vivos: semente.vivos, decisoes: [] }));
    expect(vivo.estado(PESSOA, BOT)?.rodando).toBe(false);
  });

  it("leitura que falha não marca a pessoa: a próxima conexão tenta de novo", async () => {
    const vivo = criarEstadoVivo(criarBarramento(), { agora: () => 10 });
    await expect(vivo.hidratar(PESSOA, async () => { throw new Error("banco fora"); })).rejects.toThrow("banco fora");
    await vivo.hidratar(PESSOA, async () => semente);
    expect(vivo.estado(PESSOA, BOT)?.rodando).toBe(true);
  });
});

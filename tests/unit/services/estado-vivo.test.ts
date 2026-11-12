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

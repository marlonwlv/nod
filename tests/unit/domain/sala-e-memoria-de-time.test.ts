import { describe, expect, it } from "vitest";
import { consolidar, deveConsolidar, INTERVALO_CONSOLIDACAO_MS, parecenca, proporItem, revisar } from "../../../src/domain/memoria-de-time.ts";
import { fecharVez, pedirVez, PRAZO_VEZ_DO_BOT_MS, sairDaSala, salaVazia, vencerVez } from "../../../src/domain/vez-na-sala.ts";

const bot = (id: string) => ({ id, tipo: "bot" as const });
const pessoa = (id: string) => ({ id, tipo: "pessoa" as const });

describe("turno por membro na sala (ADR-170)", () => {
  it("uma vez de cada vez; pessoa passa na frente dos bots; pedir de novo não duplica", () => {
    let e = salaVazia();
    expect(pedirVez(e, bot("a"), "p1", 0).comecou).toBe(true);
    e = pedirVez(e, bot("a"), "p1", 0).estado;
    e = pedirVez(e, bot("b"), "p2", 1).estado;
    e = pedirVez(e, pessoa("marlon"), "p3", 2).estado;
    e = pedirVez(e, bot("b"), "p4", 3).estado;
    expect(e.fila.map((f) => f.membro.id)).toEqual(["marlon", "b"]);
    const r = fecharVez(e, "p1", 10);
    expect(r.proxima?.membro.id).toBe("marlon");
    expect(fecharVez(r.estado, "p-de-outro", 11).proxima).toBeNull();
  });

  it("bot mudo perde a vez no prazo; pessoa não tem prazo", () => {
    let e = pedirVez(salaVazia(), bot("a"), "p1", 0).estado;
    e = pedirVez(e, bot("b"), "p2", 1).estado;
    expect(vencerVez(e, PRAZO_VEZ_DO_BOT_MS).vencido).toBeNull();
    const v = vencerVez(e, PRAZO_VEZ_DO_BOT_MS + 1);
    expect(v.vencido).toBe("p1");
    expect(v.proxima?.membro.id).toBe("b");
    const p = pedirVez(salaVazia(), pessoa("x"), "q", 0).estado;
    expect(vencerVez(p, 10 * PRAZO_VEZ_DO_BOT_MS).vencido).toBeNull();
  });

  it("quem sai da sala sai da fila e, se tinha a vez, ela passa", () => {
    let e = pedirVez(salaVazia(), pessoa("x"), "q1", 0).estado;
    e = pedirVez(e, bot("a"), "q2", 1).estado;
    const r = sairDaSala(e, "x", 5);
    expect(r.proxima?.membro.id).toBe("a");
    expect(sairDaSala(r.estado, "a", 6).estado.atual).toBeNull();
  });
});

describe("memória de time revisada por gente (ADR-170)", () => {
  const quem = { agenteId: "bot1", pessoaId: "p1" };
  it("a proposta entra na fila; igual ao que o time já tem vira duplicada", () => {
    const time = [{ id: "m1", texto: "O deploy de produção é às quintas" }];
    expect(proporItem({ id: "i1", tipo: "memoria", texto: "Às quintas é o deploy de produção.", ...quem, agora: 1 }, time, []).estado).toBe("duplicada");
    const nova = proporItem({ id: "i2", tipo: "skill", texto: "Para abrir PR use o template", ...quem, agora: 1 }, time, []);
    expect(nova).toMatchObject({ estado: "proposta", propostoPor: quem, revisadoPor: null });
    const ok = revisar(nova, "aprovada", "marlon", 9);
    expect(ok).toMatchObject({ estado: "aprovada", revisadoPor: "marlon", revisadoEm: 9 });
    expect(() => revisar(ok, "recusada", "marlon", 10)).toThrow(/estado_invalido/);
  });

  it("a consolidação propõe a fusão das parecidas, sem apagar nada", () => {
    const time = [
      { id: "a", texto: "O cliente Acme prefere reuniões às terças de manhã" },
      { id: "b", texto: "Cliente Acme prefere reuniões terças de manhã" },
      { id: "c", texto: "O repositório usa vitest em quatro modos" },
    ];
    expect(parecenca(time[0]!.texto, time[1]!.texto)).toBeGreaterThanOrEqual(0.8);
    let n = 0;
    const p = consolidar(time, () => `f${n++}`, 100, quem);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ estado: "proposta", origem: "consolidacao", substitui: ["a", "b"], texto: time[0]!.texto });
  });

  it("o sonho roda no máximo uma vez por dia e só com memória nova", () => {
    expect(deveConsolidar({ ultimaEm: null, memoriasNovasDesde: 0, agora: 0 })).toBe(false);
    expect(deveConsolidar({ ultimaEm: null, memoriasNovasDesde: 1, agora: 0 })).toBe(true);
    expect(deveConsolidar({ ultimaEm: 0, memoriasNovasDesde: 3, agora: INTERVALO_CONSOLIDACAO_MS - 1 })).toBe(false);
  });
});

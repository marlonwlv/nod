import { describe, expect, it } from "vitest";
import { assinaturaDaRede, vigiarRede } from "../../../src/adapters/executor/vigia-de-rede.ts";
import { cpuComFugitivos, leituraDoTurno, lerLinhasDoPs } from "../../../src/domain/memoria-mac.ts";
import { lerTraceparent, traceDoTurno, traceparentDoTurno } from "../../../src/domain/traceparent.ts";
import { anotarSinal, modoDosPrazos, novaVigia, PRAZO_OCIOSO_MS, PRAZO_PRIMEIRO_TOKEN_MS, rearmar, verificarVigia } from "../../../src/domain/vigia-do-modelo.ts";
import { criarFilaOffline, falhouPorRede, type Armazem } from "../../../web/lib/fila-offline.ts";

const TURNO = "0b0f6c1e-2f3a-4b5c-8d9e-0123456789ab";

describe("prazo de primeiro token e de ociosidade do modelo (ADR-169)", () => {
  it("150 s sem o primeiro token estoura uma vez; ferramenta rodando não conta", () => {
    const v = novaVigia(0);
    expect(verificarVigia(v, PRAZO_PRIMEIRO_TOKEN_MS)).toBeNull();
    expect(verificarVigia(v, PRAZO_PRIMEIRO_TOKEN_MS + 1)).toBe("prazo_primeiro_token");
    expect(verificarVigia(v, PRAZO_PRIMEIRO_TOKEN_MS + 999_999)).toBeNull();
    rearmar(v);
    anotarSinal(v, { tipo: "token" }, 200_000);
    anotarSinal(v, { tipo: "ferramenta_comecou", id: "t1" }, 200_001);
    // Uma ferramenta de 1 hora (build, testes) não é o modelo mudo (ADR-067).
    expect(verificarVigia(v, 200_001 + 3_600_000)).toBeNull();
    anotarSinal(v, { tipo: "ferramenta_acabou", id: "t1" }, 4_000_000);
    expect(verificarVigia(v, 4_000_000 + PRAZO_PRIMEIRO_TOKEN_MS + 1)).toBe("prazo_primeiro_token");
  });

  it("90 s calado no meio da resposta é ocioso; entre voltas não há prazo", () => {
    const v = novaVigia(0);
    anotarSinal(v, { tipo: "token" }, 10);
    expect(verificarVigia(v, 10 + PRAZO_OCIOSO_MS + 1)).toBe("modelo_ocioso");
    const w = novaVigia(0);
    anotarSinal(w, { tipo: "fim_da_volta" }, 5);
    expect(verificarVigia(w, 10 * 3_600_000)).toBeNull();
    anotarSinal(w, { tipo: "pedido" }, 100);
    expect(verificarVigia(w, 100 + PRAZO_PRIMEIRO_TOKEN_MS + 1)).toBe("prazo_primeiro_token");
  });

  it("o modo padrão é só observar", () => {
    expect(modoDosPrazos(undefined)).toBe("observar");
    expect(modoDosPrazos("encerrar")).toBe("encerrar");
    expect(modoDosPrazos("qualquer")).toBe("observar");
  });
});

describe("traceparent do motor ao servidor (ADR-169)", () => {
  it("o trace do turno é o id dele sem hífens; o header é W3C válido", () => {
    expect(traceDoTurno(TURNO)).toBe("0b0f6c1e2f3a4b5c8d9e0123456789ab");
    const tp = traceparentDoTurno(TURNO, "00f067aa0ba902b7")!;
    expect(tp).toBe("00-0b0f6c1e2f3a4b5c8d9e0123456789ab-00f067aa0ba902b7-01");
    expect(lerTraceparent(tp)).toEqual({ traceId: "0b0f6c1e2f3a4b5c8d9e0123456789ab", spanId: "00f067aa0ba902b7", amostrado: true });
  });

  it("header torto, zerado ou de outra versão é ignorado", () => {
    for (const ruim of ["", "lixo", "01-0b0f6c1e2f3a4b5c8d9e0123456789ab-00f067aa0ba902b7-01", `00-${"0".repeat(32)}-00f067aa0ba902b7-01`, `00-0b0f6c1e2f3a4b5c8d9e0123456789ab-${"0".repeat(16)}-01`, 42]) expect(lerTraceparent(ruim)).toBeNull();
    expect(traceparentDoTurno("nao-e-uuid", "00f067aa0ba902b7")).toBeNull();
  });
});

describe("CPU por bot/turno (ADR-169)", () => {
  it("o ps com %cpu (ponto ou vírgula) soma por grupo, com os fugitivos", () => {
    const linhas = lerLinhasDoPs(" 10 10 2048 12,5\n 11 10 1024 30.0\n 12 99 512 7.5\n 13 13 100\n");
    expect(linhas[0]).toEqual({ pid: 10, pgid: 10, rssKib: 2048, cpuPct: 12.5 });
    expect(linhas[3]!.cpuPct).toBeUndefined();
    const cpu = cpuComFugitivos(linhas, new Set([10]), (pid) => (pid === 12 ? 10 : undefined));
    expect(cpu.get(10)).toBe(50);
    const l = leituraDoTurno({ nivel: "verde", rssPorGrupo: new Map([[10, 4096]]), cpuPorGrupo: cpu, gruposVivos: [10], turnoId: TURNO, grupo: 10 });
    expect(l.porTurno).toEqual([{ turnoId: TURNO, mb: 4, cpuPct: 50 }]);
  });
});

describe("troca de rede renova a espera (ADR-169)", () => {
  it("a assinatura ignora o loopback e muda com o IP", async () => {
    const um = { en0: [{ address: "192.168.0.2", internal: false }], lo0: [{ address: "127.0.0.1", internal: true }] } as never;
    const dois = { en0: [{ address: "10.0.0.7", internal: false }] } as never;
    expect(assinaturaDaRede(um)).toBe("en0:192.168.0.2");
    let atual = um;
    let mudou = 0;
    const parar = vigiarRede({ aoMudar: () => { mudou++; }, intervaloMs: 5, ler: () => atual });
    atual = dois;
    await new Promise((r) => setTimeout(r, 40));
    parar();
    expect(mudou).toBe(1);
  });
});

describe("fila de envio offline da web (ADR-169)", () => {
  const memoria = (): Armazem & { dados: Map<string, string> } => {
    const dados = new Map<string, string>();
    return { dados, getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => { dados.set(k, v); }, removeItem: (k) => { dados.delete(k); } };
  };

  it("guarda por pessoa, sobrevive a recriar a fila e sai quando confirmada", () => {
    const a = memoria();
    const f = criarFilaOffline(a, "p1", () => 1000);
    f.guardar({ conversaId: "c1", idEnvio: "e1", texto: "oi", anexos: [], em: 1000 });
    f.guardar({ conversaId: "c1", idEnvio: "e1", texto: "oi", anexos: [], em: 1000 });
    expect(criarFilaOffline(a, "p1", () => 2000).listar()).toHaveLength(1);
    expect(criarFilaOffline(a, "p2", () => 2000).listar()).toHaveLength(0);
    f.tirar("e1");
    expect(a.dados.size).toBe(0);
  });

  it("descarta o que passou de 7 dias e o que não tem a forma certa", () => {
    const a = memoria();
    a.setItem("nod.fila-envio.p1", JSON.stringify([{ conversaId: "c", idEnvio: "x", texto: "t", anexos: [], em: 0 }, { lixo: true }]));
    expect(criarFilaOffline(a, "p1", () => 8 * 24 * 3600_000).listar()).toEqual([]);
    expect(criarFilaOffline(null, "p1").listar()).toEqual([]);
  });

  it("só falta de rede vai para a fila; recusa do servidor não", () => {
    expect(falhouPorRede(false, null)).toBe(true);
    expect(falhouPorRede(true, new TypeError("Failed to fetch"))).toBe(true);
    expect(falhouPorRede(true, { status: 0 })).toBe(true);
    expect(falhouPorRede(true, { status: 409 })).toBe(false);
  });
});

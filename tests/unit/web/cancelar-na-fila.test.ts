import { describe, expect, it, vi } from "vitest";
import { aposReleitura, CANCELAR_DESFAZER_MS, cancelarNaFila, desfazerCancelamento, reduzirCancelamento, TARDE_MINIMO_MS, type AcaoDoCancelamento, type Cancelamento, type DepsDoCancelar, type DepsDoDesfazer } from "../../../web/lib/cancelar-na-fila.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";

const ALVO = { turnoId: "t2", conversaId: "c1", mensagemId: "m2" };

/** Um despacho de verdade (pelas transições) e os focos/agendamentos anotados. */
function montar(cancelar: (id: string) => Promise<unknown>) {
  let estado: Readonly<Record<string, Cancelamento>> = {};
  const acoes: AcaoDoCancelamento[] = [];
  const agendados: { fn: () => void; ms: number }[] = [];
  const chamadas: string[] = [];
  const d: DepsDoCancelar = {
    cancelarTurno: vi.fn(cancelar),
    dispatch: (a) => { acoes.push(a); estado = reduzirCancelamento(estado, a); },
    estado: () => estado,
    agora: () => 1_000,
    agendar: (fn, ms) => void agendados.push({ fn, ms }),
    invalidar: (c) => void chamadas.push(`invalidar:${c}`),
    mostrarErro: () => void chamadas.push("mostrarErro"),
    focarDesfazer: (id) => void chamadas.push(`foco:desfazer:${id}`),
    focarTentarDeNovo: (id) => void chamadas.push(`foco:tentar:${id}`),
    focarCampoSeSaiu: () => void chamadas.push("foco:campo"),
  };
  return { d, acoes, agendados, chamadas, estado: () => estado };
}

describe("cancelar a mensagem na fila (web/lib/cancelar-na-fila.ts)", () => {
  it("o POST sai na hora do clique, sem esperar 5 s; o OK abre o Desfazer e põe o foco nele", async () => {
    let soltar: () => void = () => undefined;
    const m = montar(() => new Promise<void>((r) => { soltar = r; }));
    const indo = cancelarNaFila(m.d, ALVO);
    expect(m.d.cancelarTurno).toHaveBeenCalledWith("t2");
    expect(m.estado().t2).toMatchObject({ fase: "cancelando", conversaId: "c1", mensagemId: "m2" });
    // Um segundo clique com o POST no ar não chama de novo.
    await cancelarNaFila(m.d, ALVO);
    expect(m.d.cancelarTurno).toHaveBeenCalledTimes(1);
    soltar();
    await indo;
    expect(m.estado().t2).toMatchObject({ fase: "cancelada", desfazivel: true });
    expect(m.chamadas).toEqual(["invalidar:c1", "foco:desfazer:t2"]);
    expect(m.agendados.map((a) => a.ms)).toEqual([CANCELAR_DESFAZER_MS]);
    // Passados os 5 s: some o Desfazer e o foco volta ao campo.
    m.agendados[0]!.fn();
    expect(m.estado().t2).toMatchObject({ fase: "cancelada" });
    expect(m.estado().t2?.desfazivel).toBeUndefined();
    expect(m.chamadas.at(-1)).toBe("foco:campo");
  });

  it("409 (estado_invalido) vira 'tarde', sem Desfazer nem faixa de erro", async () => {
    const m = montar(() => Promise.reject(new ErroApi(409, "estado_invalido", "x")));
    await cancelarNaFila(m.d, ALVO);
    expect(m.estado().t2).toMatchObject({ fase: "tarde" });
    expect(m.agendados).toEqual([]);
    expect(m.chamadas).toEqual([]);
  });

  it("erro de rede vira 'erro' com o Tentar de novo (o mesmo cancelar-turno) em foco", async () => {
    const m = montar(() => Promise.reject(new TypeError("Failed to fetch")));
    await cancelarNaFila(m.d, ALVO);
    expect(m.estado().t2).toMatchObject({ fase: "erro" });
    expect(m.chamadas).toEqual(["foco:tentar:t2"]);
    // Tentar de novo: sai de novo, na hora.
    m.d.cancelarTurno = vi.fn(() => Promise.resolve());
    await cancelarNaFila(m.d, ALVO);
    expect(m.estado().t2).toMatchObject({ fase: "cancelada", desfazivel: true });
  });

  it("a sessão caída (401) também mostra a faixa de sempre", async () => {
    const m = montar(() => Promise.reject(new ErroApi(401, "nao_autenticado", "x")));
    await cancelarNaFila(m.d, ALVO);
    expect(m.chamadas).toEqual(["mostrarErro", "foco:tentar:t2"]);
  });
});

describe("o Desfazer da mensagem cancelada", () => {
  const cancelada: Readonly<Record<string, Cancelamento>> = { t2: { fase: "cancelada", em: 1, conversaId: "c1", mensagemId: "m2", desfazivel: true } };
  function montarDesfazer(fala: ReturnType<DepsDoDesfazer["fala"]>, o: { vazio?: boolean; reenvia?: boolean } = {}) {
    let estado = cancelada;
    const chamadas: unknown[][] = [];
    const d: DepsDoDesfazer = {
      dispatch: (a) => { estado = reduzirCancelamento(estado, a); },
      estado: () => estado,
      fala: () => fala,
      reenviar: (...a) => { chamadas.push(["reenviar", ...a]); return o.reenvia ?? true; },
      campoVazio: () => o.vazio ?? true,
      devolverAoCampo: (...a) => void chamadas.push(["campo", ...a]),
      focarCampo: () => void chamadas.push(["foco"]),
    };
    return { d, chamadas, estado: () => estado };
  }

  it("sem anexo: reenvia o mesmo texto (e a citação) pelo envio de sempre e esconde o balão cancelado", () => {
    const m = montarDesfazer({ texto: "e põe prazo sexta", anexos: [], respondeA: "m1" });
    desfazerCancelamento(m.d, "t2");
    expect(m.chamadas).toEqual([["reenviar", "c1", "e põe prazo sexta", "m1"], ["foco"]]);
    expect(m.estado().t2?.fase).toBe("desfeita");
  });

  it("outro envio em voo na conversa: nada muda (o Desfazer continua lá)", () => {
    const m = montarDesfazer({ texto: "oi", anexos: [] }, { reenvia: false });
    desfazerCancelamento(m.d, "t2");
    expect(m.estado().t2).toMatchObject({ fase: "cancelada", desfazivel: true });
  });

  it("com anexo e o campo vazio: o texto e os anexos voltam ao campo, sem reenviar", () => {
    const anexo = { id: "a1", nome: "quadro.png", mime: "image/png" };
    const m = montarDesfazer({ texto: "olha", anexos: [anexo] });
    desfazerCancelamento(m.d, "t2");
    expect(m.chamadas).toEqual([["campo", "c1", "olha", [anexo]], ["foco"]]);
    expect(m.estado().t2?.fase).toBe("voltou");
  });

  it("com anexo e o campo ocupado: não apaga o que está lá; a linha pede para esvaziar", () => {
    const m = montarDesfazer({ texto: "olha", anexos: [{ id: "a1", nome: "q.png", mime: "image/png" }] }, { vazio: false });
    desfazerCancelamento(m.d, "t2");
    expect(m.chamadas).toEqual([]);
    expect(m.estado().t2).toMatchObject({ fase: "cancelada", desfazivel: true, aviso: "esvazie o campo para desfazer" });
  });

  it("depois dos 5 s o Desfazer não faz nada", () => {
    const m = montarDesfazer({ texto: "oi", anexos: [] });
    m.d.dispatch({ tipo: "desfazer-expirou", turnoId: "t2" });
    desfazerCancelamento(m.d, "t2");
    expect(m.chamadas).toEqual([]);
  });
});

describe("transições do estado.cancelando", () => {
  it("a releitura tira o 'tarde' só depois do mínimo na tela, e só da conversa relida", () => {
    const e: Record<string, Cancelamento> = {
      t1: { fase: "tarde", em: 0, conversaId: "c1", mensagemId: "m1" },
      t2: { fase: "tarde", em: 0, conversaId: "c2", mensagemId: "m2" },
      t3: { fase: "cancelada", em: 0, conversaId: "c1", mensagemId: "m3" },
    };
    expect(aposReleitura(e, "c1", TARDE_MINIMO_MS - 1)).toBe(e);
    expect(Object.keys(aposReleitura(e, "c1", TARDE_MINIMO_MS))).toEqual(["t2", "t3"]);
  });

  it("OK ou recusa de um turno que a aba não está cancelando não cria entrada", () => {
    expect(reduzirCancelamento({}, { tipo: "turno-cancelado", turnoId: "x", agora: 1 })).toEqual({});
    expect(reduzirCancelamento({}, { tipo: "cancelamento-recusado", turnoId: "x", fase: "tarde", agora: 1 })).toEqual({});
  });
});

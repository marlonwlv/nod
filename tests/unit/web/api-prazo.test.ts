import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroApi } from "../../../web/lib/erro-api.ts";

/** ADR-181: toda leitura tem prazo (10 s por tentativa); vencido, é a falha de rede de sempre, não um cancelamento. */
type ApiDeTeste = { criarApi: (escopo: { tenantId: string; pessoaId: string }) => { frota(): Promise<unknown> }; PRAZO_GET_MS: number };
const { criarApi, PRAZO_GET_MS } = await vi.importActual<ApiDeTeste>("../../../web/lib/api.ts");

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("prazo dos GETs (ADR-181)", () => {
  it("o GET leva um sinal com prazo; o prazo vencido (TimeoutError) é falha de rede, repetida e com um sinal novo por tentativa", async () => {
    // O relógio falso não dispara o AbortSignal.timeout (temporizador da plataforma): o fetch de mentira faz o que o
    // navegador faria ao vencer o prazo — rejeita com TimeoutError; o relógio falso só pula as esperas do retry.
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: true });
    const sinais: (AbortSignal | undefined)[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      sinais.push(init.signal ?? undefined);
      return Promise.reject(new DOMException("prazo", "TimeoutError"));
    }));
    expect(PRAZO_GET_MS).toBe(10_000);
    const api = criarApi({ tenantId: "t1", pessoaId: "p1" });
    const r = api.frota().then((ok) => ({ ok }), (erro: unknown) => ({ erro }));
    await vi.runAllTimersAsync();
    const saida = await r;
    expect("erro" in saida).toBe(true);
    const erro = (saida as { erro: unknown }).erro;
    expect(erro).toBeInstanceOf(ErroApi);
    expect((erro as ErroApi).codigo).toBe("servidor_indisponivel");
    // Quatro tentativas (a primeira e as três do retry), cada uma com o próprio sinal de prazo.
    expect(sinais).toHaveLength(4);
    expect(new Set(sinais).size).toBe(4);
    for (const s of sinais) expect(s).toBeInstanceOf(AbortSignal);
  });
});

import { describe, expect, it } from "vitest";
import { criarEntradaCdp, type ConexaoCdp } from "../../../src/adapters/navegador/entrada-cdp.ts";
import type { ChamadaCdp } from "../../../src/domain/navegador-entrada-cdp.ts";

type Msg = { id: number; method: string; params: Record<string, unknown>; sessionId?: string };

/** Um Chrome falso: responde cada chamada; `responder` decide a resposta (null = não responde). */
function chromeFalso(responder: (m: Msg) => object | null) {
  const enviadas: Msg[] = [];
  let leitor: (t: string) => void = () => undefined;
  let fechou: () => void = () => undefined;
  let conexoes = 0;
  const conectar = async (): Promise<ConexaoCdp> => {
    conexoes++;
    return {
      enviar: (t) => {
        const m = JSON.parse(t) as Msg;
        enviadas.push(m);
        const r = responder(m);
        if (r) queueMicrotask(() => leitor(JSON.stringify({ id: m.id, ...r })));
      },
      aoMensagem: (fn) => { leitor = fn; },
      aoFechar: (fn) => { fechou = fn; },
      fechar: () => undefined,
    };
  };
  return { conectar, enviadas, evento: (m: object) => leitor(JSON.stringify(m)), cair: () => fechou(), conexoes: () => conexoes };
}

const ALVO = "A7B0187D255D9C867BEA8F66F2C40E3F";
const OUTRO = "C908E129D9D3607F106EA782DDE37B39";
const tecla: ChamadaCdp = { metodo: "Input.insertText", params: { text: "a" } };

describe("a entrada confirmada pelo CDP", () => {
  it("prende-se à aba ativa uma vez e confirma cada chamada", async () => {
    let n = 0;
    const c = chromeFalso((m) => (m.method === "Target.attachToTarget" ? { result: { sessionId: `s${++n}` } } : { result: {} }));
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo(ALVO);
    expect(await e.executar([tecla])).toBe(true);
    expect(await e.executar([tecla])).toBe(true);
    expect(c.enviadas.map((m) => m.method)).toEqual(["Target.attachToTarget", "Input.insertText", "Input.insertText"]);
    expect(c.enviadas[1]!.sessionId).toBe("s1");
    expect(c.enviadas[0]!.params).toEqual({ targetId: ALVO, flatten: true });
  });

  it("trocou de aba: a próxima chamada vai para a nova", async () => {
    let n = 0;
    const c = chromeFalso((m) => (m.method === "Target.attachToTarget" ? { result: { sessionId: `s${++n}` } } : { result: {} }));
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo(ALVO);
    await e.executar([tecla]);
    e.alvo(OUTRO);
    await e.executar([tecla]);
    expect(c.enviadas.filter((m) => m.method === "Target.attachToTarget").map((m) => m.params.targetId)).toEqual([ALVO, OUTRO]);
    expect(c.enviadas.at(-1)!.sessionId).toBe("s2");
  });

  it("sem aba conhecida, não confirma (a vista avisa e tenta de novo)", async () => {
    const c = chromeFalso(() => ({ result: {} }));
    expect(await criarEntradaCdp({ conectar: c.conectar }).executar([tecla])).toBe(false);
  });

  it("a sessão da aba sumiu (navegou para outro processo): prende de novo e a tecla chega uma vez só", async () => {
    let n = 0;
    let primeira = true;
    const c = chromeFalso((m) => {
      if (m.method === "Target.attachToTarget") return { result: { sessionId: `s${++n}` } };
      if (primeira) { primeira = false; return { error: { code: -32001, message: "Session with given id not found." } }; }
      return { result: {} };
    });
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo(ALVO);
    expect(await e.executar([tecla])).toBe(true);
    expect(c.enviadas.map((m) => m.method)).toEqual(["Target.attachToTarget", "Input.insertText", "Target.attachToTarget", "Input.insertText"]);
  });

  it("o Chrome recusou a tecla (outro erro): não repete, para não digitar duas vezes", async () => {
    const c = chromeFalso((m) => (m.method === "Target.attachToTarget" ? { result: { sessionId: "s1" } } : { error: { code: -32000, message: "Invalid parameters" } }));
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo(ALVO);
    expect(await e.executar([tecla])).toBe(false);
    expect(c.enviadas.filter((m) => m.method === "Input.insertText")).toHaveLength(1);
  });

  it("sem resposta no prazo: não confirmada", async () => {
    const c = chromeFalso((m) => (m.method === "Target.attachToTarget" ? { result: { sessionId: "s1" } } : null));
    const e = criarEntradaCdp({ conectar: c.conectar, prazoMs: 20 });
    e.alvo(ALVO);
    expect(await e.executar([tecla])).toBe(false);
  });

  it("a conexão caiu: a próxima chamada reconecta e se prende de novo", async () => {
    let n = 0;
    const c = chromeFalso((m) => (m.method === "Target.attachToTarget" ? { result: { sessionId: `s${++n}` } } : { result: {} }));
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo(ALVO);
    await e.executar([tecla]);
    c.cair();
    expect(await e.executar([tecla])).toBe(true);
    expect(c.conexoes()).toBe(2);
    expect(c.enviadas.at(-1)!.sessionId).toBe("s2");
  });

  it("a aba se soltou (detachedFromTarget): a próxima chamada se prende de novo", async () => {
    let n = 0;
    const c = chromeFalso((m) => (m.method === "Target.attachToTarget" ? { result: { sessionId: `s${++n}` } } : { result: {} }));
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo(ALVO);
    await e.executar([tecla]);
    c.evento({ method: "Target.detachedFromTarget", params: { sessionId: "s1" } });
    await e.executar([tecla]);
    expect(c.enviadas.filter((m) => m.method === "Target.attachToTarget")).toHaveLength(2);
  });

  it("ignora um alvo fora do formato do Chrome", async () => {
    const c = chromeFalso(() => ({ result: { sessionId: "s1" } }));
    const e = criarEntradaCdp({ conectar: c.conectar });
    e.alvo("../../etc");
    expect(await e.executar([tecla])).toBe(false);
    expect(c.enviadas.filter((m) => m.method.startsWith("Input."))).toHaveLength(0);
  });
});

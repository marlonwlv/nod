import { describe, expect, it } from "vitest";
import { criarEnvios } from "../../../web/lib/envio-idempotente.ts";
import { armazemComReserva, criarJournalDeEnvio, ESPERAS_DO_REENVIO_MS, journalEmMemoria, tipoDaFalha, type ArmazemDoJournal, type Desfecho, type ItemDoJournal } from "../../../web/lib/journal-envio.ts";

/**
 * O journal de envio: a fala entra (pelo `idEnvio`) antes do POST e sai quando o servidor confirma; rede e 5xx repetem até
 * 5 vezes (1, 2, 5, 12, 30 s) pela mesma chave; 4xx não repete; no boot, o que ficou volta e é reenviado.
 */
const item = (idEnvio: string, conversaId = "c1", em = 1): ItemDoJournal => ({ conversaId, idEnvio, texto: `fala ${idEnvio}`, anexos: [], em });
const semRede = () => Object.assign(new TypeError("Failed to fetch"));
const erroHttp = (status: number) => Object.assign(new Error(`http ${status}`), { name: "ErroApi", status });
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe("journal de envio: enfileira e confirma", () => {
  it("entra no journal ANTES do POST e sai quando o servidor confirma", async () => {
    const armazem = journalEmMemoria();
    const vistoNoPost: boolean[] = [];
    const j = criarJournalDeEnvio({ armazem, enviar: async (i) => { vistoNoPost.push(armazem.dados.has(i.idEnvio)); return { ids: { mensagem: "m1" } }; } });
    await expect(j.enviar(item("e1"))).resolves.toEqual({ ids: { mensagem: "m1" } });
    expect(vistoNoPost).toEqual([true]);
    await esperar();
    expect(armazem.dados.size).toBe(0);
    expect(j.itens()).toEqual([]);
  });

  it("a mesma chave já em voo devolve o mesmo envio (um POST só)", async () => {
    let posts = 0;
    let soltar: () => void = () => undefined;
    const j = criarJournalDeEnvio({ armazem: journalEmMemoria(), enviar: () => { posts++; return new Promise((ok) => { soltar = () => ok("r"); }); } });
    const a = j.enviar(item("e1"));
    const b = j.enviar(item("e1"));
    expect(a).toBe(b);
    await esperar();
    soltar();
    await expect(a).resolves.toBe("r");
    expect(posts).toBe(1);
  });
});

describe("journal de envio: reenvio", () => {
  it("rede: até 5 reenvios, pela mesma chave, esperando 1, 2, 5, 12 e 30 s; esgotou, fica no journal como 'falhou'", async () => {
    const armazem = journalEmMemoria();
    const esperas: number[] = [];
    const chaves: string[] = [];
    let primeira = 0;
    const j = criarJournalDeEnvio({ armazem, esperar: async (ms) => void esperas.push(ms), enviar: async (i) => { chaves.push(i.idEnvio); throw semRede(); } });
    await expect(j.enviar(item("e1"), { aoFalharPrimeira: () => primeira++ })).rejects.toThrow("Failed to fetch");
    expect(ESPERAS_DO_REENVIO_MS).toEqual([1000, 2000, 5000, 12000, 30000]);
    expect(esperas).toEqual([1000, 2000, 5000, 12000, 30000]);
    expect(chaves).toEqual(["e1", "e1", "e1", "e1", "e1", "e1"]);
    expect(primeira).toBe(1);
    expect(armazem.dados.has("e1")).toBe(true);
    expect(j.itens()).toEqual([{ item: item("e1"), falhou: true }]);
  });

  it("5xx repete e, quando o servidor volta, confirma e sai", async () => {
    const armazem = journalEmMemoria();
    const esperas: number[] = [];
    let n = 0;
    const j = criarJournalDeEnvio({ armazem, esperar: async (ms) => void esperas.push(ms), enviar: async () => { if (++n < 3) throw erroHttp(503); return "ok"; } });
    await expect(j.enviar(item("e1"))).resolves.toBe("ok");
    expect(esperas).toEqual([1000, 2000]);
    await esperar();
    expect(armazem.dados.size).toBe(0);
  });

  it("recusa 4xx não repete: sai do journal e o erro sobe (vira o 'falhou' da fala)", async () => {
    const armazem = journalEmMemoria();
    const esperas: number[] = [];
    let posts = 0;
    const j = criarJournalDeEnvio({ armazem, esperar: async (ms) => void esperas.push(ms), enviar: async () => { posts++; throw erroHttp(422); } });
    await expect(j.enviar(item("e1"))).rejects.toMatchObject({ status: 422 });
    expect(posts).toBe(1);
    expect(esperas).toEqual([]);
    await esperar();
    expect(armazem.dados.size).toBe(0);
    expect(j.itens()).toEqual([]);
  });

  it("quem é rede, 5xx e recusa", () => {
    expect(tipoDaFalha(semRede())).toBe("rede");
    expect(tipoDaFalha(erroHttp(0))).toBe("rede");
    expect(tipoDaFalha(erroHttp(500))).toBe("servidor");
    expect(tipoDaFalha(erroHttp(401))).toBe("recusa");
    expect(tipoDaFalha(erroHttp(409))).toBe("recusa");
    expect(tipoDaFalha(new Error("bug"))).toBe("recusa");
  });

  it("descartada no meio dos reenvios: para e sai do journal", async () => {
    const armazem = journalEmMemoria();
    let posts = 0;
    let j: ReturnType<typeof criarJournalDeEnvio> | null = null;
    j = criarJournalDeEnvio({ armazem, esperar: async () => { if (posts === 2) j!.esquecer("e1"); }, enviar: async () => { posts++; throw semRede(); } });
    await expect(j.enviar(item("e1"))).rejects.toThrow();
    expect(posts).toBe(2);
    await esperar();
    expect(armazem.dados.size).toBe(0);
  });
});

describe("journal de envio: reconcilia no boot", () => {
  it("o que ficou volta (na ordem em que foi dito) e é reenviado pela mesma chave, uma fala por vez por conversa", async () => {
    const armazem = journalEmMemoria([item("e2", "c1", 20), item("e1", "c1", 10), item("e3", "c2", 15)]);
    const voltaram: string[] = [];
    const posts: string[] = [];
    const emVooPorConversa = new Map<string, number>();
    let maxEmVoo = 0;
    const j = criarJournalDeEnvio({
      armazem,
      enviar: async (i) => {
        posts.push(i.idEnvio);
        const n = (emVooPorConversa.get(i.conversaId) ?? 0) + 1;
        emVooPorConversa.set(i.conversaId, n);
        maxEmVoo = Math.max(maxEmVoo, n);
        await esperar();
        emVooPorConversa.set(i.conversaId, n - 1);
        return { ids: { mensagem: `m-${i.idEnvio}` } };
      },
    });
    const fins: [string, Desfecho][] = [];
    await j.reconciliar((i) => voltaram.push(`${i.conversaId}:${i.idEnvio}`), (i, d) => fins.push([i.idEnvio, d]));
    expect(voltaram).toEqual(["c1:e1", "c2:e3", "c1:e2"]);
    expect(posts.indexOf("e1")).toBeLessThan(posts.indexOf("e2"));
    expect(maxEmVoo).toBe(1);
    expect(fins.map(([id, d]) => [id, d.ok])).toEqual(expect.arrayContaining([["e1", true], ["e2", true], ["e3", true]]));
    await esperar();
    expect(armazem.dados.size).toBe(0);
  });

  it("o que já está em voo nesta página não volta nem sai duas vezes; a recusa no boot termina como 'falhou'", async () => {
    const armazem = journalEmMemoria([item("e9", "c1")]);
    let soltar: () => void = () => undefined;
    let posts = 0;
    const j = criarJournalDeEnvio({ armazem, enviar: (i) => { posts++; return i.idEnvio === "e1" ? new Promise((ok) => { soltar = () => ok("r"); }) : Promise.reject(erroHttp(404)); } });
    const emVoo = j.enviar(item("e1"));
    await esperar();
    const voltaram: string[] = [];
    const fins: [string, boolean][] = [];
    await j.reconciliar((i) => voltaram.push(i.idEnvio), (i, d) => fins.push([i.idEnvio, d.ok]));
    expect(voltaram).toEqual(["e9"]);
    expect(fins).toEqual([["e9", false]]);
    soltar();
    await emVoo;
    expect(posts).toBe(2);
  });

  it("encerrado (outra sessão): para de reenviar e não apaga nada", async () => {
    const armazem = journalEmMemoria();
    let j: ReturnType<typeof criarJournalDeEnvio> | null = null;
    j = criarJournalDeEnvio({ armazem, esperar: async () => j!.encerrar(), enviar: async () => { throw semRede(); } });
    await expect(j.enviar(item("e1"))).rejects.toThrow();
    expect(armazem.dados.has("e1")).toBe(true);
  });
});

describe("journal de envio: armazém", () => {
  it("o IndexedDB com a fila do localStorage de reserva: o que a fila tinha passa para o IndexedDB no boot; o IndexedDB que falha cai na fila", async () => {
    const idb = journalEmMemoria();
    const fila = journalEmMemoria([item("velho")]);
    const a = armazemComReserva(idb, fila);
    expect((await a.lerTodos()).map((i) => i.idEnvio)).toEqual(["velho"]);
    expect([...idb.dados.keys()]).toEqual(["velho"]);
    expect(fila.dados.size).toBe(0);
    const quebrado: ArmazemDoJournal = { lerTodos: () => Promise.reject(new Error("x")), gravar: () => Promise.reject(new Error("x")), apagar: () => Promise.reject(new Error("x")) };
    const b = armazemComReserva(quebrado, fila);
    await b.gravar(item("novo"));
    expect((await b.lerTodos()).map((i) => i.idEnvio)).toEqual(["novo"]);
    await b.apagar("novo");
    expect(fila.dados.size).toBe(0);
  });

  it("envios.esquecer: a chave da fala que o journal gravou depois some (a mesma fala de novo é outra mensagem); outra chave fica", () => {
    let n = 0;
    const envios = criarEnvios(() => `k${++n}`);
    expect(envios.iniciar("c1", "oi", [])).toBe("k1");
    envios.concluir("c1", false);
    envios.esquecer("c1", "outra");
    expect(envios.iniciar("c1", "oi", [])).toBe("k1");
    envios.concluir("c1", false);
    envios.esquecer("c1", "k1");
    expect(envios.iniciar("c1", "oi", [])).toBe("k2");
  });
});

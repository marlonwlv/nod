import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { armazemEmMemoria, chaveDaConversa, criarCacheDeConversas, paraGuardar, type RegistroDaConversa } from "../../../web/lib/cache-conversas.ts";

/**
 * Item 5 do chat (trocar de bot sem "carregando conversa"): o cache por conversa com stale-while-revalidate — memória mais
 * IndexedDB (aqui, o armazém num mapa, injetado), chave `conversa:<id>`, 200 mensagens por conversa, LRU de 30.
 */
const msg = (conversaId: string, n: number) => ({ id: `${conversaId}-m${n}`, conversaId, autor: "pessoa", texto: `fala ${n}`, criadoEm: n }) as never;

function dto(id: string, mensagens = 1, extra: Partial<ConversaDto> = {}): ConversaDto {
  return {
    conversa: { tenantId: "t", id, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: `a-${id}`, salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: Array.from({ length: mensagens }, (_, i) => msg(id, i)),
    turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    ...extra,
  };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe("cache de conversas: hit", () => {
  it("o que foi guardado volta na hora (síncrono), na chave conversa:<id> do armazém", async () => {
    const armazem = armazemEmMemoria();
    const cache = criarCacheDeConversas(armazem);
    await cache.pronto;
    expect(cache.ler("c1")).toBeNull();
    cache.guardar(dto("c1", 3));
    expect(cache.ler("c1")?.mensagens).toHaveLength(3);
    await esperar();
    expect([...armazem.dados.keys()]).toEqual([chaveDaConversa("c1")]);
    expect(chaveDaConversa("c1")).toBe("conversa:c1");
  });

  it("depois de recarregar, a primeira leitura já vem do IndexedDB (o armazém de antes)", async () => {
    const armazem = armazemEmMemoria();
    const antes = criarCacheDeConversas(armazem);
    await antes.pronto;
    antes.guardar(dto("c1", 2));
    await esperar();
    const depois = criarCacheDeConversas(armazem);
    expect(depois.ler("c1")).toBeNull();
    await depois.pronto;
    expect(depois.ler("c1")?.mensagens).toHaveLength(2);
  });

  it("guarda só as últimas 200 mensagens, sem turno em curso nem na fila (não voltam 'trabalhando')", () => {
    const c = paraGuardar({ ...dto("c1", 250), turnosEmCurso: [{ id: "t1" } as never], turnosPendentes: [{ id: "t2" } as never], carregadaEm: 5, pendentes: [] } as never);
    expect(c.mensagens).toHaveLength(200);
    expect(c.mensagens[0]).toMatchObject({ id: "c1-m50" });
    expect(c.mensagens.at(-1)).toMatchObject({ id: "c1-m249" });
    expect(c.turnosEmCurso).toEqual([]);
    expect(c.turnosPendentes).toEqual([]);
    expect("carregadaEm" in c || "pendentes" in c).toBe(false);
  });

  it("o reducer pinta o cache só onde não há nada, e pede a releitura (a conversa do servidor sempre ganha)", () => {
    const pintado = reduzir(estadoInicial, { tipo: "conversa-do-cache", conversa: dto("c1", 2) });
    expect(pintado.conversas.c1?.mensagens).toHaveLength(2);
    expect(pintado.invalidacoes).toContain("conversa:c1");
    const lida = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: dto("c1", 5), agora: 10 });
    expect(reduzir(lida, { tipo: "conversa-do-cache", conversa: dto("c1", 2) })).toBe(lida);
  });
});

describe("cache de conversas: revalidação", () => {
  it("pinta o guardado e, com a leitura de hoje, guarda e devolve a nova (memória e armazém)", async () => {
    const armazem = armazemEmMemoria();
    const cache = criarCacheDeConversas(armazem);
    await cache.pronto;
    cache.guardar(dto("c1", 2));
    expect(cache.ler("c1")?.mensagens).toHaveLength(2);
    let respondida = false;
    const nova = await cache.revalidar("c1", async () => { respondida = true; return dto("c1", 4); });
    expect(respondida).toBe(true);
    expect(nova.mensagens).toHaveLength(4);
    expect(cache.ler("c1")?.mensagens).toHaveLength(4);
    await esperar();
    expect(armazem.dados.get("conversa:c1")?.conversa.mensagens).toHaveLength(4);
  });

  it("a leitura que falha sobe e o guardado fica", async () => {
    const cache = criarCacheDeConversas(armazemEmMemoria());
    await cache.pronto;
    cache.guardar(dto("c1", 2));
    await expect(cache.revalidar("c1", async () => { throw new Error("rede"); })).rejects.toThrow("rede");
    expect(cache.ler("c1")?.mensagens).toHaveLength(2);
  });

  it("o que a página guardou enquanto o armazém abria vale mais que o registro velho dele", async () => {
    const velho: [string, RegistroDaConversa] = ["conversa:c1", { conversa: dto("c1", 1), usadaEm: 1 }];
    const cache = criarCacheDeConversas(armazemEmMemoria([velho]));
    cache.guardar(dto("c1", 7));
    await cache.pronto;
    expect(cache.ler("c1")?.mensagens).toHaveLength(7);
  });

  it("o armazém que falha (aba privada, cota) só deixa de guardar: a memória segue", async () => {
    const quebrado = { lerTodos: () => Promise.reject(new Error("x")), gravar: () => Promise.reject(new Error("x")), apagar: () => Promise.reject(new Error("x")) };
    const cache = criarCacheDeConversas(quebrado);
    await cache.pronto;
    cache.guardar(dto("c1"));
    await esperar();
    expect(cache.ler("c1")).not.toBeNull();
  });
});

describe("cache de conversas: despejo (LRU de 30)", () => {
  it("passou de 30, sai a usada há mais tempo — da memória e do armazém", async () => {
    let agora = 1000;
    const armazem = armazemEmMemoria();
    const cache = criarCacheDeConversas(armazem, { relogio: () => agora++ });
    await cache.pronto;
    for (let i = 0; i < 30; i++) cache.guardar(dto(`c${i}`));
    // Abrir a c0 a torna a mais usada: quem sai é a c1.
    expect(cache.ler("c0")).not.toBeNull();
    cache.guardar(dto("c30"));
    await esperar();
    expect(cache.ids()).toHaveLength(30);
    expect(cache.ler("c1")).toBeNull();
    expect(cache.ler("c0")).not.toBeNull();
    expect(armazem.dados.size).toBe(30);
    expect(armazem.dados.has("conversa:c1")).toBe(false);
  });

  it("ao recarregar, a ordem de uso volta do armazém e o excesso sai", async () => {
    const registros = Array.from({ length: 32 }, (_, i): [string, RegistroDaConversa] => [`conversa:c${i}`, { conversa: dto(`c${i}`), usadaEm: 100 - i }]);
    const armazem = armazemEmMemoria(registros);
    const cache = criarCacheDeConversas(armazem);
    await cache.pronto;
    await esperar();
    // usadaEm decresce com i: c31 e c30 são as menos usadas.
    expect(cache.ids()).toHaveLength(30);
    expect(cache.ids()[0]).toBe("c29");
    expect(cache.ids().at(-1)).toBe("c0");
    expect(armazem.dados.has("conversa:c31")).toBe(false);
    expect(armazem.dados.has("conversa:c30")).toBe(false);
  });

  it("apagar (a conversa que sumiu, 404) tira dos dois", async () => {
    const armazem = armazemEmMemoria();
    const cache = criarCacheDeConversas(armazem);
    await cache.pronto;
    cache.guardar(dto("c1"));
    cache.apagar("c1");
    await esperar();
    expect(cache.ler("c1")).toBeNull();
    expect(armazem.dados.size).toBe(0);
  });
});

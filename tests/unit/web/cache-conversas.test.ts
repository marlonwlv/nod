import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { ATRASO_DA_GRAVACAO_MS, armazemEmMemoria, chaveDaConversa, criarCacheDeConversas, criarRevalidacaoEmSegundoPlano, PARADA_MS, paraGuardar, type ArmazemDeConversas, type RegistroDaConversa } from "../../../web/lib/cache-conversas.ts";

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
/** Os testes de hit, revalidação e LRU olham o armazém logo depois de guardar: sem os 2 s de atraso (testados abaixo). */
const cacheImediato = (armazem: ArmazemDeConversas, o: Parameters<typeof criarCacheDeConversas>[1] = {}) => criarCacheDeConversas(armazem, { atrasoDaGravacao: 0, ...o });

describe("cache de conversas: hit", () => {
  it("o que foi guardado volta na hora (síncrono), na chave conversa:<id> do armazém", async () => {
    const armazem = armazemEmMemoria();
    const cache = cacheImediato(armazem);
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
    const antes = cacheImediato(armazem);
    await antes.pronto;
    antes.guardar(dto("c1", 2));
    await esperar();
    const depois = cacheImediato(armazem);
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
    const cache = cacheImediato(armazem);
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
    const cache = cacheImediato(armazemEmMemoria());
    await cache.pronto;
    cache.guardar(dto("c1", 2));
    await expect(cache.revalidar("c1", async () => { throw new Error("rede"); })).rejects.toThrow("rede");
    expect(cache.ler("c1")?.mensagens).toHaveLength(2);
  });

  it("o que a página guardou enquanto o armazém abria vale mais que o registro velho dele", async () => {
    const velho: [string, RegistroDaConversa] = ["conversa:c1", { conversa: dto("c1", 1), usadaEm: 1 }];
    const cache = cacheImediato(armazemEmMemoria([velho]));
    cache.guardar(dto("c1", 7));
    await cache.pronto;
    expect(cache.ler("c1")?.mensagens).toHaveLength(7);
  });

  it("o armazém que falha (aba privada, cota) só deixa de guardar: a memória segue", async () => {
    const quebrado = { lerTodos: () => Promise.reject(new Error("x")), gravar: () => Promise.reject(new Error("x")), apagar: () => Promise.reject(new Error("x")) };
    const cache = cacheImediato(quebrado);
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
    const cache = cacheImediato(armazem, { relogio: () => agora++ });
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
    const cache = cacheImediato(armazem);
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
    const cache = cacheImediato(armazem);
    await cache.pronto;
    cache.guardar(dto("c1"));
    cache.apagar("c1");
    await esperar();
    expect(cache.ler("c1")).toBeNull();
    expect(armazem.dados.size).toBe(0);
  });
});

describe("réplica por conversa: gravação com 2 s de atraso", () => {
  afterEach(() => void vi.useRealTimers());

  it("várias releituras em 2 s gravam uma vez (a última), por conversa; a memória já tem a nova", async () => {
    vi.useFakeTimers();
    const armazem = armazemEmMemoria();
    const gravacoes: string[] = [];
    const gravar = armazem.gravar;
    armazem.gravar = (chave, r) => { gravacoes.push(`${chave}:${r.conversa.mensagens.length}`); return gravar(chave, r); };
    const cache = criarCacheDeConversas(armazem);
    await cache.pronto;
    expect(ATRASO_DA_GRAVACAO_MS).toBe(2000);
    cache.guardar(dto("c1", 1));
    await vi.advanceTimersByTimeAsync(1000);
    await cache.revalidar("c1", async () => dto("c1", 2));
    cache.guardar(dto("c2", 5));
    await vi.advanceTimersByTimeAsync(1500);
    cache.guardar(dto("c1", 3));
    expect(cache.ler("c1")?.mensagens).toHaveLength(3);
    expect(gravacoes).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    // c2 completou 2 s parada; c1 recomeçou a contar a cada releitura.
    expect(gravacoes).toEqual(["conversa:c2:5"]);
    await vi.advanceTimersByTimeAsync(1499);
    expect(gravacoes).toEqual(["conversa:c2:5"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(gravacoes).toEqual(["conversa:c2:5", "conversa:c1:3"]);
    expect(armazem.dados.get("conversa:c1")?.conversa.mensagens).toHaveLength(3);
  });

  it("descarregar (a aba some) grava já o que esperava; apagar cancela a gravação que esperava", async () => {
    vi.useFakeTimers();
    const armazem = armazemEmMemoria();
    const cache = criarCacheDeConversas(armazem);
    await cache.pronto;
    cache.guardar(dto("c1", 2));
    cache.guardar(dto("c2", 2));
    cache.apagar("c2");
    cache.descarregar();
    await vi.advanceTimersByTimeAsync(0);
    expect([...armazem.dados.keys()]).toEqual(["conversa:c1"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect([...armazem.dados.keys()]).toEqual(["conversa:c1"]);
  });
});

describe("réplica por conversa: parada há 10 min sai da memória", () => {
  it("sai da memória (o armazém fica), salvo a que `manter` segura (a aberta, a com turno vivo); volta com carregar", async () => {
    let agora = 1_000_000;
    const armazem = armazemEmMemoria();
    const cache = cacheImediato(armazem, { relogio: () => agora });
    await cache.pronto;
    cache.guardar(dto("aberta", 2));
    cache.guardar(dto("viva", 2));
    cache.guardar(dto("parada", 4));
    // usadaEm: 1_000_000, 1_000_001 e 1_000_002 (o uso é sempre crescente).
    agora = 1_000_002 + PARADA_MS - 1;
    expect(cache.despejarParadas((id) => id !== "parada")).toEqual([]);
    agora += 1;
    const saem = cache.despejarParadas((id) => id === "aberta" || id === "viva");
    expect(saem).toEqual(["parada"]);
    expect(cache.ids()).toEqual(["aberta", "viva"]);
    expect(cache.ler("parada")).toBeNull();
    expect(cache.temGuardada("parada")).toBe(true);
    await esperar();
    expect(armazem.dados.has("conversa:parada")).toBe(true);
    // Abrir de novo: vem do IndexedDB (a espera do spinner cobre), sem spinner para quem já tinha réplica.
    expect((await cache.carregar("parada"))?.mensagens).toHaveLength(4);
    expect(cache.ler("parada")?.mensagens).toHaveLength(4);
    expect(await cache.carregar("nunca-aberta")).toBeNull();
    expect(cache.temGuardada("nunca-aberta")).toBe(false);
  });

  it("a que espera os 2 s é gravada antes de a memória soltar", async () => {
    let agora = 1000;
    const armazem = armazemEmMemoria();
    const agendados: (() => void)[] = [];
    const cache = criarCacheDeConversas(armazem, { relogio: () => agora, temporizador: { agendar: (fn) => agendados.push(fn), cancelar: () => undefined } });
    await cache.pronto;
    cache.guardar(dto("c1", 3));
    agora += PARADA_MS;
    expect(cache.despejarParadas(() => false)).toEqual(["c1"]);
    await esperar();
    expect(armazem.dados.get("conversa:c1")?.conversa.mensagens).toHaveLength(3);
  });

  it("o reducer tira da memória da tela as que saem, nunca a aberta nem a com turno vivo ou fala pendente", () => {
    let e = estadoInicial;
    for (const id of ["c1", "c2", "c3", "c4"]) e = reduzir(e, { tipo: "hidratar-conversa", conversa: dto(id, 1), agora: 1 });
    e = { ...e, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a-c1" } };
    e = { ...e, turnosVivos: { t1: { turnoId: "t1", conversaId: "c2", estado: "rodando", executor: null, machineId: null, desde: 1 } } };
    e = reduzir(e, { tipo: "fala-pendente", conversaId: "c3", pendente: { idEnvio: "e1", texto: "oi", anexos: [], em: 1, estado: "enviando", mensagemId: null, turnoId: null } });
    const depois = reduzir(e, { tipo: "conversas-saem-da-memoria", ids: ["c1", "c2", "c3", "c4"] });
    expect(Object.keys(depois.conversas).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("a releitura em segundo plano não conta como uso nem traz de volta à memória a que já saiu", async () => {
    let agora = 1000;
    const armazem = armazemEmMemoria();
    const cache = cacheImediato(armazem, { relogio: () => agora });
    await cache.pronto;
    cache.guardar(dto("c1", 1));
    cache.guardar(dto("c2", 1));
    agora = 1000 + PARADA_MS - 10;
    await cache.revalidar("c1", async () => dto("c1", 5), { emSegundoPlano: true });
    agora = 1001 + PARADA_MS;
    expect(cache.despejarParadas(() => false).sort()).toEqual(["c1", "c2"]);
    await cache.revalidar("c2", async () => dto("c2", 6), { emSegundoPlano: true });
    expect(cache.ids()).toEqual([]);
    await esperar();
    expect(armazem.dados.get("conversa:c1")?.conversa.mensagens).toHaveLength(5);
    expect(armazem.dados.get("conversa:c2")?.conversa.mensagens).toHaveLength(6);
  });
});

describe("réplica por conversa: a barra em dia em segundo plano", () => {
  function montar(o: { candidatas: string[]; visivel?: () => boolean }) {
    let agora = 0;
    const agendados: { fn: () => void; ms: number }[] = [];
    const respostas = new Map<string, () => void>();
    const lidas: string[] = [];
    let emVoo = 0;
    let maxEmVoo = 0;
    const r = criarRevalidacaoEmSegundoPlano({
      candidatas: () => o.candidatas,
      revalidar: (id) => new Promise<void>((ok) => { lidas.push(id); emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo); respostas.set(id, () => { emVoo--; ok(); }); }),
      visivel: o.visivel ?? (() => true),
      agendar: (fn, ms) => void agendados.push({ fn, ms }),
      relogio: () => agora,
      espaco: 4000,
      validade: 60_000,
    });
    const tick = async () => { agora += 4000; agendados.shift()!.fn(); await esperar(); };
    return { r, agendados, respostas, lidas, tick, maxEmVoo: () => maxEmVoo, avancar: (ms: number) => { agora += ms; } };
  }

  it("relê uma de cada vez: a próxima só depois que a anterior voltou e passou o espaço", async () => {
    const m = montar({ candidatas: ["c1", "c2", "c3"] });
    m.r.iniciar();
    m.r.iniciar();
    expect(m.agendados).toHaveLength(1);
    await m.tick();
    expect(m.lidas).toEqual(["c1"]);
    expect(m.r.emCurso()).toBe("c1");
    // Sem resposta, nada mais é agendado.
    expect(m.agendados).toHaveLength(0);
    m.respostas.get("c1")!();
    await esperar();
    expect(m.agendados).toEqual([{ fn: expect.any(Function), ms: 4000 }]);
    await m.tick();
    m.respostas.get("c2")!();
    await esperar();
    await m.tick();
    m.respostas.get("c3")!();
    await esperar();
    expect(m.lidas).toEqual(["c1", "c2", "c3"]);
    expect(m.maxEmVoo()).toBe(1);
    // Todas lidas há menos que a validade: a volta seguinte não relê ninguém, só reagenda.
    await m.tick();
    expect(m.lidas).toHaveLength(3);
    expect(m.agendados).toHaveLength(1);
    m.avancar(60_000);
    await m.tick();
    expect(m.lidas).toEqual(["c1", "c2", "c3", "c1"]);
  });

  it("com a aba escondida não relê; a falha de uma não para as outras; parar encerra", async () => {
    let visivel = false;
    const m = montar({ candidatas: ["c1", "c2"], visivel: () => visivel });
    m.r.iniciar();
    await m.tick();
    expect(m.lidas).toEqual([]);
    visivel = true;
    await m.tick();
    expect(m.lidas).toEqual(["c1"]);
    m.r.parar();
    m.respostas.get("c1")!();
    await esperar();
    expect(m.agendados).toHaveLength(0);
  });
});

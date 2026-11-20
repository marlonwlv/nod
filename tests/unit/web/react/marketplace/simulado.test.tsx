import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOTS_SIMULADOS, criarApiSimulada, TOTAL_SIMULADO } from "../../../../../web/react/marketplace/simulado.ts";
import { estaConectado } from "../../../../../web/react/marketplace/modelo.ts";

/**
 * O adaptador simulado (web/marketplace-simulador.html): os dados do protótipo e as respostas de mentira que a pessoa usa
 * para testar sem chave de verdade. Com relógio falso: a latência de 1,5 s é a do padrão.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const app = (api: ReturnType<typeof criarApiSimulada>, slug: string) => api.ler().apps.find((a) => a.slug === slug)!;

describe("o Marketplace simulado", () => {
  it("abre como o D1: 1.445 apps, cinco bots, quatro conectados e o Fireflies em atenção", () => {
    const api = criarApiSimulada();
    const f = api.ler();
    expect(f.total).toBe(TOTAL_SIMULADO);
    expect(f.bots.map((b) => b.nome)).toEqual(["Clarice", "Ada", "Frida", "Cecília", "Dante"]);
    expect(f.apps.filter(estaConectado).map((a) => a.nome)).toEqual(["GitHub", "Google Drive", "Slack", "Fireflies"]);
    expect(app(api, "github").desligado).toBe(true);
    expect(app(api, "fireflies")).toMatchObject({ situacao: "atencao", chave: true, falha: "A chave parou de funcionar · foi apagada ou trocada no Fireflies" });
    expect(f.apps.length).toBeGreaterThan(30);
  });

  it("os campos: o Fireflies pede a chave; o Freshdesk, o endereço da conta e a chave", async () => {
    const api = criarApiSimulada();
    const um = api.campos("fireflies");
    const dois = api.campos("freshdesk");
    await vi.runAllTimersAsync();
    expect((await um).campos.map((c) => [c.nome, c.segredo])).toEqual([["api_key", true]]);
    expect((await dois).campos.map((c) => [c.nome, c.segredo, c.prefixo, c.sufixo])).toEqual([["subdominio", false, "https://", ".freshdesk.com"], ["api_key", true, undefined, undefined]]);
  });

  it("'recusar' ou qualquer valor com 'errad' é recusado; 'indisponivel' não responde; o resto conecta depois de 1,5 s", async () => {
    const api = criarApiSimulada();
    for (const [valor, tipo] of [["recusar", "recusada"], ["chave-ERRADA-123", "recusada"], ["indisponivel", "indisponivel"]] as const) {
      const r = api.conectarComChave("fireflies", { api_key: valor });
      await vi.advanceTimersByTimeAsync(1499);
      let pronto = false;
      void r.then(() => { pronto = true; });
      await Promise.resolve();
      expect(pronto).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await r).toEqual({ tipo });
    }
    expect(app(api, "fireflies").situacao).toBe("atencao");
    const ouvinte = vi.fn();
    api.assinar(ouvinte);
    const ok = api.conectarComChave("fireflies", { api_key: "ff_live_boa" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await ok).toEqual({ tipo: "conectado", conectorId: "sim-fireflies" });
    expect(ouvinte).toHaveBeenCalled();
    expect(app(api, "fireflies")).toMatchObject({ situacao: "conectado", falha: null });
  });

  it("o simulador não guarda o valor da chave em lugar nenhum da foto", async () => {
    const api = criarApiSimulada({ latenciaMs: 0 });
    const r = api.conectarComChave("pipedrive", { api_key: "segredo-que-nao-pode-vazar" });
    await vi.runAllTimersAsync();
    await r;
    expect(JSON.stringify(api.ler(), (_k, v: unknown) => (v instanceof Set ? [...v] : v))).not.toContain("segredo-que-nao-pode-vazar");
    expect(api.valoresRecebidos()).toBe(1);
  });

  it("o login espera, ganha o link e conecta sozinho; Cancelar desiste", async () => {
    const api = criarApiSimulada();
    api.conectarLogin("notion");
    expect(app(api, "notion")).toMatchObject({ situacao: "conectando", login: { url: null, falhou: null } });
    await vi.advanceTimersByTimeAsync(750);
    expect(app(api, "notion").login?.url).toContain("https://");
    await vi.advanceTimersByTimeAsync(2250);
    expect(app(api, "notion")).toMatchObject({ situacao: "conectado", login: null, conectorId: "sim-notion" });

    api.conectarLogin("clickup");
    api.cancelarLogin("clickup");
    await vi.advanceTimersByTimeAsync(5000);
    expect(app(api, "clickup")).toMatchObject({ situacao: "nao_conectado", login: null, conectorId: null });
  });

  it("o T6: Clarice lê, Ada sem acesso, Frida, Cecília e Dante seguem o padrão (Nenhum)", () => {
    const api = criarApiSimulada({ firefliesConectado: true });
    const f = api.ler();
    expect(app(api, "fireflies")).toMatchObject({ situacao: "conectado", conectorId: "sim-fireflies", niveis: { clarice: "leitura", ada: "nenhum", frida: "nenhum" } });
    expect(f.acessos["sim-fireflies"]?.padrao).toBe("nenhum");
    expect([...(f.acessos["sim-fireflies"]?.seguePadrao ?? [])]).toEqual(["frida", "cecilia", "dante"]);
  });

  it("o lote, o nível por bot e o padrão ficam guardados na memória", async () => {
    const api = criarApiSimulada({ firefliesConectado: true });
    const lote = api.aplicarLote("sim-fireflies", "escrita", ["clarice", "ada"], true);
    await vi.advanceTimersByTimeAsync(500);
    await lote;
    expect(app(api, "fireflies").niveis).toMatchObject({ clarice: "escrita", ada: "escrita" });
    api.definirNivel("frida", "sim-fireflies", "leitura");
    expect(app(api, "fireflies").niveis.frida).toBe("leitura");
    expect(api.ler().acessos["sim-fireflies"]?.seguePadrao.has("frida")).toBe(false);
    const padrao = api.definirPadrao("sim-fireflies", "leitura", false);
    await vi.advanceTimersByTimeAsync(500);
    await padrao;
    expect(api.ler().acessos["sim-fireflies"]?.padrao).toBe("leitura");
    expect(app(api, "fireflies").niveis).toMatchObject({ cecilia: "leitura", dante: "leitura" });
    // "Todos" com Ler não rebaixa quem tem Ler e alterar (a regra do servidor).
    const todos = api.aplicarLote("sim-fireflies", "leitura", "todos", false);
    await vi.advanceTimersByTimeAsync(500);
    await todos;
    expect(app(api, "fireflies").niveis.clarice).toBe("escrita");
    expect(BOTS_SIMULADOS.length).toBe(5);
  });
});

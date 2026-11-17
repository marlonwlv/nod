import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoOnboarding } from "../../../src/contracts/onboarding.ts";
import { saidaParaConta } from "../../../web/telas/conta-no-chat.ts";
import { criarTelaOnboarding, type DepsOnboarding } from "../../../web/telas/onboarding-controle.ts";
import { htmlEntrarNaConta, htmlExecutor } from "../../../web/telas/onboarding.ts";

/**
 * #78: quem já usa o nod noutro computador e abre pelo celular ou por outro navegador cai num espaço sem conta que a web
 * cria sozinha. A IA dos bots dele está no motor do outro computador, então a etapa "A IA dos seus bots" nunca fica
 * pronta; antes, a camada cobria a tela inteira só com "Instalar e entrar". Agora ela tem a saída "Entrar na sua conta".
 */
const semIa = {
  etapa: "executor",
  mostrar: true,
  passo: "bot",
  guia: { id: "g1", nome: "Nod", conversaId: "cg", forma: "shape-square", cor: "c-black" },
  executor: { pronto: false, ias: [{ id: "claude-cli", estado: "ausente" }, { id: "codex-cli", estado: "ausente" }] },
  campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null },
  modelo: { app: { slug: "gmail" } },
} as unknown as EstadoOnboarding;

const tela = (entrarNaConta: boolean, procurando = false) =>
  ({ dados: semIa, procurando, iaEntrando: null, notaIa: null, teste: null, iasMac: null, entrarNaConta });

describe("a saída 'Entrar na sua conta' na etapa da IA", () => {
  it("mantém o alvo de toque de 44 px mesmo com a regra posterior do contorno", () => {
    const css = readFileSync(new URL("../../../web/onboarding.css", import.meta.url), "utf8");
    const regra = (seletor: string): string => css.match(new RegExp(`${seletor.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    const especificidade = (seletor: string): number => seletor.match(/\./g)?.length ?? 0;
    const alvo = ".ob-outra-conta .ob-pilula.contorno";

    expect(regra(alvo)).toMatch(/height:\s*44px/);
    expect(especificidade(alvo)).toBeGreaterThan(especificidade(".ob-pilula.contorno"));
  });

  it("aparece na tela da IA do navegador, inclusive enquanto procura, só com entrarNaConta", () => {
    for (const procurando of [false, true]) {
      const h = htmlExecutor(tela(true, procurando));
      expect(h).toContain("A IA dos seus bots");
      expect(h).toContain("Já usa o nod em outro computador?");
      expect(h).toContain('data-act="onboarding-entrar-na-conta"');
      expect(h).toContain(">Entrar na sua conta<");
      expect(htmlExecutor(tela(false, procurando))).not.toContain("onboarding-entrar-na-conta");
    }
    expect(htmlEntrarNaConta({})).toBe("");
  });

  it("saidaParaConta: só na web, com contas, num espaço sem conta e sem equipe já lido", () => {
    const prov = { conta: null, legado: null };
    expect(saidaParaConta({ contas: true, noApp: false, estado: prov })).toBe(true);
    expect(saidaParaConta({ contas: true, noApp: true, estado: prov })).toBe(false);
    expect(saidaParaConta({ contas: false, noApp: false, estado: prov })).toBe(false);
    expect(saidaParaConta({ contas: true, noApp: false, estado: null })).toBe(false);
    expect(saidaParaConta({ contas: true, noApp: false, estado: { conta: { email: "x" }, legado: null } })).toBe(false);
    expect(saidaParaConta({ contas: true, noApp: false, estado: { conta: null, legado: { email: "x" } } })).toBe(false);
  });
});

describe("o clique em 'Entrar na sua conta' (controlador)", () => {
  const original = (globalThis as { window?: unknown }).window;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); (globalThis as { window?: unknown }).window = original; });

  function montar(disponivel: boolean, onboarding: () => Promise<EstadoOnboarding> = async () => semIa) {
    let aberto = true;
    const abrir = vi.fn((v: boolean) => { aberto = v; });
    const entrar = vi.fn();
    const concluir = vi.fn();
    const sondar = vi.fn(onboarding);
    const hidratar = vi.fn();
    const deps = {
      api: () => ({ etapaOnboarding: async () => semIa, onboarding: sondar, concluirOnboarding: concluir }),
      dados: () => semIa,
      aberto: () => aberto,
      hidratar,
      abrir,
      ligacao: { ativa: () => null, cheia: () => false, atenderOnboarding: () => false },
      garantirAgente: async () => true,
      irParaConversa: () => undefined,
      iniciarConexao: () => undefined,
      conectando: () => false,
      conectorHabilitado: async () => null,
      invalidar: () => undefined,
      erro: () => undefined,
      aoMudar: () => undefined,
      entrarNaConta: { disponivel: () => disponivel, entrar },
    } as unknown as DepsOnboarding;
    // Navegador comum: sem a ponte do app, sem o teste das IAs.
    (globalThis as { window?: unknown }).window = { nodDesktop: undefined, setTimeout, clearTimeout, setInterval, clearInterval };
    return { t: criarTelaOnboarding(deps), abrir, entrar, concluir, sondar, hidratar };
  }

  it("a camada da IA mostra a saída; o clique fecha a camada e abre o cartão de conta, sem concluir o onboarding", async () => {
    const m = montar(true);
    await m.t.acoes["onboarding-pular-ola"]!({ dataset: {} } as HTMLElement);
    const h = m.t.camada();
    expect(h).toContain("A IA dos seus bots");
    expect(h).toContain('data-act="onboarding-entrar-na-conta"');
    await m.t.acoes["onboarding-entrar-na-conta"]!({ dataset: {} } as HTMLElement);
    expect(m.abrir).toHaveBeenLastCalledWith(false);
    expect(m.entrar).toHaveBeenCalledOnce();
    expect(m.concluir).not.toHaveBeenCalled();
    expect(m.t.camada()).toBe("");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.sondar).not.toHaveBeenCalled();
  });

  it("ignora a resposta de uma sondagem que já estava em voo quando a pessoa sai", async () => {
    let responder: ((estado: EstadoOnboarding) => void) | undefined;
    const m = montar(true, () => new Promise((ok) => { responder = ok; }));
    await m.t.acoes["onboarding-pular-ola"]!({ dataset: {} } as HTMLElement);
    m.t.camada();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(m.sondar).toHaveBeenCalledOnce();

    await m.t.acoes["onboarding-entrar-na-conta"]!({ dataset: {} } as HTMLElement);
    responder?.(semIa);
    await Promise.resolve();
    expect(m.hidratar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.sondar).toHaveBeenCalledOnce();
  });

  it("com conta, na equipe ou no app (disponivel = false): sem saída e o clique não faz nada", async () => {
    const m = montar(false);
    await m.t.acoes["onboarding-pular-ola"]!({ dataset: {} } as HTMLElement);
    expect(m.t.camada()).not.toContain("onboarding-entrar-na-conta");
    await m.t.acoes["onboarding-entrar-na-conta"]!({ dataset: {} } as HTMLElement);
    expect(m.abrir).not.toHaveBeenCalledWith(false);
    expect(m.entrar).not.toHaveBeenCalled();
  });
});

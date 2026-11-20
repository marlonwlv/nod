import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BARRA_PADRAO, CHAVE_BARRA, CHAVE_DENSIDADE_ANTIGA, type Barra } from "../../../web/lib/densidade.ts";
import { cartaoAjusteBarra, gravarDecisao, lerDecisao, PREFIXO_DECISAO, versaoDasDecisoesDaBarra } from "../../../web/telas/card-barra.ts";
import { proximoDoSegmentado } from "../../../web/lib/linha-config.ts";
import { renderGeral, type DadosGeral } from "../../../web/telas/config-geral.ts";
import { CONFIG_UI_INICIAL } from "../../../web/estado/reducer.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";

const armazem = (inicial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const B = (larguraExpandida: number, compacta = false): Barra => ({ larguraExpandida, compacta });

describe("NOD-119: a borda da barra", () => {
  it("borda e etiqueta somem no celular (mobile.css)", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.borda-barra,\s*\.etiqueta-barra\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});

describe("ADR-179: Configurações › Aparência sem a escolha de densidade", () => {
  const d: DadosGeral = { tema: "claro", avisos: { onde: "mac", situacao: "ligados", som: true }, modoDev: false, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false } };
  it("a linha Barra lateral saiu, no computador e no celular", () => {
    for (const celular of [false, true]) {
      const html = renderGeral(d, CONFIG_UI_INICIAL, celular);
      expect(html).not.toContain("escolher-densidade");
      expect(html).not.toContain('aria-label="Barra lateral"');
    }
  });
  it("as setas giram no segmentado", () => {
    expect(proximoDoSegmentado(0, 2, "ArrowRight")).toBe(1);
    expect(proximoDoSegmentado(1, 2, "ArrowRight")).toBe(0);
    expect(proximoDoSegmentado(0, 2, "ArrowLeft")).toBe(1);
    expect(proximoDoSegmentado(1, 2, "Home")).toBe(0);
    expect(proximoDoSegmentado(0, 2, "End")).toBe(1);
    expect(proximoDoSegmentado(0, 2, "Tab")).toBeNull();
  });
});

describe("NOD-119 (C1): o card do chat", () => {
  const msg = (pedido: string, id = "m1"): Mensagem => ({ id, kind: "sistema", texto: "Deixar a barra lateral compacta?", payload: { kind: "ajuste_barra", pedido } } as unknown as Mensagem);

  it("pergunta, Antes → Depois, nota, o verbo e Agora não", () => {
    const html = cartaoAjusteBarra(msg("compacta"), { barra: BARRA_PADRAO, celular: false, decisao: null })!;
    expect(html).toContain('<p class="ab-titulo">Deixar a barra lateral compacta?</p>');
    expect(html).toMatch(/<span>340 px<\/span>.*→.*<b>Compacta, 240 px<\/b>/);
    expect(html).toContain('data-act="aplicar-barra" data-mensagem="m1" data-pedido="compacta">Compactar</button>');
    expect(html).toContain('data-act="recusar-barra"');
    expect(html).toContain(">Agora não<");
  });

  it("os verbos e o Depois de cada pedido", () => {
    expect(cartaoAjusteBarra(msg("so_avatares"), { barra: B(240), celular: false, decisao: null })).toMatch(/<b>Só avatares<\/b>.*>Recolher</);
    expect(cartaoAjusteBarra(msg("normal"), { barra: B(300, true), celular: false, decisao: null })).toMatch(/<b>300 px<\/b>.*>Voltar ao normal</);
  });

  it("no celular, sem o botão de aplicar", () => {
    const html = cartaoAjusteBarra(msg("compacta"), { barra: BARRA_PADRAO, celular: true, decisao: null })!;
    expect(html).not.toContain("aplicar-barra");
    expect(html).toContain("Abra no computador");
  });

  it("decidido vira uma linha; pedido estranho não vira botão", () => {
    expect(cartaoAjusteBarra(msg("compacta"), { barra: BARRA_PADRAO, celular: false, decisao: "aplicada" })).toContain("✓ Barra lateral compacta");
    expect(cartaoAjusteBarra(msg("so_avatares"), { barra: BARRA_PADRAO, celular: false, decisao: "aplicada" })).toContain("✓ Barra lateral só com avatares");
    expect(cartaoAjusteBarra(msg("normal"), { barra: BARRA_PADRAO, celular: false, decisao: "recusada" })).toContain("Barra lateral sem mudança");
    const estranho = cartaoAjusteBarra(msg("<img src=x>"), { barra: BARRA_PADRAO, celular: false, decisao: null })!;
    expect(estranho).not.toContain("<img");
    expect(estranho).not.toContain("aplicar-barra");
    expect(cartaoAjusteBarra({ ...msg("compacta"), payload: null } as unknown as Mensagem, { barra: BARRA_PADRAO, celular: false })).toBeNull();
  });

  it("sem decisão guardada (app do Mac reaberto, outro computador) e a barra já como o pedido: vira a linha feita", () => {
    expect(cartaoAjusteBarra(msg("compacta"), { barra: B(240), celular: false, decisao: null })).toContain("A barra lateral já está compacta");
    expect(cartaoAjusteBarra(msg("so_avatares"), { barra: B(340, true), celular: false, decisao: null })).toContain("A barra lateral já está só com avatares");
    expect(cartaoAjusteBarra(msg("normal"), { barra: BARRA_PADRAO, celular: false, decisao: null })).toContain("A barra lateral já está no normal");
    expect(cartaoAjusteBarra(msg("compacta"), { barra: B(240), celular: false, decisao: null })).not.toContain("✓");
    // A recusa guardada continua valendo mesmo que a barra tenha mudado por outro caminho.
    expect(cartaoAjusteBarra(msg("compacta"), { barra: B(240), celular: false, decisao: "recusada" })).toContain("sem mudança");
  });

  it("sem decisão no contexto, o card lê a decisão gravada (QA, mutante 12)", () => {
    const id = "m-lida";
    expect(cartaoAjusteBarra({ ...msg("compacta"), id }, { barra: BARRA_PADRAO, celular: false })).toContain("aplicar-barra");
    gravarDecisao(id, "aplicada", null);
    const html = cartaoAjusteBarra({ ...msg("compacta"), id }, { barra: BARRA_PADRAO, celular: false })!;
    expect(html).toContain("✓ Barra lateral compacta");
    expect(html).not.toContain("aplicar-barra");
  });

  it("a decisão fica neste computador e muda a versão do histórico lembrado", () => {
    const a = armazem();
    const antes = versaoDasDecisoesDaBarra();
    gravarDecisao("m9", "aplicada", a);
    expect(a.m.get(PREFIXO_DECISAO + "m9")).toBe("aplicada");
    expect(lerDecisao("m9", a)).toBe("aplicada");
    expect(lerDecisao("m9", armazem({ [PREFIXO_DECISAO + "m9"]: "outra" }))).toBeNull();
    expect(versaoDasDecisoesDaBarra()).toBe(antes + 1);
    // Sem armazenamento, a memória da página segura a decisão.
    gravarDecisao("m10", "recusada", { getItem: () => null, setItem: () => { throw new Error("cheio"); } });
    expect(cartaoAjusteBarra(msg("compacta", "m10"), { barra: BARRA_PADRAO, celular: false })).toContain("sem mudança");
  });
});

describe("NOD-119 (revisão 5)/ADR-179: o preload do app do Mac repõe as mesmas chaves que a web lê", () => {
  it("a chave nova, a antiga (a web migra) e o prefixo das decisões do card", () => {
    const preload = readFileSync(new URL("../../../desktop/preload-web.ts", import.meta.url), "utf8");
    expect(preload).toContain(`localStorage.setItem("${CHAVE_BARRA}", JSON.stringify(barra))`);
    expect(preload).toContain(`localStorage.removeItem("${CHAVE_BARRA}")`);
    expect(preload).toContain(`localStorage.setItem("${CHAVE_DENSIDADE_ANTIGA}", barra)`);
    expect(preload).toContain(`localStorage.setItem(\`${PREFIXO_DECISAO}\${id}\``);
  });
});

describe("NOD-119 (revisão 7): o arrasto só chega à conversa e ao Mac quando para", () => {
  it("adiar roda uma vez, com o último valor, depois da última chamada", async () => {
    const { vi } = await import("vitest");
    const { adiar } = await import("../../../web/lib/densidade.ts");
    vi.useFakeTimers();
    try {
      const vistos: string[] = [];
      const f = adiar<string>(250, (v) => vistos.push(v));
      f("a"); vi.advanceTimersByTime(100); f("b"); vi.advanceTimersByTime(100); f("c");
      expect(vistos).toEqual([]);
      vi.advanceTimersByTime(250);
      expect(vistos).toEqual(["c"]);
    } finally { vi.useRealTimers(); }
  });
  it("a conversa não depende da barra a cada passo, só da barra acompanhada", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).not.toMatch(/versaoDasDecisoesDaBarra\(\), serializar\(barraAtual\)/);
    expect(main.match(/versaoDasDecisoesDaBarra\(\), barraNaConversa/g)?.length).toBe(2);
  });
});

describe("NOD-119 (revisão 9): o clique vence o arrasto que ainda não gravou", () => {
  it("agora cancela o pendente: o valor velho não chega depois do novo", async () => {
    const { vi } = await import("vitest");
    const { adiar } = await import("../../../web/lib/densidade.ts");
    vi.useFakeTimers();
    try {
      const gravados: string[] = [];
      const gravar = adiar<string>(250, (v) => gravados.push(v));
      gravar("arrasto");
      gravar.agora("card");
      vi.advanceTimersByTime(1000);
      expect(gravados).toEqual(["card"]);
    } finally { vi.useRealTimers(); }
  });
  it("o caminho imediato do main.ts passa pelo agora (não chama definirBarra direto)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/naHora \? gravarNoMac\.agora : gravarNoMac/);
    expect(main.match(/definirBarra\?\.\(/g)?.length).toBe(1);
  });
});

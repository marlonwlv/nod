// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DURACAO_AVISO_LOTE_MS, fecharAvisoDesfazer, mostrarAvisoDesfazer } from "../../../web/lib/aviso-desfazer.ts";
import { buscarAjustes } from "../../../web/lib/ajustes.ts";
import { itensDaPaleta, subDoPausarTodas } from "../../../web/lib/paleta.ts";
import { quandoDoLote } from "../../../web/telas/agenda-rotinas.ts";

/**
 * Desfazer a pausa em lote (protótipo aprovado no Paper, 2026-11-19): o ⌘K diz quantas vai pausar, o aviso de 15 s mostra
 * o tempo, pausa com o mouse em cima e tem ×, e a busca das Configurações acha onde voltar.
 */
describe("desfazer a pausa em lote na web", () => {
  afterEach(() => {
    fecharAvisoDesfazer();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("o ⌘K diz quantas rotinas o Pausar todas vai pausar e que dá para desfazer", () => {
    expect(subDoPausarTodas(38)).toBe("Pausa as 38 ativas · dá para desfazer");
    expect(subDoPausarTodas(1)).toBe("Pausa a única ativa · dá para desfazer");
    expect(subDoPausarTodas(0)).toBe("Nenhuma rotina ativa agora");
    const item = itensDaPaleta({ bots: [], trabalhos: [], mod: "⌘", atuais: { modo: "Manual", temaEscuro: false, rotinasAtivas: 38 } }).find((i) => i.chave === "acao:pausar-rotinas");
    expect(item?.sub).toBe("Pausa as 38 ativas · dá para desfazer");
  });

  it("a busca das Configurações acha as rotinas pausadas por pausadas, reativar e desfazer", () => {
    for (const termo of ["pausadas", "reativar", "desfazer"]) expect(buscarAjustes(termo).map((a) => a.id), termo).toContain("rotinas-pausadas");
  });

  it("a hora do lote: hoje, ontem ou o dia curto", () => {
    const em = new Date(2026, 10, 19, 9, 36).getTime();
    expect(quandoDoLote(em, "2026-11-19")).toBe("Hoje às 09:36");
    expect(quandoDoLote(em, "2026-11-20")).toBe("Ontem às 09:36");
    expect(quandoDoLote(em, "2026-11-25")).toMatch(/^\S+ 19 às 09:36$/);
  });

  it("o aviso da pausa em lote dura 15 s, mostra os segundos e a barra, e o Desfazer chama a volta", () => {
    vi.useFakeTimers();
    const desfez = vi.fn();
    const el = mostrarAvisoDesfazer({ texto: "38 rotinas pausadas", ms: DURACAO_AVISO_LOTE_MS, contagem: true, fechar: true, aoDesfazer: desfez });
    expect(DURACAO_AVISO_LOTE_MS).toBe(15_000);
    expect(el.querySelector(".nl-aviso-seg")?.textContent).toBe("· 15 s");
    vi.advanceTimersByTime(3_000);
    expect(el.querySelector(".nl-aviso-seg")?.textContent).toBe("· 12 s");
    expect(el.querySelector<HTMLElement>(".nl-aviso-tempo")?.style.transform).toBe("scaleX(0.8)");
    el.querySelector<HTMLButtonElement>(".nl-desfazer-acao")!.click();
    expect(desfez).toHaveBeenCalledTimes(1);
    expect(document.body.contains(el)).toBe(false);
  });

  it("com o mouse em cima a contagem para; saindo, ela segue de onde parou", () => {
    vi.useFakeTimers();
    const el = mostrarAvisoDesfazer({ texto: "38 rotinas pausadas", ms: DURACAO_AVISO_LOTE_MS, contagem: true, fechar: true, aoDesfazer: () => {} });
    vi.advanceTimersByTime(5_000);
    el.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(60_000);
    expect(document.body.contains(el)).toBe(true);
    expect(el.querySelector(".nl-aviso-seg")?.textContent).toBe("· 10 s");
    el.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(9_000);
    expect(document.body.contains(el)).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(document.body.contains(el)).toBe(false);
  });

  it("o × e o Esc fecham sem desfazer", () => {
    const desfez = vi.fn();
    const a = mostrarAvisoDesfazer({ texto: "38 rotinas pausadas", ms: DURACAO_AVISO_LOTE_MS, contagem: true, fechar: true, aoDesfazer: desfez });
    expect(a.querySelector(".nl-aviso-fechar")?.getAttribute("aria-label")).toBe("Fechar o aviso");
    a.querySelector<HTMLButtonElement>(".nl-aviso-fechar")!.click();
    expect(document.body.contains(a)).toBe(false);
    const b = mostrarAvisoDesfazer({ texto: "38 rotinas pausadas", ms: DURACAO_AVISO_LOTE_MS, contagem: true, fechar: true, aoDesfazer: desfez });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.contains(b)).toBe(false);
    expect(desfez).not.toHaveBeenCalled();
  });

  it("o aviso de sempre (sem contagem) não ganha segundos, barra nem ×", () => {
    const el = mostrarAvisoDesfazer({ texto: "Conversa lida", aoDesfazer: () => {} });
    expect(el.querySelector(".nl-aviso-seg")).toBeNull();
    expect(el.querySelector(".nl-aviso-tempo")).toBeNull();
    expect(el.querySelector(".nl-aviso-fechar")).toBeNull();
  });
});

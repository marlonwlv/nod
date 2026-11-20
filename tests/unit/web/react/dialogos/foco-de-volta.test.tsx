import { afterEach, describe, expect, it, vi } from "vitest";
import { devolverFocoQuandoPuder } from "../../../../../web/telas/foco-de-volta.ts";

/** QA-162: o foco volta ao botão do Testar agora quando ele reabilitar (ou ao que a tela redesenhou no lugar dele). */
describe("devolverFocoQuandoPuder", () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });
  const botao = (): HTMLButtonElement => {
    document.body.innerHTML = `<button data-act="executar-rotina" data-id="r1">Testar agora</button><button id="outro">outro</button>`;
    return document.querySelector<HTMLButtonElement>("[data-act]")!;
  };

  it("espera o botão desligado reabilitar e leva o foco a ele", () => {
    vi.useFakeTimers();
    const b = botao();
    b.disabled = true;
    devolverFocoQuandoPuder(b);
    expect(document.activeElement).toBe(document.body);
    b.disabled = false;
    vi.advanceTimersByTime(60);
    expect(document.activeElement).toBe(b);
  });

  it("a tela por string redesenhou: o foco vai ao botão novo, pelo data-act e data-id", () => {
    vi.useFakeTimers();
    const b = botao();
    b.disabled = true;
    devolverFocoQuandoPuder(b);
    document.body.innerHTML = `<button data-act="executar-rotina" data-id="r2">outra</button><button data-act="executar-rotina" data-id="r1">Testar agora</button>`;
    vi.advanceTimersByTime(60);
    expect(document.activeElement?.getAttribute("data-id")).toBe("r1");
  });

  it("outro controle pegou o foco (a conversa abriu): não mexe; e desiste depois do prazo", () => {
    vi.useFakeTimers();
    const b = botao();
    b.disabled = true;
    devolverFocoQuandoPuder(b, 500);
    document.getElementById("outro")!.focus();
    b.disabled = false;
    vi.advanceTimersByTime(100);
    expect(document.activeElement?.id).toBe("outro");
    const c = botao();
    c.disabled = true;
    devolverFocoQuandoPuder(c, 200);
    vi.advanceTimersByTime(400);
    c.disabled = false;
    vi.advanceTimersByTime(400);
    expect(document.activeElement).toBe(document.body);
  });
});

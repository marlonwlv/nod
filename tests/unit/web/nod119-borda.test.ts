import { describe, expect, it } from "vitest";
import { dadosDaPrevia, ligarBorda, ligarEtiqueta, MS_PREVIA, textoDaEtiqueta } from "../../../web/lib/borda-barra.ts";
import type { Barra } from "../../../web/lib/densidade.ts";

/** NOD-119/ADR-179: o puxador e a etiqueta usam tipos de DOM, então quem checa este arquivo é o tsconfig.web.json. */
const B = (larguraExpandida: number, compacta = false): Barra => ({ larguraExpandida, compacta });

describe("ADR-179: o puxador da barra (DOM)", () => {
  class Elemento extends EventTarget {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    classList = { add: (c: string) => void this.classes.add(c), remove: (c: string) => void this.classes.delete(c) };
    setAttribute(n: string, v: string) { this.attrs.set(n, v); }
    getAttribute(n: string) { return this.attrs.get(n) ?? null; }
    setPointerCapture() {}
    releasePointerCapture() {}
  }
  const evento = (tipo: string, extra: Record<string, unknown>) => Object.assign(new Event(tipo, { cancelable: true }), extra);
  const relogio = { setTimeout: (() => 0) as unknown as typeof setTimeout, clearTimeout: (() => undefined) as typeof clearTimeout };
  const montar = (inicial: Barra, janela = 1440, painel = 0) => {
    const borda = new Elemento();
    let atual = inicial;
    const pintadas: Barra[] = [];
    const gravadas: Barra[] = [];
    ligarBorda(borda as unknown as HTMLElement, {
      obter: () => atual,
      medidas: () => ({ janela, painel }),
      pintar: (b) => { atual = b; pintadas.push(b); },
      gravar: (b) => { atual = b; gravadas.push(b); },
    }, relogio);
    return { borda, pintadas, gravadas, atual: () => atual };
  };

  it("o aria em px: valor, mínimo 88 e o máximo da janela", () => {
    const { borda } = montar(B(300), 1100, 360);
    expect(borda.getAttribute("aria-valuenow")).toBe("300");
    expect(borda.getAttribute("aria-valuemin")).toBe("88");
    expect(borda.getAttribute("aria-valuemax")).toBe("316");
    expect(borda.getAttribute("aria-valuetext")).toBe("300 px");
  });

  it("← → gravam 16 px; duplo clique não faz nada", () => {
    const m = montar(B(340));
    const tecla = evento("keydown", { key: "ArrowLeft" });
    m.borda.dispatchEvent(tecla);
    expect(tecla.defaultPrevented).toBe(true);
    expect(m.atual()).toEqual(B(324));
    m.borda.dispatchEvent(evento("keydown", { key: "ArrowRight" }));
    expect(m.atual()).toEqual(B(340));
    m.borda.dispatchEvent(evento("keydown", { key: "Enter" }));
    m.borda.dispatchEvent(evento("dblclick", {}));
    expect(m.gravadas).toEqual([B(324), B(340)]);
  });

  it("o arrasto pinta ao vivo, 1:1, para no máximo, recolhe abaixo de 208 e só grava ao soltar", () => {
    const m = montar(B(340));
    m.borda.dispatchEvent(evento("pointerdown", { button: 0, clientX: 343, pointerId: 1 }));
    expect(m.borda.classes.has("arrastando")).toBe(true);
    m.borda.dispatchEvent(evento("pointermove", { clientX: 303, pointerId: 1 }));
    expect(m.atual()).toEqual(B(300));
    m.borda.dispatchEvent(evento("pointermove", { clientX: 900, pointerId: 1 }));
    expect(m.atual()).toEqual(B(400));
    // Outro ponteiro não arrasta.
    m.borda.dispatchEvent(evento("pointermove", { clientX: 0, pointerId: 2 }));
    expect(m.atual()).toEqual(B(400));
    m.borda.dispatchEvent(evento("pointermove", { clientX: 150, pointerId: 1 }));
    expect(m.atual()).toEqual(B(340, true));
    expect(m.borda.classes.has("encaixando")).toBe(true);
    expect(m.gravadas).toEqual([]);
    m.borda.dispatchEvent(evento("pointerup", { pointerId: 1 }));
    expect(m.borda.classes.has("arrastando")).toBe(false);
    expect(m.gravadas).toEqual([B(340, true)]);
    m.borda.dispatchEvent(evento("pointermove", { clientX: 300, pointerId: 1 }));
    expect(m.atual()).toEqual(B(340, true));
  });

  it("a compacta reabre a partir de 216 e segue o ponteiro", () => {
    const m = montar(B(340, true));
    m.borda.dispatchEvent(evento("pointerdown", { button: 0, clientX: 88, pointerId: 1 }));
    m.borda.dispatchEvent(evento("pointermove", { clientX: 215, pointerId: 1 }));
    expect(m.atual()).toEqual(B(340, true));
    m.borda.dispatchEvent(evento("pointermove", { clientX: 216, pointerId: 1 }));
    expect(m.atual()).toEqual(B(240));
    m.borda.dispatchEvent(evento("pointermove", { clientX: 280, pointerId: 1 }));
    expect(m.atual()).toEqual(B(280));
    m.borda.dispatchEvent(evento("pointerup", { pointerId: 1 }));
    expect(m.gravadas).toEqual([B(280)]);
  });

  it("soltar sem mudar não grava", () => {
    const m = montar(B(340));
    m.borda.dispatchEvent(evento("pointerdown", { button: 0, clientX: 340, pointerId: 1 }));
    m.borda.dispatchEvent(evento("pointerup", { pointerId: 1 }));
    expect(m.gravadas).toEqual([]);
  });

  it("a prévia é só dos bots: nome e a última mensagem da linha", () => {
    const el = (a: Record<string, string>, ultima?: string) => ({
      getAttribute: (n: string) => a[n] ?? null,
      querySelector: () => (ultima === undefined ? null : { textContent: ` ${ultima} ` }),
    }) as unknown as Element;
    expect(dadosDaPrevia(el({ "data-act": "abrir-conversa", "data-etiqueta": "Ada · PM" }, "Fechei o plano"))).toEqual({ nome: "Ada · PM", ultima: "Fechei o plano" });
    expect(dadosDaPrevia(el({ "data-act": "abrir-conversa", "data-etiqueta": "Ada · PM" }))).toEqual({ nome: "Ada · PM", ultima: "" });
    expect(dadosDaPrevia(el({ "data-act": "navegar", "aria-label": "Tarefas" }))).toBeNull();
    expect(MS_PREVIA).toBe(280);
  });

  it("a etiqueta lê data-etiqueta e, nos botões, o aria-label", () => {
    const el = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null }) as unknown as Element;
    expect(textoDaEtiqueta(el({ "data-etiqueta": " Ada · PM ", "aria-label": "x" }))).toBe("Ada · PM");
    expect(textoDaEtiqueta(el({ "aria-label": "Buscar" }))).toBe("Buscar");
    expect(textoDaEtiqueta(el({}))).toBe("");
  });


  it("Esc com o foco na barra só esconde a etiqueta; com a etiqueta do mouse, esconde e o Esc segue (composer, menu)", () => {
    const doc = new EventTarget();
    const dentro = new EventTarget();
    const sidebar = Object.assign(new EventTarget(), { ownerDocument: doc, contains: (n: unknown) => n === dentro });
    const etiqueta = { hidden: false, textContent: "", style: {} } as unknown as HTMLElement;
    ligarEtiqueta(sidebar as unknown as HTMLElement, etiqueta, () => true);
    let outro = 0;
    doc.addEventListener("keydown", () => { outro++; });
    const doFoco = evento("keydown", { key: "Escape" });
    Object.defineProperty(doFoco, "target", { value: dentro });
    doc.dispatchEvent(doFoco);
    expect(etiqueta.hidden).toBe(true);
    expect(doFoco.defaultPrevented).toBe(true);
    expect(outro).toBe(0);
    // Etiqueta do mouse, Esc no composer (fora da barra): esconde e segue.
    (etiqueta as { hidden: boolean }).hidden = false;
    const doComposer = evento("keydown", { key: "Escape" });
    doc.dispatchEvent(doComposer);
    expect(etiqueta.hidden).toBe(true);
    expect(doComposer.defaultPrevented).toBe(false);
    expect(outro).toBe(1);
    // Com a etiqueta escondida, o Esc segue para os outros.
    doc.dispatchEvent(evento("keydown", { key: "Escape" }));
    expect(outro).toBe(2);
  });
});

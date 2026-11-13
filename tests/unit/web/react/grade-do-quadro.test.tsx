import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confiar, quadro, type Card, type Coluna } from "../../../../web/telas/quadro.ts";
import { criarGradeNaTela, itensDaGrade, type GradeNaTela } from "../../../../web/react/quadro/grade-na-tela.tsx";
import type { AcoesDaGrade } from "../../../../web/react/quadro/grade-do-quadro.tsx";

/**
 * ADR-180 (fase 2 do React): a grade do quadro. O que importa: o mesmo DOM de antes (seções, cards, ids), o card que não
 * mudou não é redesenhado (o mesmo nó), o "Mover para…" do Base UI e o arrasto levando à mesma `soltar` do quadro.
 */
const cardDe = (id: string, titulo: string, extra: Partial<Card> = {}): Card => ({ id, titulo, codigo: id.toUpperCase(), arrastavel: true, ...extra });
const colunaDe = (status: string, nome: string, cartoes: Card[]): Coluna => ({ status, nome, recolhivel: true, n: cartoes.length, cartoes, cards: [] });

function acoesFalsas(): AcoesDaGrade & { soltar: ReturnType<typeof vi.fn>; arrastando: ReturnType<typeof vi.fn> } {
  return {
    soltar: vi.fn(),
    arrastando: vi.fn(),
    dica: () => "Começa com Ada",
    destinos: () => [{ id: "feito", nome: "Feito", nota: null, icone: confiar("") }, { id: "revisao", nome: "Em revisão", nota: "Começa com Ada", icone: confiar("") }],
  };
}

describe("grade do quadro em React", () => {
  let conteudo: HTMLElement;
  let grade: GradeNaTela;
  let acoes: ReturnType<typeof acoesFalsas>;
  const desenhar = (colunas: Coluna[]) => {
    act(() => {
      conteudo.innerHTML = `<p>barra</p>${grade.desenhar({ colunas, rotulo: "Quadro de Ada", classe: "qd-so-largo", extras: [{ html: confiar('<button type="button" class="qd-col-novo-bt">+</button>'), trilha: "var(--qd-tira)" }] })}`;
      grade.encaixar(conteudo);
    });
  };
  beforeEach(() => {
    document.body.innerHTML = '<section id="quadro"><div class="qd-conteudo"></div></section>';
    conteudo = document.querySelector<HTMLElement>(".qd-conteudo")!;
    acoes = acoesFalsas();
    grade = criarGradeNaTela(document, acoes);
  });
  afterEach(() => act(() => grade.desmontar()));

  it("desenha as colunas e os cards com o mesmo DOM do quadro por string", () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Escrever ADR")]), colunaDe("feito", "Feito", [])]);
    const secoes = [...conteudo.querySelectorAll<HTMLElement>("section.qd-col[data-coluna]")].map((s) => s.dataset["coluna"]);
    expect(secoes).toEqual(["afazer", "feito"]);
    const li = conteudo.querySelector<HTMLElement>('li.qd-card[data-tarefa="t1"]')!;
    expect(li.dataset["rxArrasta"]).toBe("1");
    expect(li.querySelector(".qd-card-tit")?.textContent).toBe("Escrever ADR");
    expect(conteudo.querySelector(".qd-col-novo-bt")).toBeTruthy();
    // A trilha da grade é a mesma do quadro() por string.
    const porString = document.createElement("div");
    porString.innerHTML = quadro({ colunas: [colunaDe("afazer", "A fazer", []), colunaDe("feito", "Feito", [])], extras: [{ html: confiar(""), trilha: "var(--qd-tira)" }] });
    expect(conteudo.querySelector<HTMLElement>(".qd-grade")!.style.gridTemplateColumns).toBe(porString.querySelector<HTMLElement>(".qd-grade")!.style.gridTemplateColumns);
  });

  it("o frame seguinte recria a .qd-conteudo, mas a grade e o card que não mudou ficam (o mesmo nó)", () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Um"), cardDe("t2", "Dois")])]);
    const um = conteudo.querySelector('li[data-tarefa="t1"] .rx-qd-corpo');
    const dois = conteudo.querySelector('li[data-tarefa="t2"] .rx-qd-corpo');
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Um"), cardDe("t2", "Dois, editado")])]);
    expect(conteudo.querySelector('li[data-tarefa="t1"] .rx-qd-corpo')).toBe(um);
    expect(conteudo.querySelector('li[data-tarefa="t2"] .rx-qd-corpo')).toBe(dois);
    expect(dois?.textContent).toContain("Dois, editado");
    expect(conteudo.querySelectorAll("li.qd-card")).toHaveLength(2);
  });

  it("o card que muda de coluna segue sendo um card só (key pelo id da tarefa)", () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Um")]), colunaDe("feito", "Feito", [])]);
    desenhar([colunaDe("afazer", "A fazer", []), colunaDe("feito", "Feito", [cardDe("t1", "Um")])]);
    expect(conteudo.querySelectorAll('li[data-tarefa="t1"]')).toHaveLength(1);
    expect(conteudo.querySelector('section[data-coluna="feito"] li[data-tarefa="t1"]')).toBeTruthy();
  });

  it("Mover para… abre o menu do Base UI com os destinos e solta pela mesma ação do arrasto", async () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Escrever ADR")])]);
    const bt = screen.getByRole("button", { name: "Mover Escrever ADR para…" });
    await act(async () => { fireEvent.click(bt); });
    const item = await screen.findByRole("menuitem", { name: /Em revisão/ });
    expect(item.textContent).toContain("Começa com Ada");
    await act(async () => { fireEvent.click(item); });
    expect(acoes.soltar).toHaveBeenCalledWith("t1", "revisao");
  });

  it("card que não arrasta não tem o Mover para… nem a marca de arrasto", () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Só leitura", { arrastavel: false })])]);
    expect(conteudo.querySelector('li[data-tarefa="t1"]')?.hasAttribute("data-rx-arrasta")).toBe(false);
    expect(screen.queryByRole("button", { name: /Mover/ })).toBeNull();
  });

  it("coluna recolhida é só a tira", () => {
    desenhar([{ ...colunaDe("feito", "Feito", [cardDe("t1", "Um")]), recolhida: true }]);
    const s = conteudo.querySelector<HTMLElement>('section[data-coluna="feito"]')!;
    expect(s.classList.contains("qd-col-recolhida")).toBe(true);
    expect(s.querySelector(".qd-col-tira")).toBeTruthy();
    expect(s.querySelector("li.qd-card")).toBeNull();
  });

  it("os extras entram na posição pedida, como no quadro() por string", () => {
    const cols = [colunaDe("a", "A", []), colunaDe("b", "B", [])];
    const extras = [{ html: confiar("x"), trilha: "1px", em: 1 }, { html: confiar("y"), trilha: "2px" }];
    const { itens, trilhas } = itensDaGrade(cols, extras);
    expect(itens.map((i) => (i.tipo === "coluna" ? i.coluna.partes.id : i.html))).toEqual(["a", "x", "b", "y"]);
    expect(quadro({ colunas: cols, extras })).toContain(`grid-template-columns: ${trilhas}"`);
  });

  it("nenhum data-act vem do React (os que existem são do HTML do card, delegados pelo quadro-na-tela)", () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Um")])]);
    const li = conteudo.querySelector('li[data-tarefa="t1"]')!;
    expect(li.hasAttribute("data-act")).toBe(false);
    expect(li.querySelector('[data-act="abrir-tarefa"]')).toBeTruthy();
  });
  it("arrastar o card (ponteiro) até outra coluna leva à mesma soltar, com a dica e só o card arrastado no overlay", async () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Um"), cardDe("t2", "Dois")]), colunaDe("revisao", "Em revisão", [])]);
    // happy-dom não faz layout: cada coluna ganha uma caixa de 200 px lado a lado, e cada card a da coluna dele.
    const caixa = (x: number) => ({ x, y: 0, left: x, top: 0, right: x + 200, bottom: 600, width: 200, height: 600, toJSON: () => ({}) }) as DOMRect;
    const xDe = (el: Element) => (el.closest('[data-coluna="revisao"]') ? 220 : 0);
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) { return caixa(xDe(this)); };
    try {
      const li = conteudo.querySelector<HTMLElement>('li[data-tarefa="t1"]')!;
      const ev = (tipo: string, x: number, alvo: EventTarget) => fireEvent(alvo as Element, new PointerEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: 50, isPrimary: true, button: 0, buttons: tipo === "pointerup" ? 0 : 1 }));
      await act(async () => { ev("pointerdown", 20, li); });
      await act(async () => { ev("pointermove", 120, document); });
      await act(async () => { ev("pointermove", 300, document); });
      expect(acoes.arrastando).toHaveBeenCalledWith(true);
      expect(grade.arrastando()).toBe(true);
      expect(conteudo.querySelector('section[data-coluna="revisao"]')?.classList.contains("qd-alvo")).toBe(true);
      expect(conteudo.querySelector(".qd-dica-soltar")?.textContent).toBe("Começa com Ada");
      expect(document.querySelectorAll(".rx-qd-flutuante")).toHaveLength(1);
      expect(conteudo.querySelectorAll("li.qd-card")).toHaveLength(2);
      await act(async () => { ev("pointerup", 300, document); });
      expect(acoes.soltar).toHaveBeenCalledWith("t1", "revisao");
      expect(grade.arrastando()).toBe(false);
      expect(document.querySelector(".rx-qd-flutuante")).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = orig;
    }
  });

  it("apertar no campo de dentro do card não começa arrasto", async () => {
    desenhar([colunaDe("afazer", "A fazer", [cardDe("t1", "Um", { responder: 500, motivo: "falta acesso" })])]);
    const campo = conteudo.querySelector<HTMLElement>('li[data-tarefa="t1"] textarea');
    expect(campo).toBeTruthy();
    await act(async () => { fireEvent(campo!, new PointerEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5, isPrimary: true, button: 0, buttons: 1 })); });
    await act(async () => { fireEvent(document as never, new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 5, buttons: 1 })); });
    expect(acoes.arrastando).not.toHaveBeenCalled();
  });
});

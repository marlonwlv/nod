// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { criarSugestoesDaNovaConversa } from "../../../web/lib/sugestao-nova-conversa.ts";

/** QA-155: a escolha feita com ↑ ↓ no "Para:" da nova conversa sobrevive ao redesenho da tela. */
function pop(ids: string[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "nc-pop";
  el.innerHTML = ids.map((id) => `<button class="nc-bot" data-agente="${id}"></button>`).join("") + `<button class="nc-criar"><span class="nc-termo"></span></button>`;
  return el;
}
const marcado = (p: HTMLElement): string | undefined => p.querySelector<HTMLElement>(".nc-bot[data-nc-atual]")?.dataset.agente;

describe("o ↵ da nova conversa", () => {
  it("o bot escolhido com ↓ continua marcado depois de um redesenho com o mesmo termo", () => {
    const s = criarSugestoesDaNovaConversa();
    let p = pop(["a", "b", "c"]);
    s.marcar(p, "");
    expect(marcado(p)).toBe("a");
    expect(s.mover(p, 1)).toBe(true);
    expect(marcado(p)).toBe("b");
    s.marcar(p, ""); // o React refaz o filtro depois de um frame (outro bot mudou de prévia)
    expect(marcado(p)).toBe("b");
    p = pop(["z", "a", "b", "c"]); // a casca por string é regravada inteira e um bot novo chegou antes
    s.marcar(p, "");
    expect(marcado(p)).toBe("b");
  });

  it("termo novo, bot que some ou que sai dos 5 mostrados voltam ao primeiro", () => {
    const s = criarSugestoesDaNovaConversa();
    const p = pop(["a", "b", "c", "d", "e", "f", "g"]);
    s.marcar(p, "");
    s.mover(p, -1); // ↑ do primeiro dá a volta até o 5º mostrado
    expect(marcado(p)).toBe("e");
    s.marcar(p, "x");
    expect(marcado(p)).toBe("a");
    s.mover(p, 1);
    p.querySelector<HTMLElement>('[data-agente="b"]')!.hidden = true;
    s.marcar(p, "x");
    expect(marcado(p)).toBe("a");
    expect([...p.querySelectorAll(".nc-bot:not([hidden])")].length).toBe(4); // o filtro do main desesconde antes; aqui b segue escondido
    expect(p.querySelector(".nc-termo")!.textContent).toBe("x");
    expect(p.querySelector(".nc-criar")!.hasAttribute("hidden")).toBe(false);
  });

  it("sem bot mostrado as setas não fazem nada", () => {
    const s = criarSugestoesDaNovaConversa();
    const p = pop([]);
    s.marcar(p, "");
    expect(s.mover(p, 1)).toBe(false);
    expect(p.querySelector(".nc-criar")!.hasAttribute("hidden")).toBe(true);
  });
});

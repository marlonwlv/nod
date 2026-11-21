// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { umEnvioPorVez } from "../../../../web/lib/envio-unico.ts";

// QA-186: duplo clique no Conceder dos Conectores avançados mandava dois POSTs; o segundo voltava 409 por cima do sucesso.
function formulario(id = "c1"): HTMLFormElement {
  document.body.innerHTML = `<form data-id="${id}"><select name="capacidade"><option>x</option></select><button type="submit">Conceder</button></form>`;
  return document.querySelector("form")!;
}

describe("umEnvioPorVez", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("o segundo envio do mesmo formulário, com o primeiro ainda correndo, não chama a API", async () => {
    const form = formulario();
    let chamadas = 0;
    let soltar!: () => void;
    const api = () => { chamadas++; return new Promise<void>((ok) => { soltar = ok; }); };
    const a = umEnvioPorVez("conceder", form, api);
    const b = umEnvioPorVez("conceder", form, api);
    await b;
    expect(chamadas).toBe(1);
    expect(form.querySelector("button")!.disabled).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");
    soltar();
    await a;
    expect(form.querySelector("button")!.disabled).toBe(false);
    expect(form.hasAttribute("aria-busy")).toBe(false);
  });

  it("vale pela chave: o formulário redesenhado no meio do envio também não manda de novo", async () => {
    const velho = formulario();
    let chamadas = 0;
    let soltar!: () => void;
    const api = () => { chamadas++; return new Promise<void>((ok) => { soltar = ok; }); };
    const a = umEnvioPorVez("conceder", velho, api);
    const novo = formulario();
    await umEnvioPorVez("conceder", novo, api);
    expect(chamadas).toBe(1);
    soltar();
    await a;
    await umEnvioPorVez("conceder", novo, async () => { chamadas++; });
    expect(chamadas).toBe(2);
  });

  it("formulários de conectores diferentes enviam em paralelo, e um erro solta a trava", async () => {
    let chamadas = 0;
    const f1 = formulario("c1");
    await expect(umEnvioPorVez("conceder", f1, async () => { chamadas++; throw new Error("409"); })).rejects.toThrow("409");
    const f2 = document.createElement("form"); f2.dataset.id = "c2"; document.body.append(f2);
    await Promise.all([umEnvioPorVez("conceder", f1, async () => { chamadas++; }), umEnvioPorVez("conceder", f2, async () => { chamadas++; })]);
    expect(chamadas).toBe(3);
    expect(f1.querySelector("button")!.disabled).toBe(false);
  });
});

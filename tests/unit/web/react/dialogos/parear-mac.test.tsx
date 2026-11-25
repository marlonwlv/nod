import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { abrirPareamentoNoReact } from "../../../../../web/react/dialogos/parear-mac.tsx";

/** ADR-179 (item 4): "Conectar este Mac?" pelo Base UI — o conteúdo do nativo, o botão desligado no pedido, o erro e o fechar. */
const ESPERADO = `<h2 id="parear-titulo">Conectar este Mac?</h2><p>O app do nod em <b>MacBook &lt;do Marlon&gt;</b> vai trabalhar pela sua conta: seus bots rodam nele, com o Claude Code ou o Codex desse Mac.</p><p>Só confirme se foi você quem clicou em <b>Entrar com Google</b> no app agora.</p><p class="dialogo-erro" data-estado="" role="status"></p><div class="acoes"><button class="bt" data-nao="" type="button">Agora não</button> <button class="bt pri" data-sim="" type="button">Conectar este Mac</button></div>`;
function normalizar(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  for (const n of d.querySelectorAll('button[tabindex="0"]')) n.removeAttribute("tabindex");
  for (const e of d.querySelectorAll("*")) {
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return d.innerHTML.replace(/>\s+</g, "><").replace(/> </g, "><");
}

describe("Conectar este Mac pelo Base UI", () => {
  it("o conteúdo é o do nativo; Conectar desliga no pedido e, se falhar, diz por quê e volta", async () => {
    document.body.innerHTML = "";
    let falhar: (e: Error) => void = () => undefined;
    const conectar = vi.fn(() => new Promise<void>((_, rej) => { falhar = rej; }));
    abrirPareamentoNoReact(document, { nome: "MacBook <do Marlon>", conectar, aoFechar: vi.fn() });
    await waitFor(() => expect(document.querySelector(".bot-dialogo.rx-dlg")).toBeTruthy());
    expect(normalizar(document.querySelector(".bot-dialogo.rx-dlg")!.innerHTML)).toBe(normalizar(ESPERADO));
    const sim = document.querySelector<HTMLButtonElement>("[data-sim]")!;
    act(() => { fireEvent.click(sim); });
    expect(conectar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sim.disabled).toBe(true));
    await act(async () => { falhar(new Error("x")); });
    await waitFor(() => expect(document.querySelector("[data-estado]")?.textContent).toContain("Não foi possível conectar"));
    expect(sim.disabled).toBe(false);
  });

  it("Agora não fecha e avisa quem abriu", async () => {
    document.body.innerHTML = "";
    const aoFechar = vi.fn();
    abrirPareamentoNoReact(document, { nome: "Mac", conectar: vi.fn(async () => undefined), aoFechar });
    await waitFor(() => expect(document.querySelector("[data-nao]")).toBeTruthy());
    act(() => { fireEvent.click(document.querySelector("[data-nao]")!); });
    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1));
  });
});

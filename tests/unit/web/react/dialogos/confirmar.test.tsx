import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { htmlRodarMaisUma, TITULO_JA_NA_FILA } from "../../../../../web/lib/executar-rotina.ts";
import { confirmarNoReact } from "../../../../../web/react/dialogos/confirmar.tsx";
import { avisarTermosNoReact } from "../../../../../web/react/dialogos/aviso-termos.tsx";
import { htmlDoAvisoDosTermos } from "../../../../../web/telas/aviso-termos.ts";

/** ADR-179 (item 4): a confirmação (bot-dialogo) pelo Dialog do Base UI — o conteúdo do nativo, true só pela ação. */
const PERGUNTA = "Já há uma execução de «Resumo dos PRs» na fila (agendada para 08:00). Rodar mais uma agora?";
const abrir = (origem?: HTMLElement) => confirmarNoReact(document, { idDoTitulo: "rodar-mais-uma-titulo", titulo: TITULO_JA_NA_FILA, texto: PERGUNTA, cancelar: "Cancelar", confirmar: "Rodar mais uma", origem: origem ?? null });

function normalizar(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  for (const n of d.querySelectorAll("[autofocus]")) n.removeAttribute("autofocus");
  // O Dialog.Close do Base UI põe tabindex="0" no botão (botão já é focável: nada muda para quem usa).
  for (const n of d.querySelectorAll('button[tabindex="0"]')) n.removeAttribute("tabindex");
  for (const e of d.querySelectorAll("*")) {
    const attrs = [...e.attributes].map((x) => [x.name, x.value] as const).sort(([x], [y]) => x.localeCompare(y));
    for (const [n] of attrs) e.removeAttribute(n);
    for (const [n, v] of attrs) e.setAttribute(n, v);
  }
  return d.innerHTML.replace(/>\s+</g, "><").replace(/> </g, "><");
}

describe("a confirmação pelo Base UI", () => {
  it("o conteúdo é o do diálogo nativo; o foco abre em Cancelar; a ação responde true", async () => {
    document.body.innerHTML = "";
    const r = abrir();
    await waitFor(() => expect(document.querySelector(".bot-dialogo.rx-dlg")).toBeTruthy());
    const popup = document.querySelector(".bot-dialogo.rx-dlg")!;
    expect(normalizar(popup.innerHTML)).toBe(normalizar(htmlRodarMaisUma(PERGUNTA)));
    expect(popup.getAttribute("aria-labelledby")).toBe("rodar-mais-uma-titulo");
    await waitFor(() => expect(document.activeElement?.hasAttribute("data-nao")).toBe(true));
    act(() => { fireEvent.click(document.querySelector("[data-sim]")!); });
    await expect(r).resolves.toBe(true);
  });

  it("Cancelar e Esc respondem false", async () => {
    document.body.innerHTML = "";
    const r1 = abrir();
    await waitFor(() => expect(document.querySelector("[data-nao]")).toBeTruthy());
    act(() => { fireEvent.click(document.querySelector("[data-nao]")!); });
    await expect(r1).resolves.toBe(false);
    const r2 = abrir();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
    await expect(r2).resolves.toBe(false);
  });

  it("o aviso dos termos: o mesmo conteúdo do nativo (texto, links, o caminho seguro como principal); Ligar mesmo assim responde true", async () => {
    // Jornadas da IA (Paper G3): com a conta que entra na fila, ela vai no topo e o principal é "Deixar fora da fila".
    for (const [ia, conta] of [["claude-cli", undefined], ["codex-cli", undefined], ["claude-cli", { nome: "Pessoal", ordem: 2 }]] as const) {
      document.body.innerHTML = "";
      const r = avisarTermosNoReact(document, ia, conta);
      await waitFor(() => expect(document.querySelector(".termos-dialogo.rx-dlg")).toBeTruthy());
      expect(normalizar(document.querySelector(".termos-dialogo.rx-dlg")!.innerHTML)).toBe(normalizar(htmlDoAvisoDosTermos(ia, conta)));
      expect(document.querySelector(".termos-dialogo.rx-dlg")!.getAttribute("aria-labelledby")).toBe("aviso-termos-titulo");
      await waitFor(() => expect(document.activeElement?.hasAttribute("data-nao")).toBe(true));
      act(() => { fireEvent.click(document.querySelector("[data-sim]")!); });
      await expect(r).resolves.toBe(true);
    }
  });

  it("o aviso dos termos: o caminho seguro responde false", async () => {
    document.body.innerHTML = "";
    const r = avisarTermosNoReact(document, "claude-cli", { nome: "Pessoal", ordem: 2 });
    await waitFor(() => expect(document.querySelector("[data-nao]")?.textContent).toBe("Deixar fora da fila"));
    act(() => { fireEvent.click(document.querySelector("[data-nao]")!); });
    await expect(r).resolves.toBe(false);
  });
});

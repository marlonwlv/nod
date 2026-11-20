import { htmlRodarMaisUma } from "../lib/executar-rotina.ts";
import { devolverFocoQuandoPuder } from "./foco-de-volta.ts";

/**
 * definido em 2026-10-16 (revisão do Gil no #335, A1): abre a pergunta do "Testar agora" (`htmlRodarMaisUma`).
 * true = "Rodar mais uma"; Esc, Cancelar e clique fora = false. Ao fechar, o foco volta para quem abriu, assim que
 * ele reabilitar (QA-162: o `ocupado` o desliga enquanto pergunta).
 */
export function abrirRodarMaisUma(pergunta: string, origem?: HTMLElement | null): Promise<boolean> {
  return new Promise((resolver) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bot-dialogo";
    dialog.setAttribute("aria-labelledby", "rodar-mais-uma-titulo");
    dialog.innerHTML = htmlRodarMaisUma(pergunta);
    document.body.append(dialog);
    let sim = false;
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolver(sim);
      if (origem) devolverFocoQuandoPuder(origem);
    }, { once: true });
    dialog.querySelector("[data-sim]")!.addEventListener("click", () => { sim = true; dialog.close(); });
    dialog.querySelector("[data-nao]")!.addEventListener("click", () => dialog.close());
    // Clique no fundo (fora da caixa): o alvo é o próprio <dialog>.
    dialog.addEventListener("click", (ev) => { if (ev.target === dialog) dialog.close(); });
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-nao]")!.focus();
  });
}

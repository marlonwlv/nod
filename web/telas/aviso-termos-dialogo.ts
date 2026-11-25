import type { IaDesktop } from "../../src/contracts/desktop.ts";
import { htmlDoAvisoDosTermos, type ContaNoAviso } from "./aviso-termos.ts";

/** Abre o aviso; true = "Ligar mesmo assim". Esc, Cancelar e fechar = false. */
export function abrirAvisoDosTermos(ia: IaDesktop, conta?: ContaNoAviso): Promise<boolean> {
  return new Promise((resolver) => {
    const dialog = document.createElement("dialog");
    dialog.className = "termos-dialogo";
    dialog.setAttribute("aria-labelledby", "aviso-termos-titulo");
    dialog.innerHTML = htmlDoAvisoDosTermos(ia, conta);
    // Clicar fora (no véu) também deixa fora da fila.
    dialog.addEventListener("click", (ev) => { if (ev.target === dialog) dialog.close(); });
    document.body.append(dialog);
    let sim = false;
    dialog.addEventListener("close", () => { dialog.remove(); resolver(sim); }, { once: true });
    dialog.querySelector("[data-sim]")!.addEventListener("click", () => { sim = true; dialog.close(); });
    dialog.querySelector("[data-nao]")!.addEventListener("click", () => dialog.close());
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-nao]")!.focus();
  });
}

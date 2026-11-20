/**
 * ADR-188 (Paper "E · Depois do clique", momento 3): o aviso de quando o nod volta de uma atualização. Entra subindo,
 * fica 6 s (o mouse em cima segura) e sai descendo. Centralizado sobre a conversa (a barra lateral fica de fora), logo
 * acima do campo. "Novidades" leva a Configurações › Sobre o nod. O HTML mora em aviso-atualizado-html.ts (sem DOM).
 */
import { DURACAO_AVISO_ATUALIZADO_MS, htmlAvisoAtualizado } from "./aviso-atualizado-html.ts";

export { DURACAO_AVISO_ATUALIZADO_MS, htmlAvisoAtualizado };
const SAIDA_MS = 200;

let atual: HTMLElement | null = null;

export function mostrarAvisoAtualizado(o: { versao: string; aoNovidades: () => void }): HTMLElement {
  atual?.remove();
  const el = document.createElement("div");
  el.className = "atz-aviso";
  el.setAttribute("role", "status");
  el.innerHTML = htmlAvisoAtualizado(o.versao);
  let timer = 0;
  const fechar = () => {
    window.clearTimeout(timer);
    if (!el.isConnected || el.classList.contains("atz-aviso-sai")) return;
    el.classList.add("atz-aviso-sai");
    window.setTimeout(() => { el.remove(); if (atual === el) atual = null; }, SAIDA_MS);
  };
  const armar = () => { window.clearTimeout(timer); timer = window.setTimeout(fechar, DURACAO_AVISO_ATUALIZADO_MS); };
  el.querySelector("[data-novidades]")?.addEventListener("click", () => { fechar(); o.aoNovidades(); });
  // Lendo com o mouse em cima, não some; ao sair, conta de novo.
  el.addEventListener("pointerenter", () => window.clearTimeout(timer));
  el.addEventListener("pointerleave", armar);
  document.body.appendChild(el);
  atual = el;
  armar();
  return el;
}

/**
 * ADR-188 (Paper "E · Depois do clique", momento 3): o aviso de quando o nod volta de uma atualização — o check verde,
 * "nod atualizado para a x.y.z" e a pílula "Novidades". Entra subindo, fica 6 s (o mouse em cima segura) e sai
 * descendo. Centralizado sobre a conversa (a barra lateral fica de fora), logo acima do campo. "Novidades" leva a
 * Configurações › Sobre o nod, onde as notas da versão vão morar quando o feed as mandar.
 */
import { esc } from "./render.ts";

export const DURACAO_AVISO_ATUALIZADO_MS = 6_000;
const SAIDA_MS = 200;
const IC_CHECK = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="currentColor"/><path d="M5.6 9.2 7.8 11.3 12.4 6.7" fill="none" stroke="var(--on-status)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function htmlAvisoAtualizado(versao: string): string {
  return `<span class="atz-aviso-ic">${IC_CHECK}</span><span class="atz-aviso-txt">nod atualizado para a <b>${esc(versao)}</b></span><button type="button" class="atz-aviso-bt" data-novidades>Novidades</button>`;
}

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

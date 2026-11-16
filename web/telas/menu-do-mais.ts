import { esc } from "../lib/render.ts";
import { dialogo } from "./gestao-agentes.ts";

/**
 * O menu "Novo" do + da barra (clique, Enter/Espaço e clique direito): "Novo bot" (⌘N) e "Novo chat em grupo" (⇧⌘N).
 * No computador ele nasce ancorado no +; no celular (`folha`) sobe da base com o título "Novo" e itens de 44 px.
 * O segurar do + continua criando o bot na hora e o ⌘N continua indo direto ao diálogo "Criar novo bot".
 */
export type EscolhaDoMais = "novo-bot" | "nova-sala";

export const IC_MAIS_MENU = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
export const IC_PESSOAS_MENU = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="5.5" r="2.2"/><path d="M2 13c.5-2 2-3 4-3s3.5 1 4 3"/><circle cx="11.5" cy="6" r="1.8"/><path d="M11 10c1.6 0 2.7.9 3 2.5"/></svg>';

/** O corpo do menu. No celular os atalhos de teclado não aparecem (não há teclado) e entra o título "Novo". */
export function htmlMenuDoMais(o: { atalhoBot: string; atalhoGrupo: string; folha: boolean }): string {
  const item = (acao: EscolhaDoMais, icone: string, texto: string, meta: string) =>
    `<button type="button" role="menuitem" data-mais="${acao}">${icone}<span>${texto}</span>${meta && !o.folha ? `<span class="mc-meta" aria-hidden="true">${esc(meta)}</span>` : ""}</button>`;
  return `${o.folha ? '<p class="menu-nome" aria-hidden="true">Novo</p>' : ""}<div role="menu" aria-label="Novo">${item("novo-bot", IC_MAIS_MENU, "Novo bot", o.atalhoBot)}${item("nova-sala", IC_PESSOAS_MENU, "Novo chat em grupo", o.atalhoGrupo)}</div>`;
}

/** Setas, Home e End entre os itens do menu (o mesmo andar do menu ⋯ da fala). Devolve true se a tecla foi tratada. */
export function andarNoMenu(e: KeyboardEvent, itens: readonly HTMLElement[]): boolean {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || !itens.length) return false;
  e.preventDefault();
  const atual = itens.indexOf(document.activeElement as HTMLElement);
  const passo = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + passo + itens.length) % itens.length;
  itens[proximo]?.focus();
  return true;
}

/**
 * Abre o menu. `ponto` (clique direito) põe o menu onde o cursor está; sem ele, logo abaixo do +. O + ganha
 * aria-expanded enquanto o menu está aberto e, fechado sem escolha (Esc ou clique fora), o foco volta a ele.
 */
export function abrirMenuDoMais(
  ancora: HTMLElement,
  o: { atalhoBot: string; atalhoGrupo: string; folha: boolean; escolher: (qual: EscolhaDoMais) => void; ponto?: { x: number; y: number } },
): HTMLDialogElement {
  const d = dialogo(htmlMenuDoMais(o), true);
  d.classList.add("menu-mais");
  if (o.folha) d.classList.add("folha");
  d.setAttribute("aria-label", "Novo");
  ancora.setAttribute("aria-expanded", "true");
  if (!o.folha) {
    const r = ancora.getBoundingClientRect();
    const x = o.ponto ? o.ponto.x + 4 : r.left;
    const y = o.ponto ? o.ponto.y + 4 : r.bottom + 6;
    d.style.left = `${Math.max(12, Math.min(x, window.innerWidth - d.offsetWidth - 12))}px`;
    d.style.top = `${Math.max(12, Math.min(y, window.innerHeight - d.offsetHeight - 12))}px`;
  }
  let escolha: EscolhaDoMais | null = null;
  d.addEventListener("click", (e) => {
    const qual = (e.target as HTMLElement).closest<HTMLElement>("[data-mais]")?.dataset.mais;
    if (qual !== "novo-bot" && qual !== "nova-sala") return;
    escolha = qual;
    d.close();
  });
  d.addEventListener("keydown", (e) => { andarNoMenu(e, [...d.querySelectorAll<HTMLElement>('[role="menuitem"]')]); });
  d.addEventListener("close", () => {
    ancora.setAttribute("aria-expanded", "false");
    if (escolha) { o.escolher(escolha); return; }
    if (ancora.isConnected && (document.activeElement === document.body || !document.activeElement || d.contains(document.activeElement))) ancora.focus();
  });
  d.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  return d;
}

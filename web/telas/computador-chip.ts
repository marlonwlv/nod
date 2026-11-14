import { htmlCartaoDestino } from "../lib/computador-conversa.ts";

/**
 * D · Computador do bot (item 1): o cartão flutuante "Destino do link" do chip [Computador](nod-computador:). Fica acima
 * do chip, alinhado à esquerda dele, a 6 px; Esc ou clique fora fecha e o foco volta ao chip. Um cartão por vez.
 */
let aberto: { cartao: HTMLElement; chip: HTMLElement; desligar: () => void } | null = null;

export function fecharCartaoDestino(devolverFoco = true): void {
  if (!aberto) return;
  const { cartao, chip, desligar } = aberto;
  aberto = null;
  desligar();
  cartao.remove();
  chip.setAttribute("aria-expanded", "false");
  if (devolverFoco && chip.isConnected) chip.focus({ preventScroll: true });
}

export function abrirCartaoDestino(chip: HTMLElement, bot: { id: string; nome: string }): void {
  const mesmo = aberto?.chip === chip;
  fecharCartaoDestino(false);
  if (mesmo) return;
  const cartao = document.createElement("div");
  cartao.className = "cc-cartao";
  cartao.setAttribute("role", "dialog");
  cartao.setAttribute("aria-label", "Destino do link");
  cartao.innerHTML = htmlCartaoDestino(bot);
  document.body.append(cartao);
  posicionar(cartao, chip);
  chip.setAttribute("aria-expanded", "true");
  const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); fecharCartaoDestino(); } };
  const fora = (ev: PointerEvent) => { const alvo = ev.target as Node; if (!cartao.contains(alvo) && !chip.contains(alvo)) fecharCartaoDestino(false); };
  // A conversa rola por baixo: o cartão acompanharia um chip que saiu do lugar, então fecha.
  const rolou = (ev: Event) => { if (!cartao.contains(ev.target as Node)) fecharCartaoDestino(false); };
  document.addEventListener("keydown", tecla, true);
  document.addEventListener("pointerdown", fora, true);
  window.addEventListener("scroll", rolou, true);
  window.addEventListener("resize", rolou);
  aberto = { cartao, chip, desligar: () => { document.removeEventListener("keydown", tecla, true); document.removeEventListener("pointerdown", fora, true); window.removeEventListener("scroll", rolou, true); window.removeEventListener("resize", rolou); } };
  cartao.querySelector<HTMLElement>(".cc-cartao-linha")?.focus({ preventScroll: true });
}

/** Acima do chip (6 px), alinhado à esquerda dele; sem espaço em cima, abaixo. Nunca sai da janela pela direita. */
function posicionar(cartao: HTMLElement, chip: HTMLElement): void {
  const r = chip.getBoundingClientRect();
  const h = cartao.offsetHeight;
  const w = cartao.offsetWidth;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const top = r.top - 6 - h >= 8 ? r.top - 6 - h : r.bottom + 6;
  cartao.style.left = `${Math.round(left)}px`;
  cartao.style.top = `${Math.round(top)}px`;
}

/**
 * "Mostrar no painel direito": abre o painel de detalhes do bot (quem abre é o `abrirPainel` de main.ts, o mesmo caminho
 * da pílula) e rola até a seção Computador (`#gv-computador-<bot>`, web/telas/detalhes.ts). Se a aba à vista não é a
 * Atividade (onde a seção mora), troca para ela antes.
 */
export function mostrarComputadorNoPainel(agenteId: string, abrirPainel: () => void): void {
  fecharCartaoDestino(false);
  abrirPainel();
  let tentativas = 0;
  const rolar = () => {
    const secao = document.getElementById(`gv-computador-${agenteId}`);
    if (secao) {
      secao.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      secao.querySelector<HTMLElement>('[role="button"], button')?.focus({ preventScroll: true });
      return;
    }
    if (tentativas === 0) document.querySelector<HTMLElement>('#detalhes [data-act="gaveta-aba"][data-aba="detalhes"]')?.click();
    if (++tentativas < 10) requestAnimationFrame(rolar);
  };
  requestAnimationFrame(rolar);
}

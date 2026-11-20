import { esc } from "./render.ts";

/**
 * NOD-449 (protótipo aprovado, passo "Lida, com Desfazer"): o aviso no pé da tela depois de marcar como lido — uma frase
 * e Desfazer. Sai sozinho em alguns segundos; um aviso novo toma o lugar do anterior (o Desfazer vale para o último).
 * No celular, fica acima da barra de baixo (o CSS cuida). `role="status"`: o leitor de tela anuncia sem roubar o foco.
 */

export const DURACAO_AVISO_MS = 6000;
/**
 * Definido em 2026-11-02 (revisão 6 do #626): o aviso só com a frase (a recusa das páginas, ~130 caracteres) quebra a linha
 * e fica 12 s, o dobro do com Desfazer: a 390 px a frase ocupa até três linhas e precisa ser lida inteira.
 */
export const DURACAO_AVISO_FRASE_MS = 12_000;

/**
 * Desfazer a pausa em lote (protótipo aprovado no Paper, 2026-11-19): o aviso de uma ação em lote dura 15 s e MOSTRA o
 * tempo — os segundos no texto e uma barra de 2 px que esvazia na base — porque o Desfazer é a volta mais curta para um
 * clique sem querer. Mouse ou foco do teclado em cima pausa a contagem (quem lê devagar ou navega por teclado não perde
 * o Desfazer). O × e o Esc fecham sem desfazer.
 */
export const DURACAO_AVISO_LOTE_MS = 15_000;

let atual: { el: HTMLElement; parar: () => void } | null = null;

export function fecharAvisoDesfazer(): void {
  if (!atual) return;
  atual.parar();
  atual.el.remove();
  atual = null;
}

/**
 * `abrir` (ADA-2 F5): um botão antes do Desfazer que leva ao que acabou de nascer ("Tarefa criada · Abrir · Desfazer").
 * Sem `aoDesfazer`, o mesmo aviso neutro só com a frase (QA do #626: a recusa das páginas, sem o vermelho do erro); essa
 * variante (`nl-aviso-frase`) quebra a linha e dura DURACAO_AVISO_FRASE_MS (revisão 6).
 * `contagem` (pausa em lote): mostra o tempo que falta e pausa com mouse/foco em cima. `fechar`: o × depois do Desfazer.
 */
export function mostrarAvisoDesfazer(o: { texto: string; aoDesfazer?: () => void | Promise<void>; abrir?: { rotulo: string; aoAbrir: () => void }; ms?: number; contagem?: boolean; fechar?: boolean }): HTMLElement {
  fecharAvisoDesfazer();
  const el = document.createElement("div");
  const aoDesfazer = o.aoDesfazer;
  const abrir = o.abrir;
  const duracao = o.ms ?? (aoDesfazer || abrir ? DURACAO_AVISO_MS : DURACAO_AVISO_FRASE_MS);
  el.className = aoDesfazer || abrir ? "nl-aviso" : "nl-aviso nl-aviso-frase";
  if (o.contagem) el.classList.add("nl-aviso-contagem");
  el.setAttribute("role", "status");
  const segundos = o.contagem ? ` <span class="nl-aviso-seg" aria-hidden="true">· ${Math.ceil(duracao / 1000)} s</span>` : "";
  el.innerHTML = `<span>${esc(o.texto)}${segundos}</span>${abrir ? `<button type="button" class="nl-desfazer nl-aviso-abrir">${esc(abrir.rotulo)}</button>` : ""}${aoDesfazer ? '<button type="button" class="nl-desfazer nl-desfazer-acao">Desfazer</button>' : ""}${o.fechar ? '<button type="button" class="nl-aviso-fechar" aria-label="Fechar o aviso"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>' : ""}${o.contagem ? '<i class="nl-aviso-tempo" aria-hidden="true"></i>' : ""}`;
  el.querySelector(".nl-aviso-abrir")?.addEventListener("click", () => {
    fecharAvisoDesfazer();
    abrir?.aoAbrir();
  });
  el.querySelector(".nl-desfazer-acao")?.addEventListener("click", () => {
    fecharAvisoDesfazer();
    if (aoDesfazer) void aoDesfazer();
  });
  el.querySelector(".nl-aviso-fechar")?.addEventListener("click", () => fecharAvisoDesfazer());
  document.body.appendChild(el);

  // O relógio do aviso: conta o que falta e para enquanto o mouse ou o foco estão nele (só com `contagem`).
  let resta = duracao;
  let desde = Date.now();
  let pausado = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tique: ReturnType<typeof setInterval> | null = null;
  const seg = o.contagem ? el.querySelector<HTMLElement>(".nl-aviso-seg") : null;
  const barra = o.contagem ? el.querySelector<HTMLElement>(".nl-aviso-tempo") : null;
  const pintar = (): void => {
    const falta = pausado ? resta : Math.max(0, resta - (Date.now() - desde));
    if (seg) seg.textContent = `· ${Math.max(1, Math.ceil(falta / 1000))} s`;
    if (barra) barra.style.transform = `scaleX(${falta / duracao})`;
  };
  const armar = (): void => {
    desde = Date.now();
    timer = setTimeout(() => { if (atual?.el === el) fecharAvisoDesfazer(); }, resta);
    if (o.contagem) tique = setInterval(pintar, 250);
  };
  const desarmar = (): void => {
    if (timer) clearTimeout(timer);
    if (tique) clearInterval(tique);
    timer = null;
    tique = null;
  };
  const pausar = (): void => {
    if (pausado) return;
    resta = Math.max(0, resta - (Date.now() - desde));
    pausado = true;
    desarmar();
    pintar();
  };
  const seguir = (): void => {
    if (!pausado || el.matches(":hover") || el.contains(document.activeElement)) return;
    pausado = false;
    armar();
  };
  const aoTeclar = (e: KeyboardEvent): void => { if (e.key === "Escape" && atual?.el === el) fecharAvisoDesfazer(); };
  if (o.contagem) {
    el.addEventListener("mouseenter", pausar);
    el.addEventListener("focusin", pausar);
    el.addEventListener("mouseleave", () => setTimeout(seguir, 0));
    el.addEventListener("focusout", () => setTimeout(seguir, 0));
  }
  if (o.fechar) document.addEventListener("keydown", aoTeclar);
  armar();
  pintar();
  atual = { el, parar: () => { desarmar(); if (o.fechar) document.removeEventListener("keydown", aoTeclar); } };
  return el;
}

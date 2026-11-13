/**
 * ADR-179: o puxador da barra lateral e a prévia da compacta. O puxador é um separador focável de 12 px, centrado na
 * borda, invisível, que mora fora do #sidebar (regravado por innerHTML). O arrasto é ao vivo e 1:1 (sem animação, sem
 * elástico acima do máximo); abaixo de 208 recolhe para 88 e a compacta reabre a partir de 216 (web/lib/densidade.ts).
 * Grava só ao soltar. ← e → mudam 16 px. Duplo clique não faz nada.
 * Na compacta, o mouse num bot abre, depois de 280 ms, um cartão de prévia à direita (nome e a última mensagem); nos
 * outros botões e no foco, a etiqueta curta de sempre. Esc a esconde.
 */
import { arrasto, barraPelaTecla, iguais, LARGURA_COMPACTA, maximo, pxDaBarra, rotuloDaLargura, type Barra } from "./densidade.ts";

export { barraPelaTecla };

type Medidas = { janela: number; painel: number };

/** O aria do puxador para a largura atual, em px. */
export function atualizarBorda(borda: HTMLElement, b: Barra, m: Medidas = { janela: Infinity, painel: 0 }): void {
  borda.setAttribute("aria-valuenow", String(pxDaBarra(b, m.janela, m.painel)));
  borda.setAttribute("aria-valuemin", String(LARGURA_COMPACTA));
  borda.setAttribute("aria-valuemax", String(maximo(m.janela, m.painel)));
  borda.setAttribute("aria-valuetext", rotuloDaLargura(b, m.janela, m.painel));
}

type Controle = {
  obter(): Barra;
  /** A janela e o painel da direita agora (o máximo da barra). */
  medidas(): Medidas;
  /** Pinta ao vivo, sem gravar (o arrasto). */
  pintar(b: Barra): void;
  /** Pinta e grava (ao soltar e nas teclas). */
  gravar(b: Barra): void;
};

/** Quanto dura a animação de recolher/reabrir no meio do arrasto (a mesma do ⌘B). */
export const MS_ENCAIXE = 200;

export function ligarBorda(borda: HTMLElement, c: Controle, relogio: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis): void {
  atualizarBorda(borda, c.obter(), c.medidas());
  borda.addEventListener("keydown", (ev) => {
    const m = c.medidas();
    const prox = barraPelaTecla(c.obter(), ev.key, m.janela, m.painel);
    if (!prox) return;
    ev.preventDefault();
    if (!iguais(prox, c.obter())) c.gravar(prox);
  });
  // Duplo clique: nada (nem restaurar, nem recolher).
  borda.addEventListener("dblclick", (ev) => { ev.preventDefault(); });
  let inicio: { deslocamento: number; barra: Barra; id: number } | null = null;
  let encaixe: ReturnType<typeof setTimeout> | undefined;
  borda.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const b = c.obter();
    const m = c.medidas();
    // 1:1: a largura segue o ponteiro com a mesma folga de quando o botão desceu (até 6 px de cada lado da borda).
    inicio = { deslocamento: ev.clientX - pxDaBarra(b, m.janela, m.painel), barra: b, id: ev.pointerId };
    borda.setPointerCapture?.(ev.pointerId);
    borda.classList.add("arrastando");
  });
  borda.addEventListener("pointermove", (ev) => {
    if (!inicio || ev.pointerId !== inicio.id) return;
    const m = c.medidas();
    const atual = c.obter();
    const alvo = arrasto(ev.clientX - inicio.deslocamento, inicio.barra, atual, m.janela, m.painel);
    if (iguais(alvo, atual)) return;
    // Recolher ou reabrir no meio do arrasto anima (a barra vai até 88 com o botão ainda apertado); o resto é seco.
    if (alvo.compacta !== atual.compacta) {
      borda.classList.add("encaixando");
      if (encaixe !== undefined) relogio.clearTimeout(encaixe);
      encaixe = relogio.setTimeout(() => { encaixe = undefined; borda.classList.remove("encaixando"); }, MS_ENCAIXE);
    }
    c.pintar(alvo);
    atualizarBorda(borda, alvo, m);
  });
  const soltar = (ev: PointerEvent) => {
    if (!inicio || ev.pointerId !== inicio.id) return;
    const mudou = !iguais(inicio.barra, c.obter());
    inicio = null;
    borda.releasePointerCapture?.(ev.pointerId);
    borda.classList.remove("arrastando");
    if (mudou) c.gravar(c.obter());
  };
  borda.addEventListener("pointerup", soltar);
  borda.addEventListener("pointercancel", soltar);
}

/** O texto da etiqueta: o `data-etiqueta` do item (nome · título) ou, nos botões do topo e do rodapé, o aria-label. */
export function textoDaEtiqueta(el: Element): string {
  return (el.getAttribute("data-etiqueta") ?? el.getAttribute("aria-label") ?? "").trim();
}

/** O que a prévia de um bot mostra: o nome (o de antes do " · título") e a última mensagem, lidos da própria linha. */
export function dadosDaPrevia(el: Element): { nome: string; ultima: string } | null {
  if (el.getAttribute("data-act") !== "abrir-conversa") return null;
  const completo = textoDaEtiqueta(el);
  if (!completo) return null;
  const ultima = el.querySelector(".txt > span:not(.nome-linha)")?.textContent?.trim() ?? "";
  return { nome: completo, ultima };
}

/** Quanto o mouse para num bot da compacta antes de a prévia abrir. */
export const MS_PREVIA = 280;

const ALVOS = "[data-etiqueta], button[aria-label]";

/**
 * A etiqueta e a prévia: só com `ativa()` (a barra compacta); um elemento só, fora do #sidebar. O mouse num bot abre a
 * prévia depois de MS_PREVIA; nos outros botões, e no foco, a etiqueta curta aparece na hora.
 */
export function ligarEtiqueta(sidebar: HTMLElement, etiqueta: HTMLElement, ativa: () => boolean, teclas?: (el: Element) => string[] | null, relogio: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis): { esconder(): void } {
  let alvo: Element | null = null;
  let espera: ReturnType<typeof setTimeout> | undefined;
  const cancelar = () => { if (espera !== undefined) relogio.clearTimeout(espera); espera = undefined; };
  const esconder = () => {
    cancelar();
    alvo = null;
    etiqueta.hidden = true;
    etiqueta.classList?.remove("previa-barra");
    etiqueta.removeAttribute?.("role");
    etiqueta.removeAttribute?.("aria-label");
    etiqueta.setAttribute?.("aria-hidden", "true");
  };
  const doc = () => etiqueta.ownerDocument;
  const mostrarEtiqueta = (el: Element) => {
    const texto = textoDaEtiqueta(el);
    if (!texto || !ativa()) return esconder();
    alvo = el;
    etiqueta.classList?.remove("previa-barra");
    etiqueta.textContent = texto;
    // Paper 03 (rodada 3): o atalho do bot ao lado do nome, em caixinhas ("Gil · UI/UX ⌘ 4").
    const ks = teclas?.(el);
    if (ks?.length) {
      const grupo = doc().createElement("span");
      grupo.className = "etiqueta-teclas";
      grupo.setAttribute("aria-hidden", "true");
      for (const k of ks) { const kbd = doc().createElement("kbd"); kbd.className = "ds-kbd"; kbd.textContent = k; grupo.append(kbd); }
      etiqueta.append(grupo);
    }
    const r = el.getBoundingClientRect();
    etiqueta.style.top = `${Math.round(r.top + r.height / 2)}px`;
    etiqueta.style.left = `${Math.round(r.right + 8)}px`;
    etiqueta.hidden = false;
  };
  const mostrarPrevia = (el: Element) => {
    const dados = dadosDaPrevia(el);
    if (!dados || !ativa()) return esconder();
    alvo = el;
    const d = doc();
    etiqueta.textContent = "";
    etiqueta.classList.add("previa-barra");
    etiqueta.removeAttribute("aria-hidden");
    etiqueta.setAttribute("role", "tooltip");
    etiqueta.setAttribute("aria-label", `Prévia do chat de ${dados.nome.split(" · ")[0]}`);
    const topo = d.createElement("span");
    topo.className = "previa-topo";
    const icone = el.querySelector(".icon");
    if (icone) { const mini = icone.cloneNode(true) as HTMLElement; mini.classList.add("previa-av"); mini.setAttribute("aria-hidden", "true"); topo.append(mini); }
    const nome = d.createElement("b");
    nome.className = "previa-nome";
    nome.textContent = dados.nome;
    topo.append(nome);
    etiqueta.append(topo);
    if (dados.ultima) { const p = d.createElement("span"); p.className = "previa-ultima"; p.textContent = dados.ultima; etiqueta.append(p); }
    const r = el.getBoundingClientRect();
    etiqueta.style.top = `${Math.round(r.top)}px`;
    etiqueta.style.left = `${Math.round(r.right + 8)}px`;
    etiqueta.hidden = false;
  };
  const alvoDe = (t: EventTarget | null) => (t instanceof Element ? t.closest(ALVOS) : null);
  sidebar.addEventListener("pointerover", (ev) => {
    const el = alvoDe(ev.target);
    if (!el || !sidebar.contains(el) || el === alvo) return;
    esconder();
    if (!ativa()) return;
    if (dadosDaPrevia(el)) { alvo = el; espera = relogio.setTimeout(() => { espera = undefined; mostrarPrevia(el); }, MS_PREVIA); }
    else mostrarEtiqueta(el);
  });
  sidebar.addEventListener("pointerout", (ev) => { if (!alvo) return; const para = ev.relatedTarget; if (!(para instanceof Node) || !alvo.contains(para)) esconder(); });
  sidebar.addEventListener("focusin", (ev) => { const el = alvoDe(ev.target); esconder(); if (el && sidebar.contains(el)) mostrarEtiqueta(el); });
  sidebar.addEventListener("focusout", () => esconder());
  // Esc com o foco na barra só esconde a etiqueta: não fecha a task nem o que mais ouve Esc na página.
  sidebar.ownerDocument.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || etiqueta.hidden) return;
    // Só engole o Esc quando a etiqueta veio do foco na barra; a do mouse some e o Esc segue para o composer ou o menu.
    const doFoco = sidebar.contains(ev.target as Node | null);
    esconder();
    if (!doFoco) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);
  return { esconder };
}

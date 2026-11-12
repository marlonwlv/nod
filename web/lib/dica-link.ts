import { lerLink, partesDoEndereco } from "./links.ts";

/** COP-14 (item 4): no balão do bot, a prévia do link aparece depois de 500 ms de mouse parado em cima dele. */
export const ATRASO_PREVIA_MS = 500;
/** Onde o link mostra a prévia (globo, endereço e ↗) em vez da dica de duas linhas. */
const BALAO_DO_BOT = ".message.bot .bubble";

const GLOBO = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="M1.5 6h9M6 1.5c1.6 1.4 1.6 7.6 0 9M6 1.5c-1.6 1.4-1.6 7.6 0 9"/></svg>';

/**
 * O endereço que a prévia mostra: o href inteiro sem "https://" (o "http://" fica, porque avisa que não é seguro) e sem
 * a barra solta da raiz. O corte com reticências é do CSS (máx. 320 px). null = não é link que abre (ADR-053).
 */
export function enderecoDaPrevia(href: string): string | null {
  const url = lerLink(href);
  if (!url) return null;
  const texto = url.href.replace(/^https:\/\//, "");
  return url.pathname === "/" && !url.search && !url.hash ? texto.replace(/\/$/, "") : texto;
}

function linha(doc: Document, tag: "b" | "span", texto: string, classe?: string): HTMLElement {
  const el = doc.createElement(tag);
  el.textContent = texto;
  if (classe) el.className = classe;
  return el;
}

/**
 * definido em 2026-09-28 (ADR-053): passar o mouse (ou o foco do teclado) num link do bot mostra o
 * endereço inteiro antes do clique. A dica é um elemento só, fixo na janela: dentro da tabela que rola
 * ela seria cortada.
 */
export function instalarDicaDeLink(doc: Document): void {
  let dica: HTMLElement | null = null;
  let previa: HTMLElement | null = null;
  let relogio = 0;
  const janela = doc.defaultView;
  const esconder = () => {
    if (relogio) janela?.clearTimeout(relogio);
    relogio = 0;
    if (dica) dica.hidden = true;
    if (previa) previa.hidden = true;
  };
  const mostrar = (a: HTMLAnchorElement) => {
    const partes = partesDoEndereco(a.href);
    if (!partes) return;
    if (!dica) {
      dica = doc.createElement("div");
      dica.className = "lk-dica";
      dica.setAttribute("role", "tooltip");
      doc.body.append(dica);
    }
    dica.replaceChildren(
      linha(doc, "b", partes.host),
      ...(partes.resto ? [linha(doc, "span", partes.resto)] : []),
      ...(partes.seguro ? [] : [linha(doc, "span", "Sem https: a conexão não é protegida", "lk-dica-aviso")]),
      linha(doc, "span", "Abre no navegador", "lk-dica-abre"),
    );
    dica.hidden = false;
    const largura = janela?.innerWidth ?? 1024;
    const altura = janela?.innerHeight ?? 768;
    const r = a.getBoundingClientRect();
    const d = dica.getBoundingClientRect();
    dica.style.left = `${Math.max(8, Math.min(r.left - 12, largura - d.width - 8))}px`;
    dica.style.top = `${r.bottom + 8 + d.height > altura - 8 ? r.top - 8 - d.height : r.bottom + 8}px`;
  };
  /**
   * COP-14 (item 4): a prévia do link do balão do bot. Fica acima do link (abaixo só se não couber), com o globo, o
   * endereço sem "https://" e a seta ↗. O endereço inteiro continua à vista antes do clique (ADR-053), agora aqui.
   */
  const mostrarPrevia = (a: HTMLAnchorElement) => {
    const endereco = enderecoDaPrevia(a.href);
    if (endereco === null || !a.isConnected) return;
    if (!previa) {
      previa = doc.createElement("div");
      previa.className = "lk-previa";
      previa.setAttribute("role", "tooltip");
      doc.body.append(previa);
    }
    const url = linha(doc, "span", endereco, "lk-previa-url");
    const seta = linha(doc, "span", "↗", "lk-previa-seta");
    seta.setAttribute("aria-hidden", "true");
    const globo = doc.createElement("span");
    globo.className = "lk-previa-globo";
    globo.innerHTML = GLOBO;
    previa.replaceChildren(globo, url, seta);
    previa.hidden = false;
    const largura = janela?.innerWidth ?? 1024;
    const r = a.getBoundingClientRect();
    const p = previa.getBoundingClientRect();
    previa.style.left = `${Math.max(8, Math.min(r.left, largura - p.width - 8))}px`;
    previa.style.top = `${r.top - 6 - p.height < 8 ? r.bottom + 6 : r.top - 6 - p.height}px`;
  };
  const doBalao = (a: HTMLAnchorElement) => a.closest(BALAO_DO_BOT) !== null;
  const alvo = (ev: Event) => (ev.target instanceof Element ? ev.target.closest<HTMLAnchorElement>("a[data-lk]") : null);
  doc.addEventListener("mouseover", (ev) => {
    const a = alvo(ev);
    if (!a) return;
    // Entrar num filho do mesmo link (ícone, rótulo) não reinicia a espera.
    if (ev instanceof MouseEvent && ev.relatedTarget instanceof Node && a.contains(ev.relatedTarget)) return;
    if (!doBalao(a)) return mostrar(a);
    esconder();
    relogio = janela?.setTimeout(() => mostrarPrevia(a), ATRASO_PREVIA_MS) ?? 0;
  });
  doc.addEventListener("mouseout", (ev) => {
    const a = alvo(ev);
    if (a && !(ev instanceof MouseEvent && ev.relatedTarget instanceof Node && a.contains(ev.relatedTarget))) esconder();
  });
  doc.addEventListener("focusin", (ev) => {
    const a = alvo(ev);
    if (a) (doBalao(a) ? mostrarPrevia : mostrar)(a);
  });
  doc.addEventListener("focusout", esconder);
  doc.addEventListener("click", esconder);
  doc.addEventListener("scroll", esconder, true);
}

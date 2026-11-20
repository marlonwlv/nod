import { filtrarPaleta, moverNaPaleta, type ItemPaleta } from "./paleta.ts";
import { cascaDaPaleta, idDoItem, listaDaPaleta } from "../telas/paleta.ts";

/**
 * ADR-167: liga a paleta ⌘K ao documento. Vive FORA do render() da página (um elemento próprio no <body>): o redesenho da
 * barra ou da conversa nunca a apaga nem tira o foco do campo. Tudo o que ela sabe do app chega por `deps` — os itens no
 * momento de abrir, o avatar de um bot e o que fazer com o item escolhido —, então a mesma peça serve a qualquer camada de
 * tela (a migração do front não precisa reescrevê-la).
 */
export type DepsPaleta = {
  doc: Document;
  itens: () => ItemPaleta[];
  avatar: (agenteId: string) => string;
  executar: (item: ItemPaleta) => void;
};

export function criarPaleta(deps: DepsPaleta): { abrir(): void; fechar(): void; aberta(): boolean } {
  let raiz: HTMLElement | null = null;
  let todos: ItemPaleta[] = [];
  let vistos: ItemPaleta[] = [];
  let sel = 0;
  let antes: HTMLElement | null = null;

  const campo = () => raiz?.querySelector<HTMLInputElement>("#paleta-termo") ?? null;

  function pintar(): void {
    const lista = raiz?.querySelector<HTMLElement>("#paleta-lista");
    const c = campo();
    if (!lista || !c) return;
    // Relê a cada busca: os trabalhos (o grupo Conversas) podem chegar depois de a paleta abrir (main.ts hidrata ao abrir).
    todos = deps.itens();
    vistos = filtrarPaleta(todos, c.value);
    sel = Math.min(sel, Math.max(0, vistos.length - 1));
    lista.innerHTML = listaDaPaleta(vistos, sel, deps.avatar, c.value);
    if (vistos.length) c.setAttribute("aria-activedescendant", idDoItem(sel));
    else c.removeAttribute("aria-activedescendant");
  }

  function marcar(i: number): void {
    sel = i;
    raiz?.querySelectorAll<HTMLElement>(".paleta-item").forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.indice) === i)));
    const el = raiz?.querySelector<HTMLElement>(`#${idDoItem(i)}`);
    el?.scrollIntoView({ block: "nearest" });
    campo()?.setAttribute("aria-activedescendant", idDoItem(i));
  }

  function escolher(i: number): void {
    const item = vistos[i];
    if (!item) return;
    fechar(false);
    deps.executar(item);
  }

  function fechar(devolverFoco = true): void {
    if (!raiz) return;
    raiz.remove();
    raiz = null;
    if (devolverFoco && antes?.isConnected) antes.focus();
    antes = null;
  }

  function abrir(): void {
    if (raiz) {
      campo()?.select();
      return;
    }
    antes = deps.doc.activeElement instanceof HTMLElement ? deps.doc.activeElement : null;
    todos = deps.itens();
    sel = 0;
    const casca = deps.doc.createElement("div");
    casca.className = "paleta-camada";
    casca.innerHTML = cascaDaPaleta();
    deps.doc.body.append(casca);
    raiz = casca;
    pintar();
    const c = campo();
    c?.focus();
    c?.addEventListener("input", () => { sel = 0; pintar(); });
    casca.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); fechar(); return; }
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); escolher(sel); return; }
      // O foco não sai da paleta: Tab volta ao campo.
      if (ev.key === "Tab") { ev.preventDefault(); campo()?.focus(); return; }
      const prox = moverNaPaleta(sel, vistos.length, ev.key);
      if (prox !== null && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) { ev.preventDefault(); ev.stopPropagation(); marcar(prox); }
    });
    // mousedown: o campo não perde o foco antes do clique escolher.
    casca.addEventListener("mousedown", (ev) => {
      const alvo = ev.target as HTMLElement;
      if (alvo.closest(".paleta-item")) ev.preventDefault();
    });
    casca.addEventListener("mousemove", (ev) => {
      const item = (ev.target as HTMLElement).closest<HTMLElement>(".paleta-item");
      const i = Number(item?.dataset.indice);
      if (item && i !== sel) marcar(i);
    });
    casca.addEventListener("click", (ev) => {
      const alvo = ev.target as HTMLElement;
      const item = alvo.closest<HTMLElement>(".paleta-item");
      if (item) { escolher(Number(item.dataset.indice)); return; }
      if (alvo.hasAttribute("data-paleta-fundo")) fechar();
    });
  }

  return { abrir, fechar: () => fechar(), aberta: () => raiz !== null };
}

import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * ADR-179 (fase 1 do React): uma região do index.html (#sidebar, #cabecalho, #timeline, #composer, #detalhes…) passa
 * para o React INTEIRA, com um createRoot só dela. Nunca meia região: enquanto uma região é do React, o render por
 * string do main.ts não escreve nela (quem migra a região tira o desenho antigo dela no mesmo PR).
 *
 * Nenhuma região está montada nesta fase; o helper existe para a fase 2 começar pela primeira.
 */
const raizes = new Map<string, { raiz: Root; el: HTMLElement }>();

/** Atributo que marca, no DOM, que a região é do React (para o main.ts e para quem inspeciona a página). */
export const MARCA_REGIAO = "data-react-regiao";

export type Montada = { desmontar: () => void; desenhar: (conteudo: ReactNode) => void };

/**
 * Monta `conteudo` na região `id`. Falha alto se a região não existe ou já é do React: dois roots no mesmo nó
 * apagariam um ao outro em silêncio.
 */
export function montarRegiao(id: string, conteudo: ReactNode, doc: Document = document): Montada {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Região #${id} não existe no index.html`);
  if (raizes.has(id) || el.hasAttribute(MARCA_REGIAO)) throw new Error(`Região #${id} já está montada no React`);
  // A região chega vazia ao React: o que o render por string tinha desenhado ali sai agora, não fica meio a meio.
  el.replaceChildren();
  el.setAttribute(MARCA_REGIAO, "");
  const raiz = createRoot(el, { identifierPrefix: `${id}-` });
  raizes.set(id, { raiz, el });
  const desenhar = (c: ReactNode): void => raiz.render(<StrictMode>{c}</StrictMode>);
  desenhar(conteudo);
  return { desenhar, desmontar: () => desmontarRegiao(id) };
}

/** Desmonta a região (no-op se ela não está montada) e devolve o nó vazio ao render por string. */
export function desmontarRegiao(id: string): void {
  const r = raizes.get(id);
  if (!r) return;
  raizes.delete(id);
  r.raiz.unmount();
  r.el.removeAttribute(MARCA_REGIAO);
}

/** As regiões que estão no React agora (o main.ts consulta antes de escrever numa região). */
export function regioesMontadas(): string[] {
  return [...raizes.keys()];
}

export function regiaoEhDoReact(id: string): boolean {
  return raizes.has(id);
}

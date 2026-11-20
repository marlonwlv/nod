import { createElement, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MARCA_REGIAO, montarRegiao } from "../regioes.tsx";
import { criarConversor } from "./html-em-react.tsx";

/**
 * ADR-189: uma região do index.html que o React desenha a partir do HTML que a tela já monta (`html-em-react.tsx`). A
 * região é do React inteira (ADR-179, item 4: `montarRegiao`); quem chama troca o `regiao(id, html)` por `desenhar(html)`.
 *
 * O desenho é síncrono (`flushSync`): o main.ts restaura foco, rolagem e filtro logo depois de escrever, e precisa achar
 * os nós novos na linha seguinte, como com o innerHTML.
 */
export interface RegiaoPorHtml {
  /** O HTML é diferente do último desenhado? (o `regiaoMudaria` do desenho por string) */
  mudaria: (html: string) => boolean;
  desenhar: (html: string) => void;
  /** O próximo `desenhar` vai até o React mesmo com o HTML igual (o nó foi mexido por fora). */
  esquecer: () => void;
  desmontar: () => void;
  /** Pedaços com chave reaproveitados × montados no último desenho. */
  medida: () => { reaproveitados: number; novos: number };
  /** O último HTML desenhado. */
  ultimo: () => string;
}

export function montarRegiaoPorHtml(id: string, doc: Document = document): RegiaoPorHtml {
  const conversor = criarConversor(doc);
  const montada = montarRegiao(id, null, doc);
  let ultimo: string | null = "";
  let desenhado = "";
  return {
    ultimo: () => desenhado,
    mudaria: (html) => html !== ultimo,
    desenhar(html) {
      if (html === ultimo) return;
      ultimo = html;
      desenhado = html;
      const nos = conversor.converter(html);
      conversor.fecharQuadro();
      flushSync(() => montada.desenhar(nos));
    },
    esquecer() {
      ultimo = null;
    },
    desmontar() {
      ultimo = null;
      montada.desmontar();
    },
    medida: () => conversor.ultimo(),
  };
}

/** Um bloco da conversa (ADR-061): a chave estável e o HTML dele (o mesmo `BlocoDaTimeline` de `web/telas/conversa.ts`). */
export type BlocoDeHtml = { readonly chave: string; readonly html: string };

/**
 * ADR-189 (fase 6 da ADR-179): uma parte da conversa (`#timeline-historico`, `#timeline-ao-vivo`) desenhada pelo React,
 * bloco a bloco, no lugar do `regiaoPorBlocos`. Cada bloco é um `<div class="bloco">` com chave; o bloco de HTML igual ao
 * do desenho anterior devolve o MESMO elemento React (nem é lido de novo), e o que mudou é reconciliado no lugar: o
 * mascote, o `<details>` aberto, o campo com texto e a vaga do rótulo da fala viva (o morph da ADR-114) ficam no nó.
 *
 * A parte mora dentro da casca da timeline, que o main.ts regrava quando a tela muda: `em(el)` diz se o nó ainda é o
 * mesmo; quando não é, quem chama desmonta esta e monta outra no nó novo.
 */
export interface BlocosNoReact {
  em: (el: Element | null) => boolean;
  mudariam: (blocos: readonly BlocoDeHtml[]) => boolean;
  /** Desenha e devolve os blocos de chave nova que entraram depois do primeiro que ficou (para animar a chegada). */
  desenhar: (blocos: readonly BlocoDeHtml[]) => HTMLElement[];
  desmontar: () => void;
}

export function montarBlocosNoReact(el: HTMLElement, prefixo: string, deps: { focarDeNovo?: (focado: HTMLElement, raiz: HTMLElement) => void } = {}): BlocosNoReact {
  el.replaceChildren();
  el.setAttribute(MARCA_REGIAO, prefixo);
  const raiz = createRoot(el, { identifierPrefix: `${prefixo}-` });
  const conversor = criarConversor(el.ownerDocument);
  let cache = new Map<string, { html: string; elemento: ReactElement }>();
  let ultimo: { chave: string; html: string }[] = [];
  const nos = new Map<string, HTMLElement>();
  const refs = new Map<string, (no: HTMLElement | null) => void>();
  const refDe = (chave: string) => {
    let r = refs.get(chave);
    if (!r) {
      r = (no) => {
        if (no) nos.set(chave, no);
        else nos.delete(chave);
      };
      refs.set(chave, r);
    }
    return r;
  };
  let montada = true;
  return {
    em: (outro) => montada && outro === el && el.isConnected,
    mudariam(blocos) {
      if (blocos.length !== ultimo.length) return true;
      return blocos.some((b, i) => b.chave !== ultimo[i]?.chave || b.html !== ultimo[i]?.html);
    },
    desenhar(blocos) {
      const doc = el.ownerDocument;
      const ativo = doc.activeElement;
      const focado = ativo instanceof HTMLElement && el.contains(ativo) ? ativo : null;
      const tinha = new Set(ultimo.map((b) => b.chave));
      const vistos = new Set<string>();
      const novoCache = new Map<string, { html: string; elemento: ReactElement }>();
      const chaves: string[] = [];
      const elementos = blocos.map((b, i) => {
        // Chave repetida não reaproveita nada (como no regiaoPorBlocos): a segunda nasce de novo, com chave própria.
        const chave = vistos.has(b.chave) ? `${b.chave}\u0000${i}` : b.chave;
        vistos.add(b.chave);
        chaves.push(chave);
        const guardado = cache.get(chave);
        if (guardado && guardado.html === b.html) {
          novoCache.set(chave, guardado);
          return guardado.elemento;
        }
        const elemento = createElement("div", { key: chave, className: "bloco", ref: refDe(chave) }, ...conversor.converter(b.html));
        novoCache.set(chave, { html: b.html, elemento });
        return elemento;
      });
      conversor.fecharQuadro();
      cache = novoCache;
      for (const k of [...refs.keys()]) if (!novoCache.has(k)) refs.delete(k);
      const primeiraVez = ultimo.length === 0;
      ultimo = blocos.map((b) => ({ chave: b.chave, html: b.html }));
      flushSync(() => raiz.render(elementos));
      // O foco morava num nó que o desenho trocou (o miolo por string mudou): volta ao mesmo botão/campo no nó novo.
      if (focado && !focado.isConnected) deps.focarDeNovo?.(focado, el);
      // Os de chave nova depois do primeiro que ficou: o histórico mais velho que entra no alto não conta, nem a 1ª vez.
      if (primeiraVez) return [];
      const primeiroQueFicou = chaves.findIndex((k) => tinha.has(k));
      if (primeiroQueFicou < 0) return [];
      return chaves.slice(primeiroQueFicou + 1).filter((k) => !tinha.has(k)).flatMap((k) => { const no = nos.get(k); return no ? [no] : []; });
    },
    desmontar() {
      if (!montada) return;
      montada = false;
      raiz.unmount();
      el.removeAttribute(MARCA_REGIAO);
    },
  };
}

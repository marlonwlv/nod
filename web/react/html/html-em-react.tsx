import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";

/**
 * ADR-189: o HTML que as telas já montam (o desenho por string de `web/telas`) entra numa região do React sem ser
 * reescrito à mão. O conversor lê o HTML num `<template>` (nós inertes: nem estilo, nem custom element, nem imagem) e
 * devolve elementos React com chave estável. O React só toca no DOM o que mudou de fato:
 *
 * - **Pedaço com chave** (`data-chave`, `id`, `data-bot-contexto`…): o elemento React é guardado pelo HTML dele; no
 *   próximo desenho, o mesmo HTML devolve o MESMO objeto, e o React pula o pedaço inteiro sem comparar nada.
 * - **Pedaço morto** (sem custom element, campo, `<details>`, mídia nem chave por dentro): vira um elemento só, com o
 *   miolo em `dangerouslySetInnerHTML`. O React compara a string e não regrava o miolo igual.
 * - **Custom element** (`<nod-mascote>`): é sempre o mesmo nó; quando o HTML muda, o React troca só os atributos — o
 *   motor do mascote segue no mesmo elemento, sem pintar de novo.
 * - **Campos**: `value`/`checked` viram `defaultValue`/`defaultChecked`. O que a pessoa digitou não é sobrescrito por
 *   um desenho que não mudou o campo.
 *
 * O DOM que sai é o mesmo do desenho por string (mesmas tags, classes e atributos), então CSS, a delegação de eventos do
 * main.ts e os testes de DOM seguem valendo.
 */

/** Atributos que dão chave a um elemento entre os irmãos, na ordem de preferência. */
const ATRIBUTOS_DE_CHAVE = ["data-chave", "id", "data-bot-contexto", "data-time-id", "data-secao", "data-grupo", "data-turno", "data-mensagem", "data-decisao", "data-proposta", "data-parte", "data-disclosure"] as const;

/**
 * Marcas do morph da fala viva (ADR-114): o nó fica e só o que mudou dentro dele é trocado. No React isso é o pai
 * convertido com filhos próprios (nunca um miolo por string), para o nó marcado ser reconciliado no lugar.
 */
const MARCAS_DE_LUGAR = ["data-no-lugar", "data-morfar"] as const;

/** Elementos que precisam de nó próprio no React (não podem ir num miolo por string). */
const TAGS_VIVAS = new Set(["input", "textarea", "select", "details", "iframe", "video", "audio", "canvas", "dialog", "form"]);

/** Dentro destes, espaço em branco solto não é filho válido (o React avisa e o navegador o descartaria). */
const SEM_TEXTO_SOLTO = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup", "select", "optgroup"]);

/** HTML → nome da prop do React (só o que difere; o resto passa como está, em minúsculas). */
const NOMES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autocapitalize: "autoCapitalize",
  enterkeyhint: "enterKeyHint",
  inputmode: "inputMode",
  datetime: "dateTime",
  srcset: "srcSet",
  accesskey: "accessKey",
  novalidate: "noValidate",
  crossorigin: "crossOrigin",
  referrerpolicy: "referrerPolicy",
  allowfullscreen: "allowFullScreen",
  frameborder: "frameBorder",
  formaction: "formAction",
  formnovalidate: "formNoValidate",
  playsinline: "playsInline",
  srcdoc: "srcDoc",
  usemap: "useMap",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  popovertarget: "popoverTarget",
  popovertargetaction: "popoverTargetAction",
  fetchpriority: "fetchPriority",
  "accept-charset": "acceptCharset",
  "http-equiv": "httpEquiv",
  itemprop: "itemProp",
  itemscope: "itemScope",
  itemtype: "itemType",
  autoplay: "autoPlay",
  nomodule: "noModule",
};

/** Atributos booleanos do HTML: presentes = true (o React os escreve como `attr=""`). */
const BOOLEANOS = new Set(["hidden", "disabled", "checked", "selected", "open", "inert", "multiple", "required", "readonly", "autofocus", "novalidate", "allowfullscreen", "async", "defer", "controls", "loop", "muted", "playsinline", "reversed", "default", "formnovalidate", "itemscope", "nomodule", "autoplay"]);

/** No `<svg>` (a raiz; o miolo vai por string), os atributos com hífen viram camelCase, que o React conhece. */
function nomeNoSvg(nome: string): string {
  if (nome.startsWith("data-") || nome.startsWith("aria-")) return nome;
  if (nome === "class") return "className";
  if (nome === "xmlns:xlink") return "xmlnsXlink";
  if (nome === "xml:space") return "xmlSpace";
  if (nome === "xlink:href") return "xlinkHref";
  return nome.replace(/-([a-z])/g, (_, l: string) => l.toUpperCase());
}

/** `"a: b; --c: d"` → `{ a: "b", "--c": "d" }`, com as propriedades comuns em camelCase. */
export function estiloDoTexto(texto: string): CSSProperties {
  const estilo: Record<string, string> = {};
  for (const parte of texto.split(";")) {
    const i = parte.indexOf(":");
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (!nome) continue;
    estilo[nome.startsWith("--") ? nome : nome.replace(/-([a-z])/g, (_, l: string) => l.toUpperCase())] = valor;
  }
  return estilo as CSSProperties;
}

const ehCustom = (tag: string): boolean => tag.includes("-");

type Props = Record<string, unknown>;

function propsDe(el: Element, tag: string): Props {
  const props: Props = {};
  const svg = tag === "svg";
  for (const { name, value } of Array.from(el.attributes)) {
    if (name.startsWith("on")) continue; // a web não usa handler inline; nunca vira código no React
    if (ehCustom(tag)) {
      // Custom element no React 19: `className` vira `class`; o resto vai como atributo (os nomes do mascote não colidem
      // com propriedades do elemento — mascote-elemento.ts).
      props[name === "class" ? "className" : name] = BOOLEANOS.has(name) ? true : value;
      continue;
    }
    if (name === "style") {
      props.style = estiloDoTexto(value);
      continue;
    }
    if (svg) {
      props[nomeNoSvg(name)] = value;
      continue;
    }
    if (BOOLEANOS.has(name)) {
      props[NOMES[name] ?? name] = true;
      continue;
    }
    props[NOMES[name] ?? name] = value;
  }
  // Campos: o valor do HTML é o inicial; o React não briga com o que a pessoa digitou ou marcou.
  if (tag === "input") {
    if ("value" in props) { props.defaultValue = props.value; delete props.value; }
    if ("checked" in props) { props.defaultChecked = props.checked; delete props.checked; }
  }
  if (tag === "option") delete props.selected;
  if (tag === "select") {
    const marcadas = Array.from(el.querySelectorAll("option")).filter((o) => o.hasAttribute("selected")).map((o) => o.getAttribute("value") ?? o.textContent ?? "");
    if (marcadas.length) props.defaultValue = el.hasAttribute("multiple") ? marcadas : marcadas[marcadas.length - 1];
  }
  if (tag === "textarea") props.defaultValue = el.textContent ?? "";
  return props;
}

function chaveDe(el: Element): string | null {
  for (const a of ATRIBUTOS_DE_CHAVE) {
    const v = el.getAttribute(a);
    if (v !== null && v !== "") return `${a}=${v}`;
  }
  return null;
}

/**
 * Um conversor guarda, entre dois desenhos, os elementos React dos pedaços com chave (pelo HTML deles). Use um por
 * região: o cache é só do desenho anterior, então não cresce.
 */
export interface ConversorDeHtml {
  /** Converte um HTML do desenho atual (pode ser chamado mais de uma vez por desenho: um por bloco). */
  converter: (html: string) => ReactNode[];
  /** Fecha o desenho: o que foi usado nele vira o cache do próximo (o resto sai). */
  fecharQuadro: () => void;
  /** Quantos pedaços com chave o último desenho fechado reaproveitou e quantos montou de novo (teste e medida). */
  ultimo: () => { reaproveitados: number; novos: number };
}

export function criarConversor(doc: Document = document): ConversorDeHtml {
  let anterior = new Map<string, ReactElement>();
  let atual = new Map<string, ReactElement>();
  let contagem = { reaproveitados: 0, novos: 0 };
  let fechada = contagem;
  return {
    converter(html) {
      const molde = doc.createElement("template");
      molde.innerHTML = html;
      const vivos = marcarVivos(molde.content);
      return converterFilhos(molde.content, "", vivos, anterior, atual, contagem);
    },
    fecharQuadro() {
      anterior = atual;
      atual = new Map();
      fechada = contagem;
      contagem = { reaproveitados: 0, novos: 0 };
    },
    ultimo: () => fechada,
  };
}

/** Os elementos que precisam de nó React próprio: os vivos e quem tem um vivo ou um pedaço com chave por dentro. */
function marcarVivos(raiz: ParentNode): Set<Element> {
  const vivos = new Set<Element>();
  const visitar = (el: Element): boolean => {
    let vivo = TAGS_VIVAS.has(el.localName) || ehCustom(el.localName) || MARCAS_DE_LUGAR.some((m) => el.hasAttribute(m));
    for (const filho of Array.from(el.children)) if (visitar(filho)) vivo = true;
    if (vivo) vivos.add(el);
    return vivo || chaveDe(el) !== null;
  };
  for (const filho of Array.from(raiz.children)) visitar(filho);
  return vivos;
}

function converterFilhos(pai: ParentNode, tagDoPai: string, vivos: Set<Element>, anterior: Map<string, ReactElement>, atual: Map<string, ReactElement>, contagem: { reaproveitados: number; novos: number }): ReactNode[] {
  const saida: ReactNode[] = [];
  const usadas = new Map<string, number>();
  const semTexto = SEM_TEXTO_SOLTO.has(tagDoPai);
  for (const no of Array.from(pai.childNodes)) {
    if (no.nodeType === 3) {
      const texto = no.textContent ?? "";
      if (semTexto && texto.trim() === "") continue;
      saida.push(texto);
      continue;
    }
    if (no.nodeType !== 1) continue; // comentários e o resto ficam de fora, como o desenho por string ignorava
    const el = no as Element;
    const tag = el.localName;
    const propria = chaveDe(el);
    const base = propria ?? tag;
    const n = usadas.get(base) ?? 0;
    usadas.set(base, n + 1);
    const chave = n === 0 && propria ? propria : `${base}#${n}`;
    if (propria) {
      const html = el.outerHTML;
      const id = `${chave}\u0000${html}`;
      const guardado = anterior.get(id) ?? atual.get(id);
      if (guardado) {
        atual.set(id, guardado);
        contagem.reaproveitados++;
        saida.push(guardado);
        continue;
      }
      const novo = converterElemento(el, tag, chave, vivos, anterior, atual, contagem);
      atual.set(id, novo);
      contagem.novos++;
      saida.push(novo);
      continue;
    }
    saida.push(converterElemento(el, tag, chave, vivos, anterior, atual, contagem));
  }
  return saida;
}

function converterElemento(el: Element, tag: string, chave: string, vivos: Set<Element>, anterior: Map<string, ReactElement>, atual: Map<string, ReactElement>, contagem: { reaproveitados: number; novos: number }): ReactElement {
  const props = propsDe(el, tag);
  props.key = chave;
  // <template> dentro do HTML: o conteúdo dele mora em `.content`, não nos filhos.
  if (tag === "template") return createElement(tag, { ...props, dangerouslySetInnerHTML: { __html: (el as HTMLTemplateElement).innerHTML } });
  if (tag === "textarea") return createElement(tag, props);
  if (!vivos.has(el) && tag !== "select") {
    const miolo = el.innerHTML;
    return miolo === "" ? createElement(tag, props) : createElement(tag, { ...props, dangerouslySetInnerHTML: { __html: miolo } });
  }
  return createElement(tag, props, ...converterFilhos(el, tag, vivos, anterior, atual, contagem));
}

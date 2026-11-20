import { createElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import { MenuAncorado, montarMenu, type Ancora } from "./menu-ancorado.tsx";

/**
 * ADR-179 (item 4): os menus da barra (o da aba de tarefa, o de bots e o das outras abas, o da nova tarefa, os do time;
 * `abrirMenuDaBarra` no main, a volta com `?dialogos-react=0`) pelo Menu do Base UI, a partir do MESMO HTML que o
 * `<dialog>` nativo recebe: `<div role="menu" aria-label=…>` com os botões e o que houver entre eles. O papel e o rótulo
 * vão para o popup; o `<div>` fica (sem o papel) com a classe dele, que o CSS lê (`.bot-menu > .menu-aba-corpo`). Cada
 * botão vira um item do menu com os mesmos atributos e o mesmo miolo (desligado: fora das setas e do clique); o resto
 * (o nome, a nota, os separadores) passa pelo conversor. A escolha recebe o botão (o `dataset` dele), como no nativo.
 */
export interface MenuDeHtml extends Ancora {
  html: string;
  aoEscolher: (b: HTMLButtonElement) => void;
  /** O botão que troca o conteúdo sem fechar (o "+" dos emojis): o HTML novo e o que recebe o foco depois. */
  expandir?: { seletor: string; html: () => string; focar: string } | undefined;
  /** O rótulo do popup no lugar do `aria-label` do HTML (o nativo o põe no `<dialog>`). */
  rotulo?: string | undefined;
}

const PROPS: Record<string, string> = { class: "className", tabindex: "tabIndex", for: "htmlFor" };

function propsDe(el: Element, fora: readonly string[] = []): Record<string, string> {
  const p: Record<string, string> = {};
  for (const a of el.attributes) if (!fora.includes(a.name)) p[PROPS[a.name] ?? a.name] = a.value;
  return p;
}

function MenuDeHtmlRx({ m, sair }: { m: MenuDeHtml; sair: () => void }) {
  const escolhida = useRef<(() => void) | null>(null);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  const [html, setHtml] = useState(m.html);
  const focarDepois = useRef<string | null>(null);
  const corpoRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!focarDepois.current) return;
    corpoRef.current?.closest(".rx-menu")?.querySelector<HTMLElement>(focarDepois.current)?.focus();
    focarDepois.current = null;
  }, [html]);
  const t = document.createElement("template");
  t.innerHTML = html;
  const raiz = t.content.firstElementChild;
  let k = 0;
  const no = (n: ChildNode): ReactNode => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent;
    if (!(n instanceof Element)) return null;
    const chave = `${k++}`;
    if (n.tagName === "BUTTON") {
      const desligado = n.hasAttribute("disabled") || n.getAttribute("aria-disabled") === "true";
      const expande = !!m.expandir && n.matches(m.expandir.seletor);
      return (
        <Menu.Item key={chave} nativeButton disabled={desligado} closeOnClick={!expande} render={<button type="button" />}
          {...propsDe(n, ["type", "disabled", "aria-disabled", n.getAttribute("role") === "menuitem" ? "role" : ""])}
          dangerouslySetInnerHTML={{ __html: n.innerHTML }}
          onClick={(ev) => {
            if (expande && m.expandir) { focarDepois.current = m.expandir.focar; setHtml(m.expandir.html()); return; }
            const b = ev.currentTarget as unknown as HTMLButtonElement;
            escolhida.current = () => m.aoEscolher(b);
          }} />
      );
    }
    if (!n.querySelector("button")) return <ConvertidoComChave key={chave} no={conversor.current!.converter(n.outerHTML)} />;
    return createElement(n.tagName.toLowerCase(), { key: chave, ...propsDe(n) }, [...n.childNodes].map(no));
  };
  const ehMenu = raiz?.getAttribute("role") === "menu";
  const corpo = raiz && ehMenu
    ? createElement("div", { ...propsDe(raiz, ["role", "aria-label"]), ref: corpoRef }, [...raiz.childNodes].map(no))
    : [...t.content.childNodes].map(no);
  return (
    <MenuAncorado a={m} rotulo={m.rotulo ?? (ehMenu ? raiz.getAttribute("aria-label") ?? undefined : undefined)} escolhida={escolhida} sair={sair}>
      {corpo}
    </MenuAncorado>
  );
}

const ConvertidoComChave = ({ no }: { no: ReactNode }) => <>{no}</>;

/** Abre o menu a partir do HTML do `<dialog>` nativo, num root próprio (desmontado ao fechar). */
export function abrirMenuDeHtmlNoReact(doc: Document, m: MenuDeHtml): void {
  montarMenu(doc, "menu-barra", (sair) => <MenuDeHtmlRx m={m} sair={sair} />);
}

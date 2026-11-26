import { createElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { criarConversor, estiloDoTexto, type ConversorDeHtml } from "../html/html-em-react.tsx";
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
  /**
   * Quem decide cada clique (o menu do modo): `null` ignora; `{ fechar }` fecha e roda `depois` (já com o foco de volta);
   * o resto (trocar o conteúdo) vai pelo `controle`. Com ele, nenhum item fecha sozinho e `aoEscolher` não é chamado.
   */
  aoClicar?: ((b: HTMLButtonElement, cliques: number) => { fechar: true; depois?: () => void } | null) | undefined;
  /** Os itens direto no popup, sem o `<div role="menu">` (que já é o popup): o menu com estilo próprio (`pg-menu`). */
  semCasca?: boolean | undefined;
  /** Preenchido ao montar: trocar o HTML (e o que recebe o foco depois) e fechar por código. */
  controle?: { current: { trocar: (html: string, focar: string) => void; fechar: () => void } | null } | undefined;
}

const PROPS: Record<string, string> = { class: "className", tabindex: "tabIndex", for: "htmlFor" };

/**
 * Os atributos do HTML como props do React. O `style` vira objeto (`estiloDoTexto`, o mesmo do conversor): o React recusa
 * a string e derruba a árvore inteira — o menu de IA do campo (a régua de raciocínio tem `style="grid-template-columns…"`)
 * não abria, e o botão ficava com a seta para cima e um clique mudo.
 */
function propsDe(el: Element, fora: readonly string[] = []): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const a of el.attributes) {
    if (fora.includes(a.name)) continue;
    p[PROPS[a.name] ?? a.name] = a.name === "style" ? estiloDoTexto(a.value) : a.value;
  }
  return p;
}

function MenuDeHtmlRx({ m, sair }: { m: MenuDeHtml; sair: () => void }) {
  const escolhida = useRef<(() => void) | null>(null);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  const [html, setHtml] = useState(m.html);
  const focarDepois = useRef<string | null>(null);
  const acoes = useRef<{ close: () => void; unmount: () => void } | null>(null);
  if (m.controle) m.controle.current = { trocar: (h, f) => { focarDepois.current = f; setHtml(h); }, fechar: () => acoes.current?.close() };
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
        <Menu.Item key={chave} nativeButton disabled={desligado} closeOnClick={!expande && !m.aoClicar} render={<button type="button" />}
          {...propsDe(n, ["type", "disabled", "aria-disabled", "tabindex", n.getAttribute("role") === "menuitem" ? "role" : ""])}
          dangerouslySetInnerHTML={{ __html: n.innerHTML }}
          onClick={(ev) => {
            if (expande && m.expandir) { focarDepois.current = m.expandir.focar; setHtml(m.expandir.html()); return; }
            const b = ev.currentTarget as unknown as HTMLButtonElement;
            if (m.aoClicar) {
              const r = m.aoClicar(b, (ev as unknown as MouseEvent).detail);
              if (r) { escolhida.current = r.depois ?? null; acoes.current?.close(); }
              return;
            }
            escolhida.current = () => m.aoEscolher(b);
          }} />
      );
    }
    if (!n.querySelector("button")) return <ConvertidoComChave key={chave} no={conversor.current!.converter(n.outerHTML)} />;
    return createElement(n.tagName.toLowerCase(), { key: chave, ...propsDe(n) }, [...n.childNodes].map(no));
  };
  const ehMenu = raiz?.getAttribute("role") === "menu";
  const corpo = raiz && ehMenu && m.semCasca ? [...raiz.childNodes].map(no)
    : raiz && ehMenu
    ? createElement("div", { ...propsDe(raiz, ["role", "aria-label"]), ref: corpoRef }, [...raiz.childNodes].map(no))
    : [...t.content.childNodes].map(no);
  return (
    <MenuAncorado a={{ ...m, acoes }} rotulo={m.rotulo ?? (ehMenu ? raiz.getAttribute("aria-label") ?? undefined : undefined)} escolhida={escolhida} sair={sair}>
      {corpo}
    </MenuAncorado>
  );
}

const ConvertidoComChave = ({ no }: { no: ReactNode }) => <>{no}</>;

/** Abre o menu a partir do HTML do `<dialog>` nativo, num root próprio (desmontado ao fechar). */
export function abrirMenuDeHtmlNoReact(doc: Document, m: MenuDeHtml): void {
  montarMenu(doc, "menu-barra", (sair) => <MenuDeHtmlRx m={m} sair={sair} />);
}

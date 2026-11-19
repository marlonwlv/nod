import { StrictMode, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Menu } from "@base-ui/react/menu";

/**
 * ADR-179 (item 4): o menu ancorado do nod pelo Menu do Base UI — o que o `dialogo(…, true)` nativo faz para os menus
 * da lista e da barra. No cursor (o clique direito: o canto em `ponto + 4`) ou ao lado do que o abriu, deslizando para
 * caber (sem virar de lado, como o nativo, que só prende nas bordas); o foco abre no 1º item habilitado; as setas,
 * Home, End, a primeira letra e o Esc são do Base UI.
 *
 * A escolha roda depois de o menu sair e o foco voltar a quem abriu (como no `<dialog>`, que fecha antes de executar):
 * o que ela abrir leva o foco sem disputa. O foco é devolvido aqui, não pelo Base UI, cuja volta chegaria depois e o
 * tiraria do que a ação abriu.
 */
export interface Ancora {
  ancora: HTMLElement | null;
  ponto?: { x: number; y: number } | undefined;
  /** Avisado quando o menu sai (escolhendo ou não), antes da escolha. */
  aoFechar?: (() => void) | undefined;
}

export function MenuAncorado({ a, rotulo, classe, escolhida, sair, children }: {
  a: Ancora; rotulo: string | undefined; classe?: string | undefined; escolhida: { current: (() => void) | null }; sair: () => void; children: ReactNode;
}) {
  const saiu = useRef(false);
  const terminar = (): void => {
    if (saiu.current) return;
    saiu.current = true;
    sair();
    if (a.ancora?.isConnected) a.ancora.focus({ preventScroll: true });
    a.aoFechar?.();
    escolhida.current?.();
  };
  const ponto = a.ponto;
  const ancora = ponto ? { getBoundingClientRect: () => DOMRect.fromRect({ x: ponto.x + 4, y: ponto.y + 4, width: 0, height: 0 }) } : a.ancora;
  return (
    <Menu.Root defaultOpen modal onOpenChange={(o) => { if (!o) setTimeout(terminar, 1000); }} onOpenChangeComplete={(o) => { if (!o) terminar(); }}>
      <Menu.Portal>
        <Menu.Positioner className="rx-menu-pos" anchor={ancora} side={ponto ? "bottom" : "right"} align="start" collisionPadding={12}
          collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}>
          <Menu.Popup className={`bot-menu rx-menu${classe ? ` ${classe}` : ""}`} aria-label={rotulo} finalFocus={false}
            ref={(el) => { if (el) requestAnimationFrame(() => { if (el.isConnected && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')?.focus(); }); }}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Monta um menu num root próprio (desmontado ao fechar); um menu aberto antes sai. */
export function montarMenu(doc: Document, prefixo: string, conteudo: (sair: () => void) => ReactNode): void {
  doc.querySelector(".rx-menu-host")?.dispatchEvent(new CustomEvent("rx-fechar"));
  const host = doc.createElement("div");
  host.className = "rx-menu-host";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: `${prefixo}-` });
  let saiu = false;
  const sair = (): void => { if (saiu) return; saiu = true; queueMicrotask(() => { raiz.unmount(); host.remove(); }); };
  host.addEventListener("rx-fechar", sair, { once: true });
  raiz.render(<StrictMode>{conteudo(sair)}</StrictMode>);
}

import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Menu } from "@base-ui/react/menu";
import { CAMINHOS_DO_MENU, linhasDoMenu, type AcaoGestao, type BotGerido } from "../../telas/gestao-agentes.ts";

/**
 * ADR-179 (item 4): o menu do bot na lista (o clique direito, Shift+F10 e o ⋯; web/telas/gestao-agentes.ts `abrirMenu`, a
 * volta com `?dialogos-react=0`) pelo Menu do Base UI. As mesmas linhas (`linhasDoMenu`, que o HTML nativo também lê) e o
 * mesmo lugar: no clique direito, no cursor; sem ponto, ao lado do que o abriu, deslizando para caber (sem virar de
 * lado, como a nativa). As setas, Home, End, a primeira letra e o Esc são do Base UI; o foco abre no 1º item.
 *
 * A ação roda depois de o menu sair e o foco voltar a quem abriu (como no `<dialog>`, que fecha antes de executar): o que
 * ela abrir (Renomear, Excluir) leva o foco sem disputa com o menu.
 */
export interface MenuDoBot {
  a: BotGerido;
  dona: boolean;
  ancora: HTMLElement;
  ponto?: { x: number; y: number } | undefined;
  executar: (acao: AcaoGestao) => void;
}

const SVG = { "aria-hidden": true, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function MenuDoBotRx({ m, sair }: { m: MenuDoBot; sair: () => void }) {
  const escolhida = useRef<AcaoGestao | null>(null);
  const saiu = useRef(false);
  const terminar = (): void => {
    if (saiu.current) return;
    saiu.current = true;
    sair();
    // O foco volta aqui, não pelo Base UI: a volta dele chega depois e tiraria o foco do que a ação abriu.
    if (m.ancora.isConnected) m.ancora.focus({ preventScroll: true });
    const acao = escolhida.current;
    if (acao) m.executar(acao);
  };
  const ponto = m.ponto;
  const ancora = ponto
    ? { getBoundingClientRect: () => DOMRect.fromRect({ x: ponto.x + 4, y: ponto.y + 4, width: 0, height: 0 }) }
    : m.ancora;
  return (
    <Menu.Root defaultOpen modal
      onOpenChange={(o) => { if (!o) setTimeout(terminar, 1000); }}
      onOpenChangeComplete={(o) => { if (!o) terminar(); }}>
      <Menu.Portal>
        <Menu.Positioner className="rx-menu-pos" anchor={ancora} side={ponto ? "bottom" : "right"} align="start" collisionPadding={12}
          collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}>
          <Menu.Popup className="bot-menu rx-menu" aria-label={`Ações de ${m.a.nome}`} finalFocus={false}
            ref={(el) => { if (el) requestAnimationFrame(() => { if (el.isConnected && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }); }}>
            <p className="menu-nome">{m.a.nome}</p>
            {linhasDoMenu(m.a, m.dona, false).map((l, k) => (l.tipo === "hr" ? <hr key={k} /> : l.tipo === "nota" ? <p key={k} className="menu-nota">{l.texto}</p> : (
              <Menu.Item key={l.acao} nativeButton render={<button type="button" />} data-gestao={l.acao} className={l.perigo ? "danger" : undefined}
                onClick={() => { escolhida.current = l.acao; }}>
                <svg {...SVG}><path d={CAMINHOS_DO_MENU[l.acao]} /></svg>{l.texto}
              </Menu.Item>
            )))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Abre o menu do bot num root próprio (desmontado ao fechar); um menu aberto antes sai. */
export function abrirMenuDoBotNoReact(doc: Document, m: MenuDoBot): void {
  doc.querySelector(".rx-menu-host")?.dispatchEvent(new CustomEvent("rx-fechar"));
  const host = doc.createElement("div");
  host.className = "rx-menu-host";
  doc.body.append(host);
  const raiz = createRoot(host, { identifierPrefix: "menu-bot-" });
  let saiu = false;
  const sair = (): void => { if (saiu) return; saiu = true; queueMicrotask(() => { raiz.unmount(); host.remove(); }); };
  host.addEventListener("rx-fechar", sair, { once: true });
  raiz.render(<StrictMode><MenuDoBotRx m={m} sair={sair} /></StrictMode>);
}

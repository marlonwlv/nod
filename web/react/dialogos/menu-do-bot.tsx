import { useRef } from "react";
import { Menu } from "@base-ui/react/menu";
import { MenuAncorado, montarMenu } from "./menu-ancorado.tsx";
import { CAMINHOS_DO_MENU, linhasDoMenu, type AcaoGestao, type BotGerido } from "../../telas/gestao-agentes.ts";

/**
 * ADR-179 (item 4): o menu do bot na lista (o clique direito, Shift+F10 e o ⋯; web/telas/gestao-agentes.ts `abrirMenu`, a
 * volta com `?dialogos-react=0`) pelo Menu do Base UI. As mesmas linhas (`linhasDoMenu`, que o HTML nativo também lê) e o
 * mesmo lugar: no clique direito, no cursor; sem ponto, ao lado do que o abriu, deslizando para caber (sem virar de
 * lado, como a nativa). As setas, Home, End, a primeira letra e o Esc são do Base UI; o foco abre no 1º item.
 * A ação roda depois de o menu sair e o foco voltar a quem abriu (`MenuAncorado`).
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
  const escolhida = useRef<(() => void) | null>(null);
  return (
    <MenuAncorado a={{ ancora: m.ancora, ponto: m.ponto }} rotulo={`Ações de ${m.a.nome}`} escolhida={escolhida} sair={sair}>
      <p className="menu-nome">{m.a.nome}</p>
      {linhasDoMenu(m.a, m.dona, false).map((l, k) => (l.tipo === "hr" ? <hr key={k} /> : l.tipo === "nota" ? <p key={k} className="menu-nota">{l.texto}</p> : (
        <Menu.Item key={l.acao} nativeButton render={<button type="button" />} data-gestao={l.acao} className={l.perigo ? "danger" : undefined}
          onClick={() => { escolhida.current = () => m.executar(l.acao); }}>
          <svg {...SVG}><path d={CAMINHOS_DO_MENU[l.acao]} /></svg>{l.texto}
        </Menu.Item>
      )))}
    </MenuAncorado>
  );
}

/** Abre o menu do bot num root próprio (desmontado ao fechar); um menu aberto antes sai. */
export function abrirMenuDoBotNoReact(doc: Document, m: MenuDoBot): void {
  montarMenu(doc, "menu-bot", (sair) => <MenuDoBotRx m={m} sair={sair} />);
}

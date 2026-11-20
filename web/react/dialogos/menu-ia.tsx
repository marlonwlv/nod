import { escolhaDoItem, type EscolhaSeletor } from "../../telas/seletor-ia.ts";
import { abrirMenuDeHtmlNoReact, type MenuDeHtml } from "./menu-de-html.tsx";

/**
 * ADR-179 (item 4): o seletor de IA do campo (web/lib/menu-ia.ts, a volta com `?dialogos-react=0`) pelo Menu do Base
 * UI, com o mesmo HTML (`renderMenuIa`). O botão do campo fica onde está (filho do `.box`); só o menu muda: acima dele,
 * alinhado à direita, com o foco na escolha atual. `aoMudar` redesenha o miolo do botão (a seta) ao abrir e ao fechar.
 * Devolve como fechar: o main fecha o menu quando o campo troca de conversa com ele aberto.
 */
export function abrirMenuIaNoReact(doc: Document, ancora: HTMLElement, html: string, escolher: (e: EscolhaSeletor) => void, aoMudar: () => void = () => undefined): { fechar: () => void } {
  const controle: NonNullable<MenuDeHtml["controle"]> = { current: null };
  ancora.setAttribute("aria-expanded", "true");
  aoMudar();
  abrirMenuDeHtmlNoReact(doc, {
    html, ancora, rotulo: "IA e modelo", lado: "top", alinhar: "end", distancia: 8, classe: "ia-sel-menu", focoInicial: '[aria-checked="true"]', controle,
    aoFechar: () => { ancora.setAttribute("aria-expanded", "false"); aoMudar(); },
    aoEscolher: () => undefined,
    aoClicar: (b) => {
      const escolha = b.dataset["escolha"] !== undefined ? escolhaDoItem(b.dataset) : null;
      return escolha ? { fechar: true, depois: () => escolher(escolha) } : null;
    },
  });
  return { fechar: () => controle.current?.fechar() };
}

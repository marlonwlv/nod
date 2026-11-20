import type { ModoAprovacao } from "../../../src/contracts/agente.ts";
import { reagirMenuModo, renderConfirmaTotal, renderMenuModo } from "../../telas/aprovacoes.ts";
import { abrirMenuDeHtmlNoReact, type MenuDeHtml } from "./menu-de-html.tsx";

/**
 * ADR-179 (item 4): o menu do modo de aprovação (ADR-059; web/lib/menu-modo.ts, a volta com `?dialogos-react=0`) pelo
 * Menu do Base UI: o mesmo HTML (`renderMenuModo`, e `renderConfirmaTotal` logo depois do terceiro item) e a mesma regra
 * pura (`reagirMenuModo`: o clique repetido ou apressado na confirmação não conta). Acima do botão, alinhado à esquerda
 * dele, com o foco no modo atual; a confirmação põe o foco em "Agora não". O Esc com a confirmação aberta fecha só ela.
 */
function comConfirmacao(html: string, nome: string): string {
  const t = document.createElement("template");
  t.innerHTML = html;
  const total = t.content.querySelector('[data-modo="total"]');
  total?.setAttribute("aria-expanded", "true");
  total?.insertAdjacentHTML("afterend", renderConfirmaTotal(nome));
  return t.innerHTML;
}

export function abrirMenuModoNoReact(doc: Document, ancora: HTMLElement, nome: string, atual: ModoAprovacao, escolher: (modo: ModoAprovacao, confirmado: boolean) => void, revisor = false,
  /** O relógio do clique apressado (o teste do Chrome o controla; no app, o `performance.now`). */
  agora: () => number = () => performance.now()): void {
  const base = renderMenuModo(nome, atual, revisor);
  let confirmando = false;
  let abriuEm = 0;
  const controle: NonNullable<MenuDeHtml["controle"]> = { current: null };
  const fecharConfirmacao = (): void => { confirmando = false; controle.current?.trocar(base, '[data-modo="total"]'); };
  ancora.setAttribute("aria-expanded", "true");
  abrirMenuDeHtmlNoReact(doc, {
    html: base, ancora, lado: "top", alinhar: "start", distancia: 8, classe: "modo-menu", focoInicial: '[aria-checked="true"]', controle,
    aoFechar: () => ancora.setAttribute("aria-expanded", "false"),
    aoEscolher: () => undefined,
    aoPedirFechar: (motivo) => {
      if (motivo !== "escape-key" || !confirmando) return true;
      fecharConfirmacao();
      return false;
    },
    aoClicar: (b, cliques) => {
      const clique = { cliques, msDesdeAConfirmacao: agora() - abriuEm };
      const confirma = b.dataset.confirma;
      const ev = confirma ? { tipo: confirma === "sim" ? "confirmar" as const : "agora-nao" as const, ...clique } : { tipo: "item" as const, modo: b.dataset.modo as ModoAprovacao, ...clique };
      const r = reagirMenuModo(atual, confirmando, ev);
      if (r.tipo === "ignorar") return null;
      if (r.tipo === "fechar") return { fechar: true };
      if (r.tipo === "escolher") return { fechar: true, depois: () => escolher(r.modo, r.confirmado) };
      if (r.tipo === "abrir-confirmacao") {
        confirmando = true;
        abriuEm = agora();
        // O foco vai para "Agora não": Enter sem querer não liga o modo.
        controle.current?.trocar(comConfirmacao(base, nome), '[data-confirma="nao"]');
      } else fecharConfirmacao();
      return null;
    },
  });
}

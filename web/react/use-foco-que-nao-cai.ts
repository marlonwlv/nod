import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * QA-157 (a família do foco no `<body>`, QA-146/149/151/152/156): numa tela em React, o item que sai da lista depois de
 * uma ação pelo teclado (decidir um cartão, "Limpar vencidos", dispensar) levava junto o elemento focado, e o foco caía
 * no `<body>` — o próximo Tab voltava ao topo da página. Este gancho lembra onde o foco estava dentro da tela e, se o nó
 * focado saiu do DOM e o foco ficou sem dono, leva-o ao item que ocupou o lugar (o seguinte), ao anterior ou ao título.
 * Foco fora da tela ou já em outro controle não é mexido.
 *
 * `item`: o seletor de um item da lista (ex.: `[data-decisao]`); o destino é o primeiro botão/link dele, ou o próprio item.
 * `titulo`: o seletor do título; ganha `tabindex="-1"` só quando recebe o foco (o DOM sem foco segue o da tela por string).
 * `grupo` (QA-159): quando os itens vivem dentro de blocos que ficam (ex.: as concessões de cada conector), o seguinte e o
 * anterior são procurados só no bloco do item que saiu; se o bloco ficou sem itens, o foco vai a `noGrupo` dentro dele
 * (ex.: o Conceder do mesmo conector) e só então ao título.
 * `chave` (QA-160): o atributo que identifica o item (ex.: `data-id`); se o item focado foi desmontado e montado de novo
 * noutro lugar (a tarefa que muda de grupo com dado novo), o foco vai a ele, não ao vizinho.
 */
const FOCAVEL = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Os itens que dá para focar: fora de um `<details>` fechado (os vencidos recolhidos não recebem o foco). */
const visiveis = (r: HTMLElement, item: string): HTMLElement[] => [...r.querySelectorAll<HTMLElement>(item)].filter((el) => !el.parentElement?.closest("details:not([open])"));

export function useFocoQueNaoCai(raiz: RefObject<HTMLElement | null>, opcoes: { item: string; titulo: string; grupo?: string; noGrupo?: string; chave?: string }): void {
  const ultimo = useRef<{ el: HTMLElement; indice: number; grupo: HTMLElement | null; id: string | null } | null>(null);
  const { item, titulo, grupo, noGrupo, chave } = opcoes;
  useLayoutEffect(() => {
    const r = raiz.current;
    if (!r) return;
    const lembrar = (ev: FocusEvent) => {
      const el = ev.target instanceof HTMLElement ? ev.target : null;
      if (!el) return;
      const bloco = grupo ? el.closest<HTMLElement>(grupo) : null;
      const itens = visiveis(bloco ?? r, item);
      const dono = el.closest<HTMLElement>(item);
      ultimo.current = { el, indice: dono ? itens.indexOf(dono) : -1, grupo: bloco, id: chave && dono ? dono.getAttribute(chave) : null };
    };
    r.addEventListener("focusin", lembrar);
    return () => r.removeEventListener("focusin", lembrar);
  }, [raiz, item, grupo, chave]);
  useLayoutEffect(() => {
    const r = raiz.current;
    const antes = ultimo.current;
    if (!r || !antes || antes.el.isConnected) return;
    const ativo = r.ownerDocument.activeElement;
    if (ativo && ativo !== r.ownerDocument.body && ativo.isConnected) return;
    const mesmo = chave && antes.id !== null ? visiveis(r, item).find((n) => n.getAttribute(chave) === antes.id) : undefined;
    if (mesmo) {
      (mesmo.matches(FOCAVEL) ? mesmo : (mesmo.querySelector<HTMLElement>(FOCAVEL) ?? mesmo)).focus({ preventScroll: false });
      return;
    }
    const bloco = antes.grupo?.isConnected && r.contains(antes.grupo) ? antes.grupo : null;
    const itens = visiveis(bloco ?? r, item);
    const no = antes.indice >= 0 ? (itens[Math.min(antes.indice, itens.length - 1)] ?? null) : null;
    const destino = no ? (no.querySelector<HTMLElement>(FOCAVEL) ?? no) : bloco && noGrupo ? bloco.querySelector<HTMLElement>(noGrupo) : null;
    if (destino) {
      if (!destino.matches(FOCAVEL) && !destino.hasAttribute("tabindex")) destino.setAttribute("tabindex", "-1");
      destino.focus({ preventScroll: false });
      return;
    }
    const h = r.querySelector<HTMLElement>(titulo);
    if (!h) return;
    if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
    h.focus();
  });
}

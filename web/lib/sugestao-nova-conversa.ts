/**
 * ADR-167 (Paper 04): na nova conversa, o termo vai para "Criar o bot “Ce”", no máximo 5 bots aparecem e um deles
 * ganha o ↵ (`data-nc-atual`). ↑ ↓ trocam o marcado; Enter abre o marcado.
 *
 * QA-155: o redesenho da tela (um bot que muda de prévia, um novo que chega, o React depois de cada frame, a casca
 * regravada pela string) refazia a marcação e o ↵ voltava ao primeiro: quem tinha descido com ↓ até o 2º e apertava
 * Enter abria outro bot. A escolha feita com as setas fica lembrada para o mesmo termo, pelo id do bot, enquanto ele
 * continuar entre os mostrados; termo novo (ou bot que sumiu) volta ao primeiro.
 */
export interface SugestoesDaNovaConversa {
  /** Refaz o termo, o teto de 5 e o ↵ (depois de digitar ou de um redesenho). */
  marcar: (pop: HTMLElement, texto: string) => void;
  /** ↑ (-1) ou ↓ (+1) entre os bots mostrados; false quando não há nenhum. */
  mover: (pop: HTMLElement, passo: 1 | -1) => boolean;
}

export function criarSugestoesDaNovaConversa(): SugestoesDaNovaConversa {
  let escolhida: { termo: string; agente: string } | null = null;
  let termoAtual = "";
  const mostrados = (pop: HTMLElement): HTMLElement[] => [...pop.querySelectorAll<HTMLElement>(".nc-bot:not([hidden])")];
  return {
    marcar(pop, texto) {
      const t = texto.trim();
      termoAtual = t;
      const termo = pop.querySelector<HTMLElement>(".nc-termo");
      if (termo) termo.textContent = t;
      pop.querySelector<HTMLElement>(".nc-criar")?.toggleAttribute("hidden", t === "");
      const bots = [...pop.querySelectorAll<HTMLElement>(".nc-bot")];
      let n = 0;
      for (const b of bots) {
        if (!b.hidden && n >= 5) b.hidden = true;
        if (!b.hidden) n++;
      }
      const visiveis = bots.filter((b) => !b.hidden);
      const lembrada = escolhida && escolhida.termo === t ? visiveis.find((b) => b.dataset.agente === escolhida!.agente) : undefined;
      if (!lembrada) escolhida = null;
      const marcada = lembrada ?? visiveis[0];
      for (const b of bots) b.toggleAttribute("data-nc-atual", b === marcada);
    },
    mover(pop, passo) {
      const bots = mostrados(pop);
      if (!bots.length) return false;
      const i = bots.findIndex((b) => b.hasAttribute("data-nc-atual"));
      const j = (i + passo + bots.length) % bots.length;
      bots.forEach((b, k) => b.toggleAttribute("data-nc-atual", k === j));
      const agente = bots[j]!.dataset.agente;
      escolhida = agente ? { termo: termoAtual, agente } : null;
      return true;
    },
  };
}

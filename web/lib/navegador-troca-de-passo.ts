/**
 * D8 (Paper XJU-0): a troca de passo na linha de atividade do navegador — o passo antigo sobe e some, o novo entra de
 * baixo, em 160 ms, e no máximo uma troca por segundo (a que chega antes espera e só a última aparece). Movimento reduzido:
 * corte seco, com o mesmo teto de uma por segundo.
 *
 * A linha é desenhada pelo render da conversa como texto (`.nv-linha small`); este controle roda depois de cada render, lê
 * o texto novo e, se mudou, troca o conteúdo pelo par animado (o que sai e o que entra) ou, dentro do segundo, volta a
 * mostrar o anterior e agenda a troca para quando o segundo fechar.
 */
export const MS_TROCA_DE_PASSO = 160;
export const MS_ENTRE_TROCAS = 1_000;

type Linha = { mostrado: string; em: number; pendente: string | null; relogio: number };

export type OpcoesTrocaDePasso = {
  agora: () => number;
  agendar: (fn: () => void, ms: number) => number;
  cancelar: (id: number) => void;
  reduzido: () => boolean;
  /** Onde procurar as linhas (o documento, ou a raiz de um teste). */
  raiz: () => ParentNode;
};

export function criarTrocaDePasso(o: OpcoesTrocaDePasso) {
  const linhas = new Map<string, Linha>();

  const smallDe = (id: string): HTMLElement | null => o.raiz().querySelector<HTMLElement>(`.nv-linha[data-agente="${CSS.escape(id)}"] .nv-linha-txt small`);

  function trocar(el: HTMLElement, l: Linha, de: string, para: string): void {
    l.mostrado = para;
    l.em = o.agora();
    l.pendente = null;
    if (o.reduzido()) { el.textContent = para; return; }
    el.textContent = "";
    el.classList.add("nv-trocando");
    const sai = document.createElement("span");
    sai.className = "nv-passo sai";
    sai.setAttribute("aria-hidden", "true");
    sai.textContent = de;
    const entra = document.createElement("span");
    entra.className = "nv-passo entra";
    entra.textContent = para;
    el.append(sai, entra);
    o.agendar(() => {
      if (!el.isConnected || !el.contains(entra)) return;
      el.classList.remove("nv-trocando");
      el.textContent = para;
    }, MS_TROCA_DE_PASSO);
  }

  return {
    /** Depois de cada render: as linhas do navegador à vista. */
    aplicar(): void {
      const vistas = new Set<string>();
      for (const linha of o.raiz().querySelectorAll<HTMLElement>(".nv-linha[data-agente]")) {
        const id = linha.dataset.agente ?? "";
        const el = linha.querySelector<HTMLElement>(".nv-linha-txt small");
        if (!id || !el) continue;
        vistas.add(id);
        const novo = el.textContent ?? "";
        const l = linhas.get(id);
        if (!l) { linhas.set(id, { mostrado: novo, em: o.agora(), pendente: null, relogio: 0 }); continue; }
        if (novo === l.mostrado) { l.pendente = null; continue; }
        const falta = l.em + MS_ENTRE_TROCAS - o.agora();
        if (falta > 0) {
          // Dentro do segundo: o render escreveu o novo, mas fica o anterior até a hora da troca (vale o último que chegar).
          el.textContent = l.mostrado;
          l.pendente = novo;
          if (!l.relogio) {
            l.relogio = o.agendar(() => {
              l.relogio = 0;
              const alvo = smallDe(id);
              if (alvo && l.pendente !== null && l.pendente !== l.mostrado) trocar(alvo, l, l.mostrado, l.pendente);
            }, falta);
          }
          continue;
        }
        trocar(el, l, l.mostrado, novo);
      }
      for (const [id, l] of linhas) if (!vistas.has(id)) { if (l.relogio) o.cancelar(l.relogio); linhas.delete(id); }
    },
  };
}

/**
 * QA-149: o × de um anexo some com o item; com o foco nele (teclado), o foco caía no corpo da página e o próximo Tab
 * voltava ao topo. Antes de remover, `lugarDoFocoNaFila` guarda a fila e a posição do × em foco; depois de redesenhar,
 * `devolverFocoNaFila` leva o foco ao × que ficou no mesmo lugar (o seguinte, ou o último) e, sem anexo, ao texto do campo
 * mais próximo. Sem foco no × (clique de mouse que não foca, outro elemento em foco), nada muda.
 */
export function lugarDoFocoNaFila(chave: string, ativo: Element | null = document.activeElement): { fila: HTMLElement; indice: number } | null {
  if (!(ativo instanceof HTMLElement) || !ativo.classList.contains("anexo-x") || ativo.dataset.id !== chave) return null;
  const fila = ativo.closest<HTMLElement>("#composer-anexos, [data-composer=\"fila\"]");
  if (!fila) return null;
  return { fila, indice: [...fila.querySelectorAll(".anexo-x")].indexOf(ativo) };
}

export function devolverFocoNaFila(lugar: { fila: HTMLElement; indice: number } | null): void {
  if (!lugar || !lugar.fila.isConnected) return;
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && document.contains(ativo)) return;
  const botoes = [...lugar.fila.querySelectorAll<HTMLElement>(".anexo-x")];
  const alvo = botoes[Math.min(lugar.indice, botoes.length - 1)];
  if (alvo) { alvo.focus(); return; }
  for (let p = lugar.fila.parentElement; p; p = p.parentElement) {
    const texto = p.querySelector<HTMLElement>("textarea");
    if (texto) { texto.focus(); return; }
  }
}

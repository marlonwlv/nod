/**
 * QA-156: o foco na tela Não lidos quando uma linha sai (✓, E ou deslize) ou quando tudo é marcado. Sem isto, quem marca
 * pelo ✓ com o teclado (ou pelo "Marcar tudo como lido", ou com E na última linha) via o foco cair no <body>, e o próximo
 * Tab voltava ao topo da página. O foco sai da linha na hora (antes da chamada ao servidor), então E repetido e ↓ logo
 * depois seguem da linha certa em vez de voltar à primeira. Sem linha que fique, vai ao título da tela, que o React
 * mantém entre a lista e o "Tudo em dia".
 */

const LINHAS = ".tela-nao-lidos .nl-item:not(.nl-sai)";

function focarTitulo(doc: Document): void {
  const titulo = doc.querySelector<HTMLElement>(".tela-nao-lidos h1");
  if (!titulo) return;
  if (!titulo.hasAttribute("tabindex")) titulo.setAttribute("tabindex", "-1");
  titulo.focus();
}

/** Antes de a linha sair: se o foco está nela, vai para o "abrir" da próxima linha que fica, da anterior ou ao título. */
export function focoAntesDeSair(item: Element | null, doc: Document = document): void {
  if (!item || !item.contains(doc.activeElement)) return;
  const linhas = [...doc.querySelectorAll<HTMLElement>(LINHAS)];
  const i = linhas.indexOf(item as HTMLElement);
  const destino = i >= 0 ? linhas[i + 1] ?? linhas[i - 1] : linhas.find((l) => l !== item);
  const abrir = destino?.querySelector<HTMLElement>(".nl-abrir");
  if (abrir) abrir.focus();
  else focarTitulo(doc);
}

/** Antes do "Marcar tudo como lido": o botão some com a lista, então o foco que estava na tela vai ao título. */
export function focoAntesDeMarcarTudo(doc: Document = document): void {
  if (doc.activeElement?.closest(".tela-nao-lidos")) focarTitulo(doc);
}

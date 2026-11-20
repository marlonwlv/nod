const segmentador = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Encurta texto para um teto em unidades UTF-16 sem partir o caractere visível no limite.
 * A reticência faz parte do teto; um grafema que não cabe inteiro fica de fora.
 */
export function cortarComReticencia(texto: string, teto: number): string {
  if (texto.length <= teto) return texto;
  const cabe = Math.max(0, teto - 1);
  let corte = "";
  for (const { segment } of segmentador.segment(texto)) {
    if (corte.length + segment.length > cabe) break;
    corte += segment;
  }
  return `${corte}…`;
}

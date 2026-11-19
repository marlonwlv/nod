const grafemas = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * QA-103 (2026-11-19): corta `texto` para caber em `max` unidades UTF-16 (o `.length` que os testes e as telas medem),
 * com "…" no fim, sem partir um caractere visível. O `slice` por unidade UTF-16 deixava meio emoji (um surrogate solto)
 * no título da rotina que `ver_agenda` manda ao bot, e o Postgres recusa esse texto em jsonb.
 */
export function cortarComReticencias(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const partes = Array.from(grafemas.segment(texto), (s) => s.segment);
  let tamanho = texto.length;
  while (partes.length > 0 && tamanho > max - 1) tamanho -= partes.pop()!.length;
  return `${partes.join("").trimEnd()}…`;
}

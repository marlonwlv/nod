/**
 * Backoffice interno (definido em 2026-11-24, ADR-194): o espelho, na web, de src/shared/backoffice.ts (a web não importa
 * código de src, ADR-018). tests/unit/backoffice-equipe.test.ts amarra os dois: mudou um, muda o outro.
 *
 * A tela mora em `/backoffice` (padrão `/backoffice/uso`), com as seções em `/backoffice/<secao>` e a pessoa em
 * `/backoffice/pessoas/:tenantId/:pessoaId`. A API mora em `/api/backoffice/*`. Nada daqui é do admin de workspace (que,
 * quando existir, fica sob `/api/t/:tenantId/admin/*`, com o papel da pessoa no workspace).
 */
export const CAMINHO_BACKOFFICE = "/backoffice";
export const CAMINHO_BACKOFFICE_PADRAO = "/backoffice/uso";
/** O parâmetro do login que traz a pessoa de volta ao backoffice depois de entrar (`/?volta=/backoffice/...`). */
export const PARAMETRO_VOLTA = "volta";

const SEGMENTO = /^[A-Za-z0-9_-]{1,64}$/;

/** O caminho é da tela do backoffice (`/backoffice` ou `/backoffice/...`)? */
export function ehCaminhoDoBackoffice(caminho: string): boolean {
  return caminho === CAMINHO_BACKOFFICE || caminho.startsWith(`${CAMINHO_BACKOFFICE}/`);
}

/**
 * O destino da volta depois do login, só se for um caminho do próprio backoffice: segmentos simples (sem `..`, `//`,
 * esquema, host ou barra invertida), no máximo quatro abaixo de `/backoffice`, e a query só com `dias`. Qualquer outra
 * coisa vira null: a volta nunca é um redirecionamento aberto.
 */
export function caminhoDeVolta(bruto: string | null | undefined): string | null {
  if (typeof bruto !== "string" || bruto.length === 0 || bruto.length > 300) return null;
  const [caminho = "", query, ...resto] = bruto.split("?");
  if (resto.length > 0 || !ehCaminhoDoBackoffice(caminho)) return null;
  const segmentos = caminho.slice(1).split("/");
  if (segmentos.length > 5 || segmentos.some((s) => !SEGMENTO.test(s))) return null;
  if (query === undefined || query === "") return caminho;
  const dias = /^dias=(\d{1,2})$/.exec(query);
  return dias ? `${caminho}?dias=${dias[1]}` : caminho;
}

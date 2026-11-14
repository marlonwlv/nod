/**
 * C5 (definido em 2026-11-12, fase 0 da migração do front): a conversa que a pessoa acabou de abrir é a PRIMEIRA leitura da
 * passada do reidratar, não a última. Ela entrava depois das invalidações que já esperavam (frota, sua vez, trabalhos, a
 * conversa de outros bots…) e, com as leituras em série, o "carregando conversa…" durava a passada inteira.
 *
 * TODO(C5): a troca sem "carregando" e sem reconstruir a conversa vem do cursor por conversa do backend (branch
 * `backend/estado-vivo-cursor`: mensagens com seq/updated_seq, conversa com geracao, e
 * `GET /conversas/:id/mensagens?depois_de=<updated_seq>&geracao=<g>` devolvendo só o que mudou ou `cursor_velho`). A web
 * não guarda cache próprio de conversa: quando o cursor chegar, a releitura da conversa aberta passa a pedir só o delta.
 */
export function comAbertaNaFrente<T extends string>(fila: readonly T[], conversaAberta: string | null): T[] {
  if (!conversaAberta) return [...fila];
  const chave = `conversa:${conversaAberta}`;
  const i = fila.indexOf(chave as T);
  if (i <= 0) return [...fila];
  return [fila[i]!, ...fila.slice(0, i), ...fila.slice(i + 1)];
}

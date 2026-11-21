import { ErroApi } from "./erro-api.ts";

/**
 * QA-166: o "Limpar vencidos" dispensa em série (são poucos) e, antes, parava no primeiro erro — e sem reler a tela. Um
 * vencido que já saiu por outro caminho (outra aba, o × do cartão, duplo clique no botão, a gêmea fechada por regra)
 * responde 409/404 e deixava os seguintes na tela e os já dispensados aparecendo, com "Isso não pode ser feito agora".
 * O que já não está aberto é o resultado que a pessoa pediu: segue para o próximo. Outra falha (rede, permissão) para o
 * lote e sobe para o `agir` mostrar; quem chama relê a tela nos dois casos.
 */
export function jaSaiu(e: unknown): boolean {
  return e instanceof ErroApi && (e.status === 409 || e.status === 404);
}

export async function dispensarVencidos(ids: readonly string[], dispensar: (id: string) => Promise<unknown>): Promise<{ dispensados: string[]; jaTinhamSaido: string[] }> {
  const dispensados: string[] = [];
  const jaTinhamSaido: string[] = [];
  for (const id of new Set(ids)) {
    try {
      await dispensar(id);
      dispensados.push(id);
    } catch (e) {
      if (!jaSaiu(e)) throw e;
      jaTinhamSaido.push(id);
    }
  }
  return { dispensados, jaTinhamSaido };
}
